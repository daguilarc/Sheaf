#!/usr/bin/env python3
"""Create and verify manifests for retained Dictator refiner studies."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_PRIVATE_ROOT = Path("/Users/joyo/Sheaf/data/dictator/experiments/refiner-benchmark")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{line_number}: {error}") from error
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number}: expected a JSON object")
            rows.append(value)
    return rows


def distinct(rows: Iterable[dict[str, Any]], key: str) -> list[str]:
    return sorted({str(row[key]) for row in rows if row.get(key) is not None})


def jsonl_metadata(rows: list[dict[str, Any]]) -> dict[str, Any]:
    latency = [float(row["latency_ms"]) for row in rows if isinstance(row.get("latency_ms"), (int, float))]
    reasoning_tokens = 0
    input_tokens = 0
    output_tokens = 0
    for row in rows:
        usage = row.get("usage") or {}
        if not isinstance(usage, dict):
            continue
        input_tokens += int(usage.get("input_tokens") or 0)
        output_tokens += int(usage.get("output_tokens") or 0)
        details = usage.get("output_tokens_details") or {}
        if isinstance(details, dict):
            reasoning_tokens += int(details.get("reasoning_tokens") or 0)

    metadata: dict[str, Any] = {
        "errors": sum(bool(row.get("error")) for row in rows),
        "configurations": distinct(rows, "config"),
        "requested_models": distinct(rows, "requested_model"),
        "response_models": distinct(rows, "response_model"),
        "reasoning_efforts": sorted(set(distinct(rows, "reasoning") + distinct(rows, "judge_reasoning"))),
        "judge_models": distinct(rows, "judge_model"),
        "recorded_at": distinct(rows, "recorded_at")[:1] + distinct(rows, "recorded_at")[-1:],
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "reasoning_tokens": reasoning_tokens,
        },
    }
    if latency:
        ordered = sorted(latency)
        metadata["latency_ms"] = {
            "mean": round(statistics.fmean(latency), 3),
            "p50": ordered[round((len(ordered) - 1) * 0.50)],
            "p90": ordered[round((len(ordered) - 1) * 0.90)],
        }
    return metadata


def private_artifact(path: Path, data_root: Path) -> dict[str, Any]:
    relative = path.relative_to(data_root)
    artifact: dict[str, Any] = {
        "path": relative.as_posix(),
        "category": relative.parts[0],
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }
    if path.suffix == ".jsonl":
        rows = read_jsonl(path)
        artifact["records"] = len(rows)
        artifact["run_metadata"] = jsonl_metadata(rows)
    return artifact


def tracked_artifact(path: Path, repo_root: Path) -> dict[str, Any]:
    return {
        "path": path.relative_to(repo_root).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def build_manifest(
    study_id: str,
    data_root: Path,
    repo_root: Path,
    tracked_paths: Iterable[Path],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    data_root = data_root.resolve()
    repo_root = repo_root.resolve()
    private_paths = sorted(path for path in data_root.rglob("*") if path.is_file())
    tracked = sorted(set(path.resolve() for path in tracked_paths))
    return {
        "schema_version": 1,
        "study_id": study_id,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "private_data_root": f"data/dictator/experiments/refiner-benchmark/{study_id}",
        "metadata": metadata,
        "private_artifacts": [private_artifact(path, data_root) for path in private_paths],
        "tracked_artifacts": [tracked_artifact(path, repo_root) for path in tracked],
    }


def build_summary(manifest: dict[str, Any]) -> dict[str, Any]:
    categories: dict[str, dict[str, int]] = defaultdict(lambda: {"files": 0, "bytes": 0, "records": 0})
    configurations: set[str] = set()
    models: set[str] = set()
    reasoning_efforts: set[str] = set()
    errors = 0
    for artifact in manifest.get("private_artifacts", []):
        category = str(artifact.get("category") or "unknown")
        categories[category]["files"] += 1
        categories[category]["bytes"] += int(artifact.get("bytes") or 0)
        categories[category]["records"] += int(artifact.get("records") or 0)
        run = artifact.get("run_metadata") or {}
        configurations.update(run.get("configurations") or [])
        models.update(run.get("requested_models") or [])
        models.update(run.get("response_models") or [])
        models.update(run.get("judge_models") or [])
        reasoning_efforts.update(run.get("reasoning_efforts") or [])
        errors += int(run.get("errors") or 0)
    return {
        "schema_version": 1,
        "study_id": manifest["study_id"],
        "private_artifacts": len(manifest.get("private_artifacts", [])),
        "tracked_artifacts": len(manifest.get("tracked_artifacts", [])),
        "categories": dict(sorted(categories.items())),
        "configurations": sorted(configurations),
        "models": sorted(models),
        "reasoning_efforts": sorted(reasoning_efforts),
        "errors": errors,
        "recommendation": (manifest.get("metadata") or {}).get("recommendation"),
        "reports": (manifest.get("metadata") or {}).get("reports", []),
    }


def verify_manifest(manifest_path: Path, data_root: Path, repo_root: Path) -> list[str]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors: list[str] = []

    for artifact in manifest.get("private_artifacts", []):
        relative = str(artifact["path"])
        path = data_root / relative
        errors.extend(verify_artifact(path, relative, artifact, include_records=True))

    for artifact in manifest.get("tracked_artifacts", []):
        relative = str(artifact["path"])
        path = repo_root / relative
        errors.extend(verify_artifact(path, relative, artifact, include_records=False))

    return errors


def verify_artifact(
    path: Path,
    display_path: str,
    expected: dict[str, Any],
    include_records: bool,
) -> list[str]:
    if not path.is_file():
        return [f"missing artifact: {display_path}"]
    errors: list[str] = []
    actual_hash = sha256(path)
    if actual_hash != expected.get("sha256"):
        errors.append(f"sha256 mismatch: {display_path}: expected {expected.get('sha256')}, got {actual_hash}")
    if int(expected.get("bytes") or path.stat().st_size) != path.stat().st_size:
        errors.append(f"byte count mismatch: {display_path}")
    if include_records and "records" in expected:
        actual_records = len(read_jsonl(path))
        if actual_records != int(expected["records"]):
            errors.append(
                f"record count mismatch: {display_path}: expected {expected['records']}, got {actual_records}"
            )
    return errors


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def command_snapshot(args: argparse.Namespace) -> None:
    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    tracked_paths = [args.repo_root / path for path in metadata.pop("tracked_paths")]
    manifest = build_manifest(args.study_id, args.data_root, args.repo_root, tracked_paths, metadata)
    write_json(args.manifest, manifest)
    write_json(args.summary, build_summary(manifest))
    print(f"wrote {args.manifest} and {args.summary}")


def command_verify(args: argparse.Namespace) -> None:
    errors = verify_manifest(args.manifest, args.data_root, args.repo_root)
    if errors:
        for error in errors:
            print(error)
        raise SystemExit(1)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    print(
        f"verified {len(manifest.get('private_artifacts', []))} private and "
        f"{len(manifest.get('tracked_artifacts', []))} tracked artifacts"
    )


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    subparsers = result.add_subparsers(dest="command", required=True)

    snapshot = subparsers.add_parser("snapshot")
    snapshot.add_argument("--study-id", required=True)
    snapshot.add_argument("--data-root", type=Path, required=True)
    snapshot.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    snapshot.add_argument("--metadata", type=Path, required=True)
    snapshot.add_argument("--manifest", type=Path, required=True)
    snapshot.add_argument("--summary", type=Path, required=True)
    snapshot.set_defaults(function=command_snapshot)

    verify = subparsers.add_parser("verify")
    verify.add_argument("--manifest", type=Path, required=True)
    verify.add_argument("--data-root", type=Path, required=True)
    verify.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    verify.set_defaults(function=command_verify)
    return result


def main() -> None:
    args = parser().parse_args()
    args.function(args)


if __name__ == "__main__":
    main()
