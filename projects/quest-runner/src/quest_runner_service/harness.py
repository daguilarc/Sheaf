"""Agent harness implementations (CLI-backed) and shared streaming runner."""

from __future__ import annotations

import json
import selectors
import signal
import subprocess
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .quest_types import HarnessKind, utc_now_iso


class HarnessNotAvailable(Exception):
    """Raised when a harness CLI is missing or fails its version probe."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class HarnessMessageError(Exception):
    """Raised when a harness emits a structured error event while sending a message."""

    def __init__(self, message: str, *, detail: str, raw_output: str) -> None:
        self.message = message
        self.detail = detail
        self.raw_output = raw_output
        super().__init__(message)


@dataclass
class HarnessResponse:
    provider_thread_id: str
    model: str
    output_text: str
    thinking_tokens: str
    stream_events_count: int
    idle_timeout: bool
    elapsed_seconds: float


class HarnessJsonlLogSink:
    """Line-oriented JSONL writer for live harness event logs."""

    def __init__(
        self,
        *,
        path: Path,
        step: int,
        role: str,
        thread: str,
        harness: str,
        provider_thread_id: str,
    ) -> None:
        self.path = path
        self.step = step
        self.role = role
        self.thread = thread
        self.harness = harness
        self.provider_thread_id = provider_thread_id
        self._sequence = 0
        self._line_buffer = ""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("", encoding="utf-8")

    def write_control(self, event_kind: str, **fields: Any) -> None:
        self._append(event_kind=event_kind, **fields)

    def write_stdout_chunk(self, chunk: bytes) -> None:
        text = chunk.decode("utf-8", errors="replace")
        self._line_buffer += text
        while "\n" in self._line_buffer:
            raw_line, self._line_buffer = self._line_buffer.split("\n", 1)
            self._write_provider_line(raw_line)

    def flush_stdout(self) -> None:
        if self._line_buffer:
            self._write_provider_line(self._line_buffer)
            self._line_buffer = ""

    def _write_provider_line(self, raw_line: str) -> None:
        line = raw_line.rstrip("\r")
        if not line:
            return
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            self._append(event_kind="provider.text", text=line)
            return
        if isinstance(payload, dict):
            self._append(event_kind="provider.json", payload=payload)
        else:
            self._append(event_kind="provider.json", payload=payload)

    def _append(self, *, event_kind: str, **fields: Any) -> None:
        self._sequence += 1
        event = {
            "schema_version": 1,
            "timestamp": utc_now_iso(),
            "sequence": self._sequence,
            "step": self.step,
            "role": self.role,
            "thread": self.thread,
            "harness": self.harness,
            "provider_thread_id": self.provider_thread_id,
            "event_kind": event_kind,
        }
        event.update(fields)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, sort_keys=True, ensure_ascii=False))
            fh.write("\n")
            fh.flush()


def _run_cli_streaming(
    cmd: list[str],
    cwd: Path,
    idle_timeout_seconds: int,
    env: dict[str, str] | None = None,
    log_sink: HarnessJsonlLogSink | None = None,
) -> dict[str, Any]:
    """Run a CLI command with streaming output capture and idle timeout."""
    start = time.monotonic()
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        env=env,
    )
    assert proc.stdout is not None
    stdout = proc.stdout
    parts: list[bytes] = []
    stream_events_count = 0
    idle_timed_out = False
    last_output = time.monotonic()
    poll_interval = 0.1
    exit_code: int | None = None
    reader = getattr(stdout, "read1", lambda n: stdout.read(n))
    selector: selectors.BaseSelector | None = None
    use_selector = False
    try:
        fileno = stdout.fileno()
        if isinstance(fileno, int):
            selector = selectors.DefaultSelector()
            selector.register(stdout, selectors.EVENT_READ)
            use_selector = True
    except Exception:
        use_selector = False

    try:
        while True:
            code = proc.poll()
            if code is not None:
                exit_code = code
                rest = stdout.read()
                if rest:
                    parts.append(rest)
                    if log_sink is not None:
                        log_sink.write_stdout_chunk(rest)
                    stream_events_count += 1
                break
            if use_selector and selector is not None:
                events = selector.select(timeout=poll_interval)
                if events:
                    chunk = reader(65536)
                    if chunk:
                        parts.append(chunk)
                        if log_sink is not None:
                            log_sink.write_stdout_chunk(chunk)
                        stream_events_count += 1
                        last_output = time.monotonic()
                        continue
                if time.monotonic() - last_output >= idle_timeout_seconds:
                    idle_timed_out = True
                    proc.send_signal(signal.SIGTERM)
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
                    tail = stdout.read()
                    if tail:
                        parts.append(tail)
                        if log_sink is not None:
                            log_sink.write_stdout_chunk(tail)
                        stream_events_count += 1
                    break
            else:
                chunk = reader(65536)
                if chunk:
                    parts.append(chunk)
                    if log_sink is not None:
                        log_sink.write_stdout_chunk(chunk)
                    stream_events_count += 1
                    last_output = time.monotonic()
                else:
                    time.sleep(poll_interval)
                    if time.monotonic() - last_output >= idle_timeout_seconds:
                        idle_timed_out = True
                        proc.send_signal(signal.SIGTERM)
                        try:
                            proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                            proc.wait()
                        tail = stdout.read()
                        if tail:
                            parts.append(tail)
                            if log_sink is not None:
                                log_sink.write_stdout_chunk(tail)
                            stream_events_count += 1
                        break
    finally:
        if selector is not None:
            try:
                selector.unregister(stdout)
            except Exception:
                pass
            try:
                selector.close()
            except Exception:
                pass
        try:
            stdout.close()
        except Exception:
            pass

    if exit_code is None:
        exit_code = proc.poll()
    if exit_code is None:
        exit_code = proc.returncode
    elapsed = time.monotonic() - start
    if log_sink is not None:
        log_sink.flush_stdout()
        log_sink.write_control(
            "conductor.run_completed",
            exit_code=exit_code,
            elapsed_seconds=elapsed,
            idle_timeout=idle_timed_out,
            stream_events_count=stream_events_count,
        )
    output_text = b"".join(parts).decode("utf-8", errors="replace")
    return {
        "exit_code": exit_code,
        "output_text": output_text,
        "stream_events_count": stream_events_count,
        "idle_timeout": idle_timed_out,
        "elapsed_seconds": elapsed,
    }


def _extract_stream_text(obj: dict[str, Any]) -> str:
    msg = obj.get("message")
    if isinstance(msg, dict):
        content = msg.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            pieces: list[str] = []
            for block in content:
                if isinstance(block, dict):
                    t = block.get("text")
                    if isinstance(t, str):
                        pieces.append(t)
            return "".join(pieces)
    for key in ("text", "content"):
        v = obj.get(key)
        if isinstance(v, str):
            return v
    delta = obj.get("delta")
    if isinstance(delta, dict):
        t = delta.get("text")
        if isinstance(t, str):
            return t
    return ""


def _extract_stream_error(output_text: str) -> str | None:
    for raw in output_text.splitlines():
        line = raw.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue

        item = obj.get("item")
        if isinstance(item, dict) and item.get("type") == "error":
            message = item.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()
            return line

        if obj.get("type") == "error":
            err = obj.get("error")
            if isinstance(err, str) and err.strip():
                return err.strip()
            errors = obj.get("errors")
            if isinstance(errors, list) and errors:
                return "; ".join(str(e) for e in errors)
            return line

        if obj.get("is_error") is True:
            err = obj.get("error")
            if isinstance(err, str) and err.strip():
                return err.strip()
            errors = obj.get("errors")
            if isinstance(errors, list) and errors:
                return "; ".join(str(e) for e in errors)
            result = obj.get("result")
            if isinstance(result, str) and result.strip():
                return result.strip()
            return line

        err = obj.get("error")
        if isinstance(err, str) and err.strip():
            return err.strip()

        errors = obj.get("errors")
        if isinstance(errors, list) and errors:
            return "; ".join(str(e) for e in errors)

    return None


def _raise_for_harness_failure(
    raw: dict[str, Any],
    display_name: str,
    log_sink: HarnessJsonlLogSink | None = None,
) -> None:
    error_detail = _extract_stream_error(raw["output_text"])
    if error_detail is not None:
        if log_sink is not None:
            log_sink.write_control(
                "conductor.run_failed",
                reason="structured_error",
                detail=error_detail,
            )
        raise HarnessMessageError(
            f"{display_name} returned a structured error event",
            detail=error_detail,
            raw_output=raw["output_text"],
        )

    exit_code = raw.get("exit_code")
    if isinstance(exit_code, int) and exit_code != 0:
        detail = f"{display_name} exited with status {exit_code}"
        output_text = raw["output_text"].strip()
        if output_text:
            detail = f"{detail}\n{output_text}"
        if log_sink is not None:
            log_sink.write_control(
                "conductor.run_failed",
                reason="nonzero_exit",
                detail=detail,
                exit_code=exit_code,
            )
        raise HarnessMessageError(
            f"{display_name} exited with a non-zero status",
            detail=detail,
            raw_output=raw["output_text"],
        )


def _parse_generic_stream_json(output_text: str) -> str:
    result_texts: list[str] = []
    agent_texts: list[str] = []
    saw_json = False
    ignored_types = {
        "thread.started",
        "turn.started",
        "turn.completed",
        "response.completed",
        "tool_call",
    }
    for raw in output_text.splitlines():
        line = raw.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        saw_json = True
        result = obj.get("result")
        if obj.get("type") == "result" and isinstance(result, str) and result:
            result_texts.append(result)
            continue
        item = obj.get("item")
        if isinstance(item, dict) and item.get("type") == "agent_message":
            text = item.get("text")
            if isinstance(text, str) and text:
                agent_texts.append(text)
            continue
        if obj.get("type") == "thinking":
            continue
        if obj.get("type") in ignored_types:
            continue
        chunk = _extract_stream_text(obj)
        if chunk:
            agent_texts.append(chunk)
    if result_texts:
        return result_texts[-1]
    if agent_texts:
        return agent_texts[-1]
    if saw_json:
        return ""
    return output_text


def _parse_claude_stream_json(output_text: str) -> tuple[str, str]:
    out_chunks: list[str] = []
    think_chunks: list[str] = []
    for raw in output_text.splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        t = obj.get("type")
        chunk = _extract_stream_text(obj)
        if t == "thinking" and chunk:
            think_chunks.append(chunk)
        elif t == "assistant" and chunk:
            out_chunks.append(chunk)
        elif t in ("message", "content_block_delta") and chunk:
            out_chunks.append(chunk)
    return "".join(out_chunks), "".join(think_chunks)


def _find_stream_event_value(
    output_text: str, *, event_type: str, field: str
) -> str | None:
    for raw in output_text.splitlines():
        line = raw.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        if obj.get("type") != event_type:
            continue
        value = obj.get(field)
        if isinstance(value, str) and value:
            return value
    return None


def _find_json_field(output_text: str, field: str) -> str | None:
    for raw in output_text.splitlines():
        line = raw.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        value = obj.get(field)
        if isinstance(value, str) and value:
            return value
    return None


def _first_nonempty_line(output_text: str) -> str | None:
    for raw in output_text.splitlines():
        line = raw.strip()
        if line:
            return line
    return None


class Harness(ABC):
    kind: HarnessKind
    display_name: str
    config: dict[str, Any]

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = config or {}

    def _cli_bin(self, default: str) -> str:
        path = self.config.get("cli_path")
        if isinstance(path, str) and path.strip():
            return path
        return default

    @abstractmethod
    def validate(self) -> None:
        """Check that the CLI binary exists and responds to --version or equivalent."""

    @abstractmethod
    def create_thread(
        self,
        *,
        thread_name: str,
        repo_path: Path,
        quest_dir: Path,
        model: str,
        reasoning_effort: str | None,
        idle_timeout_seconds: int,
    ) -> str:
        """Create a provider-native thread. Return provider_thread_id."""

    @abstractmethod
    def send_message(
        self,
        *,
        provider_thread_id: str,
        quest_dir: Path,
        repo_path: Path,
        message: str,
        idle_timeout_seconds: int,
        model: str,
        reasoning_effort: str | None,
        stream: bool = True,
        log_sink: HarnessJsonlLogSink | None = None,
    ) -> HarnessResponse:
        """Send a streaming message. Return normalized assistant text plus metadata."""

    @abstractmethod
    def get_thread(
        self, *, provider_thread_id: str, quest_dir: Path
    ) -> dict[str, Any]:
        """Return thread metadata for diagnostics."""


class ClaudeCodeHarness(Harness):
    kind = HarnessKind.ClaudeCode
    display_name = "Claude Code"
    permission_mode = "acceptEdits"

    def _resolved_reasoning_effort(self, reasoning_effort: str | None) -> str:
        return reasoning_effort or "high"

    def validate(self) -> None:
        cli = self._cli_bin("claude")
        try:
            subprocess.run(
                [cli, "--version"],
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            raise HarnessNotAvailable(
                f"Claude Code CLI ({cli!r}) is not available or `{cli} --version` failed"
            ) from e

    def create_thread(
        self,
        *,
        thread_name: str,
        repo_path: Path,
        quest_dir: Path,
        model: str,
        reasoning_effort: str | None,
        idle_timeout_seconds: int,
    ) -> str:
        _ = thread_name, quest_dir
        cli = self._cli_bin("claude")
        cmd = [
            cli,
            "--model",
            model,
            "--effort",
            self._resolved_reasoning_effort(reasoning_effort),
            "--permission-mode",
            self.permission_mode,
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--include-hook-events",
            "--max-turns",
            "1",
            "-p",
            "Session initialization only. Reply with exactly READY.",
        ]
        raw = _run_cli_streaming(cmd, repo_path, idle_timeout_seconds)
        session_id = _find_json_field(raw["output_text"], "session_id")
        if session_id:
            return session_id
        raise HarnessNotAvailable(
            "Claude Code CLI did not return a provider thread id during create_thread"
        )

    def send_message(
        self,
        *,
        provider_thread_id: str,
        quest_dir: Path,
        repo_path: Path,
        message: str,
        idle_timeout_seconds: int,
        model: str,
        reasoning_effort: str | None,
        stream: bool = True,
        log_sink: HarnessJsonlLogSink | None = None,
    ) -> HarnessResponse:
        _ = quest_dir, stream
        cli = self._cli_bin("claude")
        cmd = [
            cli,
            "--resume",
            provider_thread_id,
            "--model",
            model,
            "--effort",
            self._resolved_reasoning_effort(reasoning_effort),
            "--permission-mode",
            self.permission_mode,
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--include-hook-events",
            "--max-turns",
            "100",
            "-p",
            message,
        ]
        raw = _run_cli_streaming(cmd, repo_path, idle_timeout_seconds, log_sink=log_sink)
        _raise_for_harness_failure(raw, "Claude Code", log_sink)
        output_text, thinking_tokens = _parse_claude_stream_json(raw["output_text"])
        if not output_text and raw["output_text"].strip():
            output_text = raw["output_text"]
        return HarnessResponse(
            provider_thread_id=provider_thread_id,
            model=model,
            output_text=output_text,
            thinking_tokens=thinking_tokens,
            stream_events_count=raw["stream_events_count"],
            idle_timeout=raw["idle_timeout"],
            elapsed_seconds=raw["elapsed_seconds"],
        )

    def get_thread(self, *, provider_thread_id: str, quest_dir: Path) -> dict[str, Any]:
        _ = quest_dir
        return {
            "provider_thread_id": provider_thread_id,
            "last_used_at": utc_now_iso(),
        }


class CodexHarness(Harness):
    kind = HarnessKind.Codex
    display_name = "Codex"

    def _resolved_reasoning_effort(self, reasoning_effort: str | None) -> str:
        return reasoning_effort or "high"

    def validate(self) -> None:
        cli = self._cli_bin("codex")
        try:
            subprocess.run(
                [cli, "--version"],
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            raise HarnessNotAvailable(
                f"Codex CLI ({cli!r}) is not available or `{cli} --version` failed"
            ) from e

    def create_thread(
        self,
        *,
        thread_name: str,
        repo_path: Path,
        quest_dir: Path,
        model: str,
        reasoning_effort: str | None,
        idle_timeout_seconds: int,
    ) -> str:
        _ = thread_name, quest_dir
        cli = self._cli_bin("codex")
        cmd = [
            cli,
            "exec",
            "--json",
            "--model",
            model,
            "-c",
            f'model_reasoning_effort="{self._resolved_reasoning_effort(reasoning_effort)}"',
            "--full-auto",
            "Session initialization only. Reply with exactly READY.",
        ]
        raw = _run_cli_streaming(cmd, repo_path, idle_timeout_seconds)
        thread_id = _find_stream_event_value(
            raw["output_text"],
            event_type="thread.started",
            field="thread_id",
        )
        if thread_id is None:
            raise HarnessNotAvailable(
                "Codex CLI did not return a provider thread id during create_thread"
            )
        return thread_id

    def send_message(
        self,
        *,
        provider_thread_id: str,
        quest_dir: Path,
        repo_path: Path,
        message: str,
        idle_timeout_seconds: int,
        model: str,
        reasoning_effort: str | None,
        stream: bool = True,
        log_sink: HarnessJsonlLogSink | None = None,
    ) -> HarnessResponse:
        _ = quest_dir, stream
        cli = self._cli_bin("codex")
        cmd = [
            cli,
            "exec",
            "resume",
            "--json",
            "--model",
            model,
            "-c",
            f'model_reasoning_effort="{self._resolved_reasoning_effort(reasoning_effort)}"',
            "--full-auto",
            provider_thread_id,
            message,
        ]
        raw = _run_cli_streaming(cmd, repo_path, idle_timeout_seconds, log_sink=log_sink)
        _raise_for_harness_failure(raw, "Codex", log_sink)
        actual_thread_id = _find_stream_event_value(
            raw["output_text"],
            event_type="thread.started",
            field="thread_id",
        )
        return HarnessResponse(
            provider_thread_id=actual_thread_id or provider_thread_id,
            model=model,
            output_text=_parse_generic_stream_json(raw["output_text"]),
            thinking_tokens="",
            stream_events_count=raw["stream_events_count"],
            idle_timeout=raw["idle_timeout"],
            elapsed_seconds=raw["elapsed_seconds"],
        )

    def get_thread(self, *, provider_thread_id: str, quest_dir: Path) -> dict[str, Any]:
        _ = quest_dir
        return {
            "provider_thread_id": provider_thread_id,
            "last_used_at": utc_now_iso(),
        }


class CursorHarness(Harness):
    kind = HarnessKind.Cursor
    display_name = "Cursor"

    def validate(self) -> None:
        cli = self._cli_bin("cursor-agent")
        try:
            subprocess.run(
                [cli, "--version"],
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            raise HarnessNotAvailable(
                f"Cursor CLI ({cli!r}) is not available or `{cli} --version` failed"
            ) from e

    def create_thread(
        self,
        *,
        thread_name: str,
        repo_path: Path,
        quest_dir: Path,
        model: str,
        reasoning_effort: str | None,
        idle_timeout_seconds: int,
    ) -> str:
        _ = thread_name, quest_dir, reasoning_effort
        cli = self._cli_bin("cursor-agent")
        cmd = [
            cli,
            "create-chat",
        ]
        raw = _run_cli_streaming(cmd, repo_path, idle_timeout_seconds)
        session_id = _first_nonempty_line(raw["output_text"])
        if session_id is None:
            raise HarnessNotAvailable(
                "Cursor CLI did not return a provider thread id during create_thread"
            )
        return session_id

    def send_message(
        self,
        *,
        provider_thread_id: str,
        quest_dir: Path,
        repo_path: Path,
        message: str,
        idle_timeout_seconds: int,
        model: str,
        reasoning_effort: str | None,
        stream: bool = True,
        log_sink: HarnessJsonlLogSink | None = None,
    ) -> HarnessResponse:
        _ = quest_dir, stream, reasoning_effort
        cli = self._cli_bin("cursor-agent")
        cmd = [
            cli,
            "--resume",
            provider_thread_id,
            "--print",
            "--yolo",
            "--model",
            model,
            "--output-format",
            "stream-json",
            "--stream-partial-output",
            message,
        ]
        raw = _run_cli_streaming(cmd, repo_path, idle_timeout_seconds, log_sink=log_sink)
        _raise_for_harness_failure(raw, "Cursor", log_sink)
        return HarnessResponse(
            provider_thread_id=provider_thread_id,
            model=model,
            output_text=_parse_generic_stream_json(raw["output_text"]),
            thinking_tokens="",
            stream_events_count=raw["stream_events_count"],
            idle_timeout=raw["idle_timeout"],
            elapsed_seconds=raw["elapsed_seconds"],
        )

    def get_thread(self, *, provider_thread_id: str, quest_dir: Path) -> dict[str, Any]:
        _ = quest_dir
        return {
            "provider_thread_id": provider_thread_id,
            "last_used_at": utc_now_iso(),
        }


_HARNESS_MAP: dict[HarnessKind, type[Harness]] = {
    HarnessKind.ClaudeCode: ClaudeCodeHarness,
    HarnessKind.Codex: CodexHarness,
    HarnessKind.Cursor: CursorHarness,
}


def create_harness(kind: HarnessKind, config: dict[str, Any] | None = None) -> Harness:
    cls = _HARNESS_MAP[kind]
    harness = cls(config or {})
    harness.validate()
    return harness
