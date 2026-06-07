"""Infer a discriminated JSON Schema from quest log JSONL files."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any


x_SCHEMA_URI = "https://json-schema.org/draft/2020-12/schema"
x_DEFAULT_SCHEMA_NAME = "quest_log_events.schema.json"
x_ROOT_DISCRIMINATORS = ("harness", "event_kind")
x_NESTED_DISCRIMINATORS = ("type", "subtype", "event_kind", "kind")
x_ENUM_STRING_FIELDS = frozenset(
    {
        "apiKeySource",
        "event_kind",
        "finish_reason",
        "harness",
        "model",
        "outcome",
        "permissionMode",
        "reasoning_effort",
        "role",
        "status",
        "subtype",
        "thread_key",
        "type",
    }
)
x_CONST_IF_UNIQUE_FIELDS = frozenset({"schema_version"})
x_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
x_IDENTIFIER_RE = re.compile(r"[^A-Za-z0-9]+")


@dataclass(frozen=True)
class JsonRecord:
    source_path: Path
    line_number: int
    value: dict[str, Any]


@dataclass(frozen=True)
class InferenceOptions:
    enum_limit: int = 24
    max_discriminator_branches: int = 80
    max_enum_string_length: int = 80


def FindRepoRoot(start: Path) -> Path:
    current = start.resolve()
    if current.is_file():
        current = current.parent
    for directory in (current, *current.parents):
        if (directory / ".git").is_dir() or (directory / "config" / "services.json").is_file():
            return directory
    raise ValueError(f"Could not find repo root from {start}")


def DefaultSchemaPath(repo_root: Path) -> Path:
    return repo_root / "structure" / "schemas" / x_DEFAULT_SCHEMA_NAME


def IterQuestRoots(repo_root: Path) -> Iterator[Path]:
    top_level = repo_root / "quests"
    if top_level.is_dir():
        yield top_level

    projects_dir = repo_root / "projects"
    if not projects_dir.is_dir():
        return
    for project_dir in sorted(projects_dir.iterdir(), key=lambda item: item.name):
        quests_dir = project_dir / "quests"
        if quests_dir.is_dir():
            yield quests_dir


def IterJsonlLogPaths(repo_root: Path) -> list[Path]:
    paths: dict[Path, Path] = {}
    for quest_root in IterQuestRoots(repo_root):
        for path in quest_root.glob("**/logs/*.jsonl"):
            resolved = path.resolve()
            paths[resolved] = path
    return sorted(paths.values(), key=lambda item: item.relative_to(repo_root).as_posix())


def LoadRecords(paths: Iterable[Path]) -> list[JsonRecord]:
    records: list[JsonRecord] = []
    for path in paths:
        with path.open("r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, start=1):
                if not line.strip():
                    continue
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError(f"{path}:{line_number}: expected a JSON object")
                records.append(JsonRecord(source_path=path, line_number=line_number, value=value))
    return records


def JsonType(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "string"


def IsScalarTag(value: Any) -> bool:
    return value is None or isinstance(value, str | int | float | bool)


def AddNull(schema: dict[str, Any]) -> dict[str, Any]:
    if "oneOf" in schema or "anyOf" in schema:
        return {"anyOf": [schema, {"type": "null"}]}

    schema = dict(schema)
    schema_type = schema.get("type")
    if isinstance(schema_type, str):
        if schema_type != "null":
            schema["type"] = [schema_type, "null"]
        return schema
    if isinstance(schema_type, list):
        if "null" not in schema_type:
            schema["type"] = [*schema_type, "null"]
        return schema
    return {"anyOf": [schema, {"type": "null"}]}


def PrimitiveSchema(values: list[Any], json_type: str, path: tuple[str, ...], options: InferenceOptions) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": json_type}
    leaf_name = path[-1] if path else ""

    if json_type == "string":
        strings = [value for value in values if isinstance(value, str)]
        if strings and all(x_TIMESTAMP_RE.match(value) for value in strings):
            schema["format"] = "date-time"
        unique = sorted(set(strings))
        if (
            leaf_name in x_ENUM_STRING_FIELDS
            and 0 < len(unique) <= options.enum_limit
            and max((len(value) for value in unique), default=0) <= options.max_enum_string_length
        ):
            schema["enum"] = unique

    if leaf_name in x_CONST_IF_UNIQUE_FIELDS:
        unique_values = UniqueJsonValues(values)
        if len(unique_values) == 1:
            schema["const"] = unique_values[0]

    return schema


def UniqueJsonValues(values: Iterable[Any]) -> list[Any]:
    found: dict[str, Any] = {}
    for value in values:
        key = json.dumps(value, sort_keys=True, separators=(",", ":"))
        found[key] = value
    return [found[key] for key in sorted(found)]


def InferSchema(values: list[Any], path: tuple[str, ...], options: InferenceOptions) -> dict[str, Any]:
    if not values:
        return {}

    by_type: dict[str, list[Any]] = defaultdict(list)
    for value in values:
        by_type[JsonType(value)].append(value)

    if "null" in by_type and len(by_type) == 2:
        non_null_type = next(json_type for json_type in by_type if json_type != "null")
        return AddNull(InferSingleTypeSchema(by_type[non_null_type], non_null_type, path, options))

    if len(by_type) == 1:
        json_type = next(iter(by_type))
        return InferSingleTypeSchema(by_type[json_type], json_type, path, options)

    return {
        "anyOf": [
            InferSingleTypeSchema(by_type[json_type], json_type, path, options)
            for json_type in sorted(by_type)
        ]
    }


def InferSingleTypeSchema(
    values: list[Any],
    json_type: str,
    path: tuple[str, ...],
    options: InferenceOptions,
) -> dict[str, Any]:
    if json_type == "object":
        objects = [value for value in values if isinstance(value, dict)]
        union_schema = TryDiscriminatedUnion(objects, path, options)
        if union_schema is not None:
            return union_schema
        return InferObjectShape(objects, path, options, const_properties={})

    if json_type == "array":
        arrays = [value for value in values if isinstance(value, list)]
        items = [item for array in arrays for item in array]
        schema: dict[str, Any] = {"type": "array"}
        schema["items"] = InferSchema(items, (*path, "[]"), options) if items else {}
        return schema

    return PrimitiveSchema(values, json_type, path, options)


def TryDiscriminatedUnion(
    objects: list[dict[str, Any]],
    path: tuple[str, ...],
    options: InferenceOptions,
) -> dict[str, Any] | None:
    if len(objects) < 2:
        return None

    candidate_keys = [key for key in x_NESTED_DISCRIMINATORS if all(key in item for item in objects)]
    if not candidate_keys:
        return None

    discriminator_keys = [candidate_keys[0]]
    if "subtype" in x_NESTED_DISCRIMINATORS and candidate_keys[0] == "type":
        if any("subtype" in item for item in objects):
            discriminator_keys.append("subtype")

    groups = GroupByDiscriminators(objects, discriminator_keys)
    if not (1 < len(groups) <= options.max_discriminator_branches):
        return None

    branches = [
        InferObjectShape(
            group_values,
            path,
            options,
            const_properties={
                key: value
                for key, value in tag
                if value is not MissingDiscriminator
            },
        )
        for tag, group_values in sorted(groups.items(), key=lambda item: TagSortKey(item[0]))
    ]

    return {
        "oneOf": branches,
        "x-discriminatorProperties": discriminator_keys,
    }


MissingDiscriminator = object()


def GroupByDiscriminators(
    objects: Iterable[dict[str, Any]],
    discriminator_keys: Iterable[str],
) -> dict[tuple[tuple[str, Any], ...], list[dict[str, Any]]]:
    groups: dict[tuple[tuple[str, Any], ...], list[dict[str, Any]]] = defaultdict(list)
    keys = tuple(discriminator_keys)
    for item in objects:
        tag: list[tuple[str, Any]] = []
        for key in keys:
            value = item.get(key, MissingDiscriminator)
            if value is not MissingDiscriminator and not IsScalarTag(value):
                value = json.dumps(value, sort_keys=True)
            tag.append((key, value))
        groups[tuple(tag)].append(item)
    return groups


def TagSortKey(tag: tuple[tuple[str, Any], ...]) -> tuple[str, ...]:
    return tuple("<missing>" if value is MissingDiscriminator else str(value) for _, value in tag)


def InferObjectShape(
    objects: list[dict[str, Any]],
    path: tuple[str, ...],
    options: InferenceOptions,
    const_properties: dict[str, Any],
) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    keys = sorted({key for item in objects for key in item})
    required: list[str] = []

    for key in keys:
        values = [item[key] for item in objects if key in item]
        if key in const_properties:
            properties[key] = {"const": const_properties[key]}
        else:
            properties[key] = InferSchema(values, (*path, key), options)
        if len(values) == len(objects):
            required.append(key)

    for key in const_properties:
        if key not in required:
            required.append(key)

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": True,
    }
    if required:
        schema["required"] = sorted(set(required))

    title = TitleFromConstProperties(const_properties)
    if title:
        schema["title"] = title

    return schema


def TitleFromConstProperties(const_properties: dict[str, Any]) -> str | None:
    if not const_properties:
        return None
    parts = [str(const_properties[key]) for key in sorted(const_properties)]
    raw_title = " ".join(parts)
    words = [word for word in x_IDENTIFIER_RE.split(raw_title.title()) if word]
    return "".join(words) + "Event"


def InferTopLevelSchema(records: list[JsonRecord], options: InferenceOptions) -> dict[str, Any]:
    groups = GroupByDiscriminators((record.value for record in records), x_ROOT_DISCRIMINATORS)
    branches = []
    for tag, values in sorted(groups.items(), key=lambda item: TagSortKey(item[0])):
        const_properties = {
            key: value
            for key, value in tag
            if value is not MissingDiscriminator
        }
        branches.append(InferObjectShape(values, (), options, const_properties=const_properties))

    file_count = len({record.source_path.resolve() for record in records})
    return {
        "$schema": x_SCHEMA_URI,
        "$id": "https://schemas.local/sheaf/quest-log-events.schema.json",
        "title": "Quest Log Event",
        "description": (
            "Inferred JSON Schema for concatenated Sheaf quest log JSONL events. "
            "The top-level schema is a tagged union over harness and event_kind."
        ),
        "oneOf": branches,
        "x-discriminatorProperties": list(x_ROOT_DISCRIMINATORS),
        "x-inference": {
            "eventCount": len(records),
            "fileCount": file_count,
            "topLevelVariantCount": len(branches),
        },
    }


def VariantCounts(records: Iterable[JsonRecord]) -> Counter[tuple[str, str]]:
    counts: Counter[tuple[str, str]] = Counter()
    for record in records:
        harness = record.value.get("harness")
        event_kind = record.value.get("event_kind")
        counts[(str(harness), str(event_kind))] += 1
    return counts


def WriteJson(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def ParseArgs(argv: list[str] | None = None) -> argparse.Namespace:
    script_path = Path(__file__).resolve()
    repo_root = FindRepoRoot(script_path)
    parser = argparse.ArgumentParser(
        description="Infer a tagged-union JSON Schema from quest log JSONL files.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=repo_root,
        help="Repository root containing top-level quests/ and projects/ directories.",
    )
    parser.add_argument(
        "--schema-output",
        type=Path,
        default=None,
        help="Path for the inferred JSON Schema output.",
    )
    parser.add_argument(
        "--enum-limit",
        type=int,
        default=InferenceOptions.enum_limit,
        help="Maximum unique string values to preserve as inferred enums.",
    )
    return parser.parse_args(argv)


def Main(argv: list[str] | None = None) -> int:
    args = ParseArgs(argv)
    options = InferenceOptions(enum_limit=args.enum_limit)
    schema_output = args.schema_output or DefaultSchemaPath(args.repo_root)

    log_paths = IterJsonlLogPaths(args.repo_root)
    if not log_paths:
        raise SystemExit(f"No quest log JSONL files found under {args.repo_root}")

    records = LoadRecords(log_paths)
    schema = InferTopLevelSchema(records, options)
    WriteJson(schema_output, schema)

    print(f"Files: {len(log_paths)}")
    print(f"Events: {len(records)}")
    print(f"Schema output: {schema_output}")
    print("Top-level variants:")
    for (harness, event_kind), count in VariantCounts(records).most_common():
        print(f"  {count:6d}  harness={harness!r} event_kind={event_kind!r}")

    return 0


if __name__ == "__main__":
    raise SystemExit(Main())
