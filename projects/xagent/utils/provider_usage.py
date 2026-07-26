#!/usr/bin/env python3
"""
Collect Claude / Codex / Cursor usage into one JSON object.

Usage fractions are always "how full the bucket is": 0.0 empty, 1.0 exhausted.
Fields that fail to parse are omitted. Each provider block always includes
`payload` with the raw provider response when available.

Spec: openspec/specs/xagent-provider-usage/spec.md
"""

from __future__ import annotations

import json
import re
import select
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo


x_CLAUDE_TIMEOUT_S = 60
x_CODEX_TIMEOUT_S = 30
x_CURSOR_TIMEOUT_S = 20

x_CLAUDE_SESSION_LABEL = "current session"
x_CLAUDE_WEEK_LABEL = "current week (all models)"

x_CURSOR_USAGE_URL = (
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage"
)


def Clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def PercentToUsage(percent: float) -> float:
    # Provider percents are "used" amounts (0-100). Normalize to 0-1 used.
    #
    return Clamp01(percent / 100.0)


def CursorApiPercentToUsage(value: float) -> float:
    # Cursor's autoPercentUsed / totalPercentUsed are percentage points already
    # scaled to the UI (e.g. 0.95 ~= "1% used"), not 0-100 integers.
    #
    return Clamp01(value / 100.0)


def UnixSecondsToIso(seconds: int | float) -> str:
    return datetime.fromtimestamp(float(seconds), tz=timezone.utc).astimezone().isoformat()


def UnixMillisToIso(millis: int | float | str) -> str:
    return UnixSecondsToIso(float(millis) / 1000.0)


