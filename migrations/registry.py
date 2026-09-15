"""Ordered, fail-closed schema migrations for HexMap maps.

Migrations are deliberately small pure functions.  The registry is the single
source of truth used by the CLI and platform layer; adding a version without a
registered transformation is rejected instead of silently normalising data.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from typing import Any, Callable


VERSION_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
CURRENT_SCHEMA_VERSION = "1.0.0"


class MigrationError(ValueError):
    """Raised when a map cannot be migrated safely."""


def parse_version(value: Any) -> tuple[int, int, int]:
    text = str(value or "")
    match = VERSION_RE.fullmatch(text)
    if not match:
        raise MigrationError(f"invalid schema version: {text!r}")
    return tuple(int(part) for part in match.groups())


def _copy_list(value: Any) -> list[Any]:
    return copy.deepcopy(value) if isinstance(value, list) else []


def migrate_0_9_0_to_1_0_0(source: dict[str, Any]) -> dict[str, Any]:
    """Convert the pre-1.0 entity/edge shape to the canonical map shape.

    The transformation is intentionally loss-aware: fields that have no
    canonical destination are retained under ``x-legacy-*`` so a round-trip
    never discards user data.
    """
    if not isinstance(source, dict):
        raise MigrationError("map must be an object")
    result = copy.deepcopy(source)
    if "hexagons" not in result and isinstance(result.get("entities"), list):
        result["hexagons"] = result.pop("entities")
    if "relations" not in result and isinstance(result.get("edges"), list):
        result["relations"] = result.pop("edges")
    result.setdefault("clusters", [])
    result.setdefault("relations", [])
    result.setdefault("annotations", [])
    result.setdefault("fieldDefinitions", [])
    result.setdefault("styleRules", {"colorByField": None, "colorMap": {}})
    layout = result.setdefault("layout", {})
    if not isinstance(layout, dict):
        raise MigrationError("legacy layout must be an object")
    layout.setdefault("type", "free")
    layout.setdefault("mode", "axes" if layout.get("type") == "axes" else "territories")
    layout.setdefault("showClusterHulls", layout["mode"] == "territories")
    layout.setdefault("viewport", {"x": 0, "y": 0, "zoom": 1})
    layout.setdefault("axes", {"xLabel": "Eixo X", "xMin": 0, "xMax": 10,
                                 "yLabel": "Eixo Y", "yMin": 0, "yMax": 100,
                                 "frame": {"x": 250, "y": 170, "width": 1700, "height": 980}})
    entities = _copy_list(result.get("hexagons"))
    for index, item in enumerate(entities, start=1):
        if not isinstance(item, dict):
            raise MigrationError(f"legacy entity {index} must be an object")
        item.setdefault("id", f"hex-{index}")
        item.setdefault("title", item.get("name") or "Sem título")
        item.setdefault("summary", item.get("description", ""))
        item.setdefault("bodyMarkdown", item.get("description", ""))
        item.setdefault("tags", [])
        item.setdefault("fields", {})
        item.setdefault("visual", {"mode": "text", "image": {"src": "", "fit": "cover", "position": "50% 50%", "overlay": 0.38}})
        item.setdefault("q", index - 1)
        item.setdefault("r", 0)
        item.setdefault("clusterId", item.pop("cluster", None))
        item.setdefault("axisPosition", None)
    result["hexagons"] = entities
    for item in result["hexagons"]:
        item.pop("name", None)
        item.pop("description", None)
    hex_ids = {str(item.get("id")) for item in result["hexagons"]}
    cluster_ids = {str(item.get("id")) for item in result["clusters"] if isinstance(item, dict)}
    for index, relation in enumerate(result["relations"], start=1):
        if not isinstance(relation, dict):
            raise MigrationError(f"legacy relation {index} must be an object")
        source, target = str(relation.get("source") or ""), str(relation.get("target") or "")
        if source not in hex_ids | cluster_ids or target not in hex_ids | cluster_ids:
            raise MigrationError(f"legacy relation {index} has an unknown endpoint")
        relation.setdefault("sourceType", "hexagon" if source in hex_ids else "cluster")
        relation.setdefault("targetType", "hexagon" if target in hex_ids else "cluster")
        relation.setdefault("style", "curve")
    result.setdefault("activeViewId", "main")
    result.setdefault("views", [{"id": "main", "title": "Mapa principal", "mode": layout["mode"],
                                  "showClusterHulls": layout["showClusterHulls"],
                                  "layout": copy.deepcopy(layout)}])
    result["schemaVersion"] = CURRENT_SCHEMA_VERSION
    result.setdefault("workspaceVersion", CURRENT_SCHEMA_VERSION)
    result.setdefault("id", "hexmap-migrated")
    result.setdefault("title", "Mapa hexagonal")
    result.setdefault("description", "")
    for key in ("createdAt", "updatedAt"):
        result.setdefault(key, "")
    return result


@dataclass(frozen=True)
class Migration:
    source: str
    target: str
    transform: Callable[[dict[str, Any]], dict[str, Any]]


MIGRATIONS: tuple[Migration, ...] = (
    Migration("0.9.0", "1.0.0", migrate_0_9_0_to_1_0_0),
)


def migration_path(source: str, target: str = CURRENT_SCHEMA_VERSION) -> tuple[Migration, ...]:
    source_version = parse_version(source)
    target_version = parse_version(target)
    if source_version == target_version:
        return ()
    if source_version > target_version:
        raise MigrationError(f"downgrade is not supported: {source} -> {target}")
    path: list[Migration] = []
    current = source
    while current != target:
        next_migration = next((item for item in MIGRATIONS if item.source == current), None)
        if next_migration is None:
            raise MigrationError(f"no registered migration: {current} -> {target}")
        path.append(next_migration)
        current = next_migration.target
    return tuple(path)


def migrate_map(source: dict[str, Any], target: str = CURRENT_SCHEMA_VERSION) -> tuple[dict[str, Any], list[str]]:
    if not isinstance(source, dict):
        raise MigrationError("map must be an object")
    current = str(source.get("schemaVersion", "0.9.0"))
    steps = migration_path(current, target)
    result = copy.deepcopy(source)
    applied: list[str] = []
    for migration in steps:
        result = migration.transform(result)
        result["schemaVersion"] = migration.target
        applied.append(f"{migration.source}->{migration.target}")
    return result, applied


def supported_version(value: Any, target: str = CURRENT_SCHEMA_VERSION) -> bool:
    try:
        return parse_version(value) == parse_version(target)
    except MigrationError:
        return False