def ParseClaudeResetTime(text: str) -> str | None:
    # Example: resets Jul 26 at 1:10pm (America/Los_Angeles)
    #
    match = re.search(
        r"resets\s+([A-Za-z]+)\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)"
        r"\s*\(([^)]+)\)",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    month_name, day_s, hour_s, minute_s, ampm, tz_name = match.groups()
    try:
        tz = ZoneInfo(tz_name.strip())
    except Exception:
        return None

    now_local = datetime.now(tz)
    try:
        month = datetime.strptime(month_name.title(), "%b").month
    except ValueError:
        try:
            month = datetime.strptime(month_name.title(), "%B").month
        except ValueError:
            return None

    day = int(day_s)
    hour = int(hour_s) % 12
    if ampm.lower() == "pm":
        hour += 12
    minute = int(minute_s)

    candidate = datetime(now_local.year, month, day, hour, minute, tzinfo=tz)
    # Wrap to next year if the stamped month/day is far in the past.
    #
    if (now_local - candidate).days > 180:
        candidate = datetime(now_local.year + 1, month, day, hour, minute, tzinfo=tz)

    return candidate.isoformat()


def ParseClaudeUsageLine(report: str, label: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    pattern = re.compile(
        rf"^\s*{re.escape(label)}\s*:\s*(.+)$",
        flags=re.IGNORECASE | re.MULTILINE,
    )
    match = pattern.search(report)
    if not match:
        return out

    prose = match.group(1).strip()
    percent_match = re.search(
        r"(\d+(?:\.\d+)?)\s*%\s*(?:used|remaining|left|available)?",
        prose,
        flags=re.IGNORECASE,
    )
    if percent_match:
        percent = float(percent_match.group(1))
        kind_match = re.search(r"%\s*(used|remaining|left|available)", prose, flags=re.IGNORECASE)
        kind = kind_match.group(1).lower() if kind_match else "used"
        if kind in ("remaining", "left", "available"):
            out["usage"] = Clamp01(1.0 - PercentToUsage(percent))
        else:
            out["usage"] = PercentToUsage(percent)

    reset_iso = ParseClaudeResetTime(prose)
    if reset_iso is not None:
        out["resets_at"] = reset_iso

    return out


def FetchClaudePayload() -> str:
    completed = subprocess.run(
        ["claude", "-p", "/usage"],
        check=False,
        capture_output=True,
        text=True,
        timeout=x_CLAUDE_TIMEOUT_S,
    )
    text = (completed.stdout or "").strip()
    if not text:
        err = (completed.stderr or "").strip()
        raise RuntimeError(err or f"claude exited {completed.returncode} with empty stdout")
    return text


def BuildClaudeSection() -> dict[str, Any]:
    section: dict[str, Any] = {}
    try:
        payload = FetchClaudePayload()
    except Exception as exc:
        section["payload"] = {"error": str(exc)}
        return section

    section["payload"] = payload

    session = ParseClaudeUsageLine(payload, x_CLAUDE_SESSION_LABEL)
    if "usage" in session:
        section["five_hour_usage"] = session["usage"]
    if "resets_at" in session:
        section["five_hour_resets_at"] = session["resets_at"]

    week = ParseClaudeUsageLine(payload, x_CLAUDE_WEEK_LABEL)
    if "usage" in week:
        section["week_usage"] = week["usage"]
    if "resets_at" in week:
        section["week_resets_at"] = week["resets_at"]

    return section


def CodexRecv(proc: subprocess.Popen[str], want_id: int, timeout_s: float) -> dict[str, Any]:
    end = datetime.now().timestamp() + timeout_s
    assert proc.stdout is not None
    while datetime.now().timestamp() < end:
        ready, _, _ = select.select([proc.stdout], [], [], 0.2)
        if not ready:
            if proc.poll() is not None:
                err = ""
                if proc.stderr is not None:
                    err = proc.stderr.read()
                raise RuntimeError(f"codex app-server exited {proc.returncode}: {err[:500]}")
            continue
        line = proc.stdout.readline()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if message.get("id") == want_id:
            return message
    raise TimeoutError(f"timed out waiting for codex response id={want_id}")


def FetchCodexPayload() -> dict[str, Any]:
    proc = subprocess.Popen(
        ["codex", "app-server", "--listen", "stdio://"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    assert proc.stdin is not None

    def Send(message: dict[str, Any]) -> None:
        proc.stdin.write(json.dumps(message) + "\n")
        proc.stdin.flush()

    try:
        Send(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "clientInfo": {
                        "name": "xagent-provider-usage",
                        "title": "xagent-provider-usage",
                        "version": "0.1.0",
                    },
                    "capabilities": {},
                },
            }
        )
        init_message = CodexRecv(proc, 1, x_CODEX_TIMEOUT_S)
        if "error" in init_message:
            raise RuntimeError(json.dumps(init_message["error"]))

        Send(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "account/rateLimits/read",
                "params": {},
            }
        )
        limits_message = CodexRecv(proc, 2, x_CODEX_TIMEOUT_S)
        if "error" in limits_message:
            raise RuntimeError(json.dumps(limits_message["error"]))
        result = limits_message.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("codex account/rateLimits/read returned no result object")
        return result
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()


def BuildCodexSection() -> dict[str, Any]:
    section: dict[str, Any] = {}
    try:
        payload = FetchCodexPayload()
    except Exception as exc:
        section["payload"] = {"error": str(exc)}
        return section

    section["payload"] = payload

    main = None
    by_id = payload.get("rateLimitsByLimitId")
    if isinstance(by_id, dict) and isinstance(by_id.get("codex"), dict):
        main = by_id["codex"]
    elif isinstance(payload.get("rateLimits"), dict):
        main = payload["rateLimits"]

    if not isinstance(main, dict):
        return section

    primary = main.get("primary")
    if not isinstance(primary, dict):
        return section

    used_percent = primary.get("usedPercent")
    if isinstance(used_percent, (int, float)):
        # Codex documents usedPercent as percent consumed (higher = more used).
        #
        section["week_usage"] = PercentToUsage(float(used_percent))

    resets_at = primary.get("resetsAt")
    if isinstance(resets_at, (int, float)):
        try:
            section["week_resets_at"] = UnixSecondsToIso(resets_at)
        except (OverflowError, OSError, ValueError):
            pass

    return section


def FetchCursorAccessToken() -> str:
    completed = subprocess.run(
        [
            "security",
            "find-generic-password",
            "-s",
            "cursor-access-token",
            "-a",
            "cursor-user",
            "-w",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    token = (completed.stdout or "").strip()
    if completed.returncode != 0 or not token:
        err = (completed.stderr or "").strip()
        raise RuntimeError(err or "cursor-access-token not found in Keychain")
    return token


def FetchCursorPayload() -> dict[str, Any]:
    token = FetchCursorAccessToken()
    request = urllib.request.Request(
        x_CURSOR_USAGE_URL,
        method="POST",
        data=b"{}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "xagent-provider-usage",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=x_CURSOR_TIMEOUT_S) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"cursor usage HTTP {exc.code}: {detail[:300]}") from exc

    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise RuntimeError("cursor usage response was not a JSON object")
    return payload


def BuildCursorSection() -> dict[str, Any]:
    section: dict[str, Any] = {}
    try:
        payload = FetchCursorPayload()
    except Exception as exc:
        section["payload"] = {"error": str(exc)}
        return section

    section["payload"] = payload
    plan_usage = payload.get("planUsage")
    if not isinstance(plan_usage, dict):
        plan_usage = {}

    total = plan_usage.get("totalPercentUsed")
    if isinstance(total, (int, float)):
        section["all_models_usage"] = CursorApiPercentToUsage(float(total))

    auto = plan_usage.get("autoPercentUsed")
    if isinstance(auto, (int, float)):
        section["cursor_models_usage"] = CursorApiPercentToUsage(float(auto))

    cycle_end = payload.get("billingCycleEnd")
    if cycle_end is not None:
        try:
            reset_iso = UnixMillisToIso(cycle_end)
            if "all_models_usage" in section:
                section["all_models_resets_at"] = reset_iso
            if "cursor_models_usage" in section:
                section["cursor_models_resets_at"] = reset_iso
        except (OverflowError, OSError, TypeError, ValueError):
            pass

    return section


def CollectProviderUsage() -> dict[str, Any]:
    with ThreadPoolExecutor(max_workers=3) as pool:
        claude_future = pool.submit(BuildClaudeSection)
        codex_future = pool.submit(BuildCodexSection)
        cursor_future = pool.submit(BuildCursorSection)
        return {
            "claude": claude_future.result(),
            "codex": codex_future.result(),
            "cursor": cursor_future.result(),
        }


def Main() -> int:
    report = CollectProviderUsage()
    json.dump(report, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(Main())
