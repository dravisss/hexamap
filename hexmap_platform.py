"""Portable HexMap operations shared by the CLI and MCP adapter."""
from __future__ import annotations

import copy
import base64
import datetime as dt
import hashlib
import json
import math
import mimetypes
import os
import posixpath
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Iterable

import yaml

VERSION = "10.3.0"
SCHEMA_VERSION = "1.0.0"
WORKSPACE_VERSION = "1.0.0"
MAX_WORKSPACE_FILES = 10_000
MAX_WORKSPACE_FILE_BYTES = 5 * 1024 * 1024
MAX_WORKSPACE_BYTES = 50 * 1024 * 1024
MAX_WORKSPACE_NOTES = 10_000
MAX_BUNDLE_BYTES = 50 * 1024 * 1024
MANIFEST_PATH = Path(".hexmap/map.json")
VIEWS_PATH = Path(".hexmap/views")
PROJECT_PATH = Path("hexmap.yaml")
RESERVED = {"id", "title", "summary", "cluster", "tags", "visual", "hexmap"}
PALETTE = ["#bf7448", "#6f85ac", "#5f9887", "#a18e37", "#8f78a8", "#5f9bad", "#af6678", "#7a8b5f"]
PRESETS = {
    "editorial": {"density": "medium", "relationEmphasis": "high", "annotationStyle": "editorial", "cellContent": "title"},
    "research": {"density": "medium", "relationEmphasis": "medium", "annotationStyle": "note", "cellContent": "title-status"},
    "ecosystem": {"density": "loose", "relationEmphasis": "high", "annotationStyle": "editorial", "cellContent": "title"},
    "causal": {"density": "loose", "relationEmphasis": "maximum", "annotationStyle": "label", "cellContent": "title"},
    "actors": {"density": "medium", "relationEmphasis": "medium", "annotationStyle": "note", "cellContent": "title"},
    "process": {"density": "compact", "relationEmphasis": "high", "annotationStyle": "label", "cellContent": "title"},
    "roadmap": {"density": "medium", "relationEmphasis": "medium", "annotationStyle": "editorial", "cellContent": "title-status"},
    "comparison": {"density": "medium", "relationEmphasis": "low", "annotationStyle": "editorial", "cellContent": "title"},
    "technical": {"density": "compact", "relationEmphasis": "high", "annotationStyle": "label", "cellContent": "title"},
    "minimal": {"density": "loose", "relationEmphasis": "low", "annotationStyle": "editorial", "cellContent": "title"},
}


class HexMapError(RuntimeError):
    def __init__(self, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.code, self.details = code, details


def safe_relative_path(value: str | Path, *, field: str = "path") -> Path:
    """Validate a workspace-relative path before resolving it.

    Absolute paths, traversal, NUL bytes and Windows drive prefixes are
    rejected even when running on POSIX.  This is used for source paths and
    archive members, where a lexical check must happen before filesystem
    resolution.
    """
    text = str(value)
    if not text or "\x00" in text:
        raise HexMapError("HEXMAP_INPUT_INVALID", f"Invalid {field}")
    if text.startswith(("/", "\\")) or (len(text) > 1 and text[1] == ":"):
        raise HexMapError("HEXMAP_INPUT_INVALID", f"Absolute {field} is not allowed: {text}")
    normalized = posixpath.normpath(text.replace("\\", "/"))
    if normalized in {".", ""} or normalized == ".." or normalized.startswith("../"):
        raise HexMapError("HEXMAP_INPUT_INVALID", f"Unsafe {field}: {text}")
    return Path(normalized)


def safe_target(root: Path | str, relative: str | Path, *, field: str = "path") -> Path:
    root_path = Path(root).expanduser().resolve()
    rel = safe_relative_path(relative, field=field)
    target = (root_path / rel).resolve()
    if target != root_path and root_path not in target.parents:
        raise HexMapError("HEXMAP_INPUT_INVALID", f"Unsafe {field}: {relative}")
    return target


def validate_path(value: str | Path, *, root: Path | str | None = None, field: str = "path") -> Path:
    """Public path-validation helper used by integrations and MCP clients."""
    return safe_target(root, value, field=field) if root is not None else safe_relative_path(value, field=field)


def assert_supported_version(value: Any, *, kind: str = "schema") -> str:
    """Fail closed for malformed, future or unknown major/minor versions."""
    text = str(value or "")
    try:
        parser = lambda item: tuple(int(part) for part in re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", str(item)).groups())
        parsed = parser(text)
        expected = parser(SCHEMA_VERSION if kind == "schema" else WORKSPACE_VERSION)
    except Exception as exc:
        raise HexMapError("HEXMAP_VERSION_UNSUPPORTED", f"Unsupported {kind} version: {text!r}") from exc
    if parsed != expected:
        raise HexMapError("HEXMAP_VERSION_UNSUPPORTED", f"Unsupported {kind} version: {text}; expected {SCHEMA_VERSION if kind == 'schema' else WORKSPACE_VERSION}")
    return text


def project_root() -> Path:
    env = os.environ.get("HEXMAP_HOME")
    candidates = [Path(env)] if env else []
    module_root = Path(__file__).resolve().parent
    candidates += [module_root, module_root / "share/hexmap-studio", Path(sys.prefix) / "share/hexmap-studio", Path.cwd()]
    for candidate in candidates:
        for path in [candidate, *candidate.parents]:
            if (path / "schemas/hexmap.schema.json").exists() and ((path / "preview-inline.html").exists() or (path / "web/preview-inline.html").exists()):
                return path
    raise HexMapError("HEXMAP_WORKSPACE_INVALID", "HexMap runtime not found; install the package or set HEXMAP_HOME")


def envelope(operation: str, *, data: Any = None, artifacts: Iterable[Path | str] = (), diagnostics: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"ok": True, "operation": operation, "version": VERSION, "artifacts": [str(item) for item in artifacts], "diagnostics": diagnostics or [], "data": data}


def atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def atomic_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def atomic_json(path: Path, value: Any) -> None:
    atomic_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def slugify(value: str) -> str:
    import re
    from unicodedata import normalize
    value = normalize("NFD", value).encode("ascii", "ignore").decode().lower().strip()
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-") or "item"


def split_markdown(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text.strip()
    parts = text.split("---", 2)
    if len(parts) < 3:
        raise HexMapError("HEXMAP_INPUT_INVALID", "Unclosed YAML frontmatter")
    try:
        metadata = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError as exc:
        raise HexMapError("HEXMAP_INPUT_INVALID", f"Invalid YAML frontmatter: {exc}") from exc
    if not isinstance(metadata, dict):
        raise HexMapError("HEXMAP_INPUT_INVALID", "Frontmatter must be a YAML mapping")
    return metadata, parts[2].strip()


def parse_note(path: Path, root: Path) -> dict[str, Any]:
    metadata, body = split_markdown(path.read_text(encoding="utf-8"))
    relative = path.relative_to(root).as_posix()
    heading = next((line[2:].strip() for line in body.splitlines() if line.startswith("# ")), None)
    note_id = str(metadata.get("id") or slugify(relative.removesuffix(".md")))
    tags = metadata.get("tags", [])
    if not isinstance(tags, list): tags = [tags]
    return {
        "id": note_id, "title": str(metadata.get("title") or heading or path.stem),
        "summary": str(metadata.get("summary") or ""), "cluster": str(metadata["cluster"]) if metadata.get("cluster") else None,
        "tags": [str(item) for item in tags], "visual": metadata.get("visual") if isinstance(metadata.get("visual"), dict) else None,
        "fields": {key: value for key, value in metadata.items() if key not in RESERVED},
        "bodyMarkdown": body, "sourcePath": relative, "originalFrontmatter": metadata,
    }


VIEW_MODES = {"territories", "mosaic", "axes"}
ENDPOINT_TYPES = {"hexagon", "cluster"}
RELATION_STYLES = {"curve", "edge"}


def default_layout(mode: str = "territories") -> dict[str, Any]:
    if mode not in VIEW_MODES:
        raise HexMapError("HEXMAP_INPUT_INVALID", f"Unknown view mode: {mode}")
    return {"type": "axes" if mode == "axes" else "free", "mode": mode,
            "showClusterHulls": mode == "territories",
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "axes": {"xLabel": "Eixo X", "xMin": 0, "xMax": 10,
                     "yLabel": "Eixo Y", "yMin": 0, "yMax": 100,
                     "frame": {"x": 250, "y": 170, "width": 1700, "height": 980}}}


def normalize_presentation(map_data: dict[str, Any], *, sync_active: bool = False) -> dict[str, Any]:
    """Return a copy with the small, backwards-compatible view contract filled.

    ``layout`` remains the materialized active view for old clients.  New
    clients may persist multiple views without duplicating Markdown content.
    """
    result = copy.deepcopy(map_data)
    layout = result.get("layout")
    if not isinstance(layout, dict):
        raise HexMapError("HEXMAP_INPUT_INVALID", "layout must be an object")
    inferred_mode = "axes" if layout.get("type") == "axes" else "territories"
    mode = layout.setdefault("mode", inferred_mode)
    if mode not in VIEW_MODES:
        raise HexMapError("HEXMAP_INPUT_INVALID", f"Unknown view mode: {mode}")
    layout.setdefault("type", "axes" if mode == "axes" else "free")
    layout.setdefault("showClusterHulls", mode == "territories")
    if not isinstance(layout["showClusterHulls"], bool):
        raise HexMapError("HEXMAP_INPUT_INVALID", "showClusterHulls must be boolean")

    views = result.get("views")
    if views is None:
        views = [{"id": "main", "title": "Mapa principal", "mode": mode,
                  "showClusterHulls": layout["showClusterHulls"],
                  "layout": copy.deepcopy(layout)}]
        result["views"] = views
    if not isinstance(views, list) or not views:
        raise HexMapError("HEXMAP_INPUT_INVALID", "views must be a non-empty array")
    seen: set[str] = set()
    for index, view in enumerate(views, start=1):
        if not isinstance(view, dict):
            raise HexMapError("HEXMAP_INPUT_INVALID", f"view {index} must be an object")
        view_id = str(view.get("id") or "")
        if not view_id or view_id in seen:
            raise HexMapError("HEXMAP_INPUT_INVALID", f"view {index} has missing or duplicate id")
        seen.add(view_id)
        view_mode = view.get("mode", "territories")
        if view_mode not in VIEW_MODES:
            raise HexMapError("HEXMAP_INPUT_INVALID", f"Unknown view mode: {view_mode}")
        view.setdefault("title", view_id)
        view.setdefault("showClusterHulls", view_mode == "territories")
        if not isinstance(view["showClusterHulls"], bool):
            raise HexMapError("HEXMAP_INPUT_INVALID", f"view {view_id} showClusterHulls must be boolean")
        view_layout = view.get("layout")
        if not isinstance(view_layout, dict):
            raise HexMapError("HEXMAP_INPUT_INVALID", f"view {view_id} layout must be an object")
        view_layout.setdefault("mode", view_mode)
        view_layout.setdefault("showClusterHulls", view["showClusterHulls"])
        view_layout.setdefault("type", "axes" if view_mode == "axes" else "free")
        view_layout.setdefault("viewport", {"x": 0, "y": 0, "zoom": 1})
        view_layout.setdefault("axes", copy.deepcopy(default_layout("axes")["axes"]))
        if view_layout["mode"] != view_mode or view_layout["showClusterHulls"] != view["showClusterHulls"]:
            raise HexMapError("HEXMAP_INPUT_INVALID", f"view {view_id} presentation fields disagree with its layout")
        expected_type = "axes" if view_mode == "axes" else "free"
        if view_layout["type"] != expected_type:
            raise HexMapError("HEXMAP_INPUT_INVALID", f"view {view_id} mode {view_mode} requires layout type {expected_type}")

    active_id = str(result.get("activeViewId") or views[0]["id"])
    if active_id not in seen:
        raise HexMapError("HEXMAP_INPUT_INVALID", f"Unknown active view: {active_id}")
    result["activeViewId"] = active_id
    if sync_active:
        active = next(view for view in views if view["id"] == active_id)
        active["mode"] = mode
        active["showClusterHulls"] = layout["showClusterHulls"]
        active["layout"] = copy.deepcopy(layout)
    return result


def select_view(map_data: dict[str, Any], view_id: str | None = None) -> dict[str, Any]:
    """Materialize one named view without changing semantic map content."""
    result = normalize_presentation(map_data)
    selected_id = view_id or result["activeViewId"]
    selected = next((view for view in result["views"] if view["id"] == selected_id), None)
    if selected is None:
        raise HexMapError("HEXMAP_INPUT_INVALID", f"Unknown view: {selected_id}")
    result["activeViewId"] = selected_id
    result["layout"] = copy.deepcopy(selected["layout"])
    result["layout"]["mode"] = selected["mode"]
    result["layout"]["showClusterHulls"] = selected["showClusterHulls"]
    return result


def _hex_distance(first: dict[str, Any], second: dict[str, Any]) -> int:
    aq, ar = int(first.get("q", 0)), int(first.get("r", 0))
    bq, br = int(second.get("q", 0)), int(second.get("r", 0))
    dq, dr = aq - bq, ar - br
    return max(abs(dq), abs(dr), abs(dq + dr))


def normalize_relations(map_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize endpoints and reject ambiguous or impossible topology."""
    hexagons = {str(item.get("id")): item for item in map_data.get("hexagons", [])}
    clusters = {str(item.get("id")): item for item in map_data.get("clusters", [])}
    collisions = set(hexagons) & set(clusters)
    if collisions:
        raise HexMapError("HEXMAP_DUPLICATE_ID", f"IDs must be unique across hexagons and clusters: {', '.join(sorted(collisions))}")
    catalogs = {"hexagon": hexagons, "cluster": clusters}
    result: list[dict[str, Any]] = []
    for index, source_relation in enumerate(map_data.get("relations", []), start=1):
        if not isinstance(source_relation, dict):
            raise HexMapError("HEXMAP_INPUT_INVALID", f"Relation {index} must be an object")
        relation = copy.deepcopy(source_relation)
        relation_id = str(relation.get("id") or f"relation-{index}")
        source, target = str(relation.get("source") or ""), str(relation.get("target") or "")
        for side, endpoint in (("source", source), ("target", target)):
            declared = relation.get(f"{side}Type")
            matches = [kind for kind, catalog in catalogs.items() if endpoint in catalog]
            if declared is None:
                if len(matches) != 1:
                    raise HexMapError("HEXMAP_RELATION_ORPHAN", f"Relation {relation_id} has unknown {side}: {endpoint}")
                declared = matches[0]
                relation[f"{side}Type"] = declared
            if declared not in ENDPOINT_TYPES or endpoint not in catalogs.get(str(declared), {}):
                raise HexMapError("HEXMAP_RELATION_ORPHAN", f"Relation {relation_id} {side} does not match {declared}: {endpoint}")
        style = relation.setdefault("style", "curve")
        if style not in RELATION_STYLES:
            raise HexMapError("HEXMAP_INPUT_INVALID", f"Relation {relation_id} has unknown style: {style}")
        if style == "edge":
            if relation["sourceType"] != "hexagon" or relation["targetType"] != "hexagon":
                raise HexMapError("HEXMAP_RELATION_NOT_ADJACENT", f"Edge relation {relation_id} must connect two hexagons")
            if source == target or _hex_distance(hexagons[source], hexagons[target]) != 1:
                raise HexMapError("HEXMAP_RELATION_NOT_ADJACENT", f"Edge relation {relation_id} must connect adjacent hexagons")
        result.append(relation)
    return result


def _view_filename(view_id: str) -> str:
    digest = hashlib.sha256(view_id.encode("utf-8")).hexdigest()[:8]
    return f"{slugify(view_id)}-{digest}.json"


def default_visual() -> dict[str, Any]:
    return {"mode": "text", "image": {"src": "", "fit": "cover", "position": "50% 50%", "overlay": .38}}


def infer_fields(notes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, list[Any]] = {}
    for note in notes:
        for key, value in note["fields"].items(): seen.setdefault(key, []).append(value)
    output = []
    for key, values in seen.items():
        sample = next((item for item in values if item is not None), "")
        kind = "boolean" if isinstance(sample, bool) else "number" if isinstance(sample, (int, float)) else "multi-select" if isinstance(sample, list) else "text"
        output.append({"key": slugify(key), "label": key.replace("-", " ").replace("_", " ").title(), "type": kind})
    return output


def load_workspace(directory: Path | str) -> tuple[dict[str, Any], dict[str, Any]]:
    root = Path(directory).resolve()
    if not root.is_dir(): raise HexMapError("HEXMAP_WORKSPACE_INVALID", f"Not a directory: {root}")
    project: dict[str, Any] = {}
    if (root / PROJECT_PATH).exists():
        try: project = yaml.safe_load((root / PROJECT_PATH).read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc: raise HexMapError("HEXMAP_INPUT_INVALID", f"Invalid hexmap.yaml: {exc}") from exc
        if not isinstance(project, dict): raise HexMapError("HEXMAP_INPUT_INVALID", "hexmap.yaml must contain an object")
        if project.get("version") is not None: assert_supported_version(project["version"], kind="workspace")
    manifest: dict[str, Any] = {}
    if (root / MANIFEST_PATH).exists():
        try: manifest = json.loads((root / MANIFEST_PATH).read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc: raise HexMapError("HEXMAP_INPUT_INVALID", f"Invalid manifest: {exc}") from exc
        if not isinstance(manifest, dict): raise HexMapError("HEXMAP_INPUT_INVALID", "Manifest must contain an object")
        if manifest.get("schemaVersion") is not None: assert_supported_version(manifest["schemaVersion"], kind="schema")
        if manifest.get("workspaceVersion") is not None: assert_supported_version(manifest["workspaceVersion"], kind="workspace")
    persisted_views: dict[str, dict[str, Any]] = {}
    views_root = root / VIEWS_PATH
    if views_root.is_dir():
        for view_path in sorted(views_root.glob("*.json")):
            try: view = json.loads(view_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc: raise HexMapError("HEXMAP_INPUT_INVALID", f"Invalid view: {view_path.name}: {exc}") from exc
            if not isinstance(view, dict) or not view.get("id"):
                raise HexMapError("HEXMAP_INPUT_INVALID", f"View file must contain an object with id: {view_path.name}")
            view_id = str(view["id"])
            if view_id in persisted_views:
                raise HexMapError("HEXMAP_DUPLICATE_ID", f"Duplicate view ID: {view_id}")
            persisted_views[view_id] = view
    compiled_views = manifest.get("views") if isinstance(manifest.get("views"), list) else []
    declared_view_ids = {str(view.get("id")) for view in compiled_views if isinstance(view, dict) and view.get("id")}
    if declared_view_ids:
        persisted_views = {key: value for key, value in persisted_views.items() if key in declared_view_ids}
    merged_views = {str(view.get("id")): copy.deepcopy(view) for view in compiled_views if isinstance(view, dict) and view.get("id")}
    merged_views.update(persisted_views)
    paths = []
    for path in sorted(root.rglob("*.md")):
        if ".hexmap" in path.parts or ".git" in path.parts: continue
        if path.is_symlink() and root not in path.resolve().parents:
            raise HexMapError("HEXMAP_INPUT_INVALID", f"Source symlink escapes workspace: {path.name}")
        try:
            size = path.stat().st_size
        except OSError as exc:
            raise HexMapError("HEXMAP_INPUT_INVALID", f"Cannot stat source: {path}") from exc
        if size > MAX_WORKSPACE_FILE_BYTES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", f"Source note exceeds {MAX_WORKSPACE_FILE_BYTES} bytes: {path.name}")
        paths.append(path)
    if len(paths) > MAX_WORKSPACE_NOTES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", f"Workspace exceeds {MAX_WORKSPACE_NOTES} Markdown notes")
    notes = [parse_note(path, root) for path in paths]
    duplicate_ids = sorted({note["id"] for note in notes if sum(other["id"] == note["id"] for other in notes) > 1})
    if duplicate_ids: raise HexMapError("HEXMAP_DUPLICATE_ID", f"Duplicate note IDs: {', '.join(duplicate_ids)}")
    saved = {item.get("id"): item for item in manifest.get("hexagons", [])}
    cluster_ids = list(dict.fromkeys(note["cluster"] for note in notes if note["cluster"]))
    old_clusters = {item.get("id"): item for item in manifest.get("clusters", [])}
    clusters = []
    for index, cluster_id in enumerate(cluster_ids):
        clusters.append({"id": cluster_id, "title": old_clusters.get(cluster_id, {}).get("title", cluster_id.replace("-", " ").title()), "description": old_clusters.get(cluster_id, {}).get("description", ""), "bodyMarkdown": old_clusters.get(cluster_id, {}).get("bodyMarkdown", ""), "tags": old_clusters.get(cluster_id, {}).get("tags", []), "fields": old_clusters.get(cluster_id, {}).get("fields", {}), "color": old_clusters.get(cluster_id, {}).get("color", PALETTE[index % len(PALETTE)]), "label": old_clusters.get(cluster_id, {}).get("label", {"mode": "auto", "offsetX": 0, "offsetY": 0})})
    hexagons = []
    occupied: set[tuple[int, int]] = set()
    for index, note in enumerate(notes):
        previous = saved.get(note["id"], {})
        q, r = previous.get("q", index), previous.get("r", 0)
        while (int(q), int(r)) in occupied: q = int(q) + 1
        occupied.add((int(q), int(r)))
        visual = default_visual(); visual.update(previous.get("visual", {})); visual.update(note["visual"] or {})
        hexagons.append({"id": note["id"], "title": note["title"], "summary": note["summary"], "description": note["summary"], "bodyMarkdown": note["bodyMarkdown"], "tags": note["tags"], "fields": note["fields"], "visual": visual, "q": int(q), "r": int(r), "clusterId": note["cluster"] or previous.get("clusterId"), "axisPosition": previous.get("axisPosition"), "sourcePath": note["sourcePath"]})
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    relations = copy.deepcopy(manifest.get("relations", []))
    result = {"$schema": "./schemas/hexmap.schema.json", "schemaVersion": manifest.get("schemaVersion", SCHEMA_VERSION), "workspaceVersion": manifest.get("workspaceVersion", WORKSPACE_VERSION), "id": project.get("id", manifest.get("id", slugify(root.name))), "title": project.get("title", manifest.get("title", root.name)), "description": project.get("description", manifest.get("description", "")), "metadata": copy.deepcopy(project.get("metadata", manifest.get("metadata", {}))) if isinstance(project.get("metadata", manifest.get("metadata", {})), dict) else {}, "createdAt": manifest.get("createdAt", now), "updatedAt": now, "layout": manifest.get("layout", default_layout()), "activeViewId": manifest.get("activeViewId"), "views": list(merged_views.values()) if merged_views else None, "fieldDefinitions": manifest.get("fieldDefinitions") or infer_fields(notes), "styleRules": manifest.get("styleRules", {"colorByField": None, "colorMap": {}}), "hexagons": hexagons, "clusters": clusters, "relations": relations, "annotations": manifest.get("annotations", []), "nextEntity": len(hexagons)+1, "nextCluster": len(clusters)+1, "nextRelation": len(manifest.get("relations", []))+1, "nextAnnotation": len(manifest.get("annotations", []))+1, "paletteCursor": len(clusters)}
    if result["activeViewId"] is None: result.pop("activeViewId")
    if result["views"] is None: result.pop("views")
    result = normalize_presentation(result)
    result["relations"] = normalize_relations(result)
    diagnostics = [{"severity": "warning", "code": "HEXMAP_SOURCE_MISSING", "message": f"Source missing for {item.get('id')}"} for item in manifest.get("hexagons", []) if item.get("id") not in {n["id"] for n in notes}]
    return result, {"root": root, "project": project, "manifest": manifest, "notes": notes, "diagnostics": diagnostics}


def layout_manifest(map_data: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_presentation(map_data, sync_active=True)
    normalized["relations"] = normalize_relations(normalized)
    return {key: copy.deepcopy(normalized[key]) for key in ("workspaceVersion", "schemaVersion", "id", "title", "description", "metadata", "createdAt", "updatedAt", "layout", "activeViewId", "views", "fieldDefinitions", "styleRules", "clusters", "relations", "annotations") if key in normalized} | {"hexagons": [{key: copy.deepcopy(item.get(key)) for key in ("id", "sourcePath", "q", "r", "clusterId", "axisPosition", "visual")} for item in normalized["hexagons"]]}


def serialize_note(item: dict[str, Any]) -> str:
    metadata = copy.deepcopy(item.get("fields", {})); metadata["id"] = item["id"]; metadata["title"] = item["title"]
    if item.get("summary"): metadata["summary"] = item["summary"]
    if item.get("clusterId"): metadata["cluster"] = item["clusterId"]
    if item.get("tags"): metadata["tags"] = item["tags"]
    visual = item.get("visual", {})
    if visual.get("mode") != "text" or visual.get("image", {}).get("src"): metadata["visual"] = visual
    return "---\n" + yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False).strip() + "\n---\n\n" + item.get("bodyMarkdown", "").strip() + "\n"


def save_workspace(directory: Path | str, map_data: dict[str, Any], *, dry_run: bool = False) -> list[Path]:
    root = Path(directory).expanduser().resolve()
    if not isinstance(map_data, dict): raise HexMapError("HEXMAP_INPUT_INVALID", "Map must be an object")
    assert_supported_version(map_data.get("schemaVersion", SCHEMA_VERSION), kind="schema")
    assert_supported_version(map_data.get("workspaceVersion", WORKSPACE_VERSION), kind="workspace")
    if len(map_data.get("hexagons", [])) > MAX_WORKSPACE_NOTES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", "Workspace exceeds note limit")
    normalized = normalize_presentation(map_data, sync_active=True)
    artifacts = [root / MANIFEST_PATH, root / PROJECT_PATH]
    project = {"version": WORKSPACE_VERSION, "id": map_data["id"], "title": map_data["title"], "description": map_data.get("description", ""), "metadata": copy.deepcopy(map_data.get("metadata", {})), "notes": ["**/*.md"], "manifest": MANIFEST_PATH.as_posix(), "preset": map_data.get("styleRules", {}).get("preset", "editorial")}
    if not dry_run:
        atomic_json(root / MANIFEST_PATH, layout_manifest(normalized))
        atomic_text(root / PROJECT_PATH, yaml.safe_dump(project, allow_unicode=True, sort_keys=False))
    for view in normalized["views"]:
        target = root / VIEWS_PATH / _view_filename(view["id"])
        artifacts.append(target)
        if not dry_run: atomic_json(target, view)
    for item in map_data.get("hexagons", []):
        relative = safe_relative_path(item.get("sourcePath") or f"notas/{slugify(item['title'])}.md", field="sourcePath"); item["sourcePath"] = relative.as_posix(); target = safe_target(root, relative, field="sourcePath")
        artifacts.append(target)
        if not dry_run: atomic_text(target, serialize_note(item))
    return artifacts


def init_workspace(directory: Path | str, title: str, *, dry_run: bool = False) -> list[Path]:
    root = Path(directory).resolve()
    if root.exists() and any(root.iterdir()): raise HexMapError("HEXMAP_OPERATION_FAILED", f"Workspace directory is not empty: {root}")
    map_data = normalize_presentation({"$schema": "./schemas/hexmap.schema.json", "schemaVersion": SCHEMA_VERSION, "workspaceVersion": WORKSPACE_VERSION, "id": slugify(title), "title": title, "description": "", "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(), "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "layout": default_layout(), "fieldDefinitions": [], "styleRules": {"colorByField": None, "colorMap": {}, "preset": "editorial", "presetConfig": PRESETS["editorial"]}, "hexagons": [], "clusters": [], "relations": [], "annotations": [], "nextEntity": 1, "nextCluster": 1, "nextRelation": 1, "nextAnnotation": 1, "paletteCursor": 0})
    if not dry_run: root.mkdir(parents=True, exist_ok=True)
    return save_workspace(root, map_data, dry_run=dry_run)


def hex_disk(radius: int) -> list[tuple[int, int]]:
    cells = [(q, r) for q in range(-radius, radius+1) for r in range(-radius, radius+1) if max(abs(q), abs(r), abs(-q-r)) <= radius]
    return sorted(cells, key=lambda cell: (max(abs(cell[0]), abs(cell[1]), abs(-cell[0]-cell[1])), math.atan2(cell[1], cell[0]), cell))


def scalable_compose(map_data: dict[str, Any], preset: str = "editorial", seed: int = 0) -> dict[str, Any]:
    if preset not in PRESETS: raise HexMapError("HEXMAP_INPUT_INVALID", f"Unknown preset: {preset}")
    result = copy.deepcopy(map_data); groups: list[tuple[str | None, list[dict[str, Any]]]] = []
    for cluster in result.get("clusters", []): groups.append((cluster["id"], [item for item in result["hexagons"] if item.get("clusterId") == cluster["id"]]))
    ungrouped = [item for item in result["hexagons"] if not item.get("clusterId")]
    if ungrouped: groups.append((None, ungrouped))
    radii = [max(1, math.ceil((math.sqrt(max(1, len(items))*12-3)-3)/6)) for _, items in groups]
    columns = max(1, math.ceil(math.sqrt(len(groups))))
    max_radius = max(radii, default=1); spacing = max_radius * 2 + 3
    for index, ((_, items), radius) in enumerate(zip(groups, radii)):
        row, col = divmod(index, columns); center_r = (row - (math.ceil(len(groups)/columns)-1)/2) * spacing; center_q = (col - (columns-1)/2) * spacing - center_r / 2
        cells = hex_disk(radius)
        for item, (dq, dr) in zip(sorted(items, key=lambda value: value["id"]), cells): item["q"], item["r"] = round(center_q)+dq, round(center_r)+dr
    result["layout"]["type"] = "free"; result["layout"]["viewport"] = {"x": 0, "y": 0, "zoom": 1}
    result.setdefault("styleRules", {})["preset"] = preset; result["styleRules"]["presetConfig"] = PRESETS[preset]
    for relation in result.get("relations", []): relation["routing"] = {"mode": "auto", "offset": {"along": 0, "perpendicular": .2}}
    return result


def semantic_lod(map_data: dict[str, Any], scale: float) -> str:
    if scale < .48: return "overview"
    if scale < .72: return "medium"
    return "detail"


def render_project(map_data: dict[str, Any], output: Path | str, asset_root: Path | str | None = None) -> Path:
    rendered_map = copy.deepcopy(map_data)
    if asset_root:
        root = Path(asset_root).resolve()
        for item in rendered_map.get("hexagons", []):
            src = item.get("visual", {}).get("image", {}).get("src", "")
            if src and not src.startswith(("data:", "http://", "https://")):
                asset = (root / src).resolve()
                if not asset.is_file():
                    fallback = (project_root() / src).resolve()
                    if fallback.is_file(): asset = fallback
                runtime = project_root()
                if asset.is_file() and (root in asset.parents or runtime in asset.parents):
                    mime = mimetypes.guess_type(asset.name)[0] or "application/octet-stream"
                    item["visual"]["image"]["src"] = f"data:{mime};base64,{base64.b64encode(asset.read_bytes()).decode()}"
    runtime = project_root(); template_path = runtime / "preview-inline.html"
    if not template_path.exists(): template_path = runtime / "web/preview-inline.html"
    template = template_path.read_text(encoding="utf-8")
    payload = json.dumps(rendered_map, ensure_ascii=False).replace("</", "<\\/")
    bootstrap = f'<script>window.addEventListener("load",()=>HexMapStudio.setMap({payload}));</script>'
    rendered = template.replace("</body>", bootstrap + "</body>")
    target = Path(output).resolve(); atomic_text(target, rendered); return target


def screenshot_project(html_path: Path | str, output_dir: Path | str, viewports: Iterable[str] = ("desktop", "tablet", "mobile")) -> list[Path]:
    try: from playwright.sync_api import sync_playwright
    except ImportError as exc: raise HexMapError("HEXMAP_DEPENDENCY_MISSING", "Install hexmap-studio[visual]") from exc
    sizes = {"desktop": (1440, 900), "tablet": (1024, 768), "mobile": (390, 844)}
    targets = []; out = Path(output_dir).resolve(); out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        candidates = [Path("/usr/bin/chromium"), Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), Path("/Applications/Chromium.app/Contents/MacOS/Chromium")]
        executable = next((str(path) for path in candidates if path.exists()), None)
        browser = playwright.chromium.launch(headless=True, executable_path=executable, args=["--no-sandbox"])
        for name in viewports:
            if name not in sizes: raise HexMapError("HEXMAP_INPUT_INVALID", f"Unknown viewport: {name}")
            width, height = sizes[name]; page = browser.new_page(viewport={"width": width, "height": height}); errors: list[str] = []
            page.on("console", lambda message, state=name: errors.append(f"{state}:console:{message.text}") if message.type == "error" else None)
            page.on("pageerror", lambda error, state=name: errors.append(f"{state}:page:{error}"))
            page.on("response", lambda response, state=name: errors.append(f"{state}:http:{response.status}:{response.url}") if response.status >= 400 else None)
            page.goto(Path(html_path).resolve().as_uri(), wait_until="load"); page.wait_for_timeout(300)
            target = out / f"{name}-{width}x{height}.png"; page.screenshot(path=str(target), animations="disabled"); targets.append(target); page.close()
            if errors: browser.close(); raise HexMapError("HEXMAP_RENDER_FAILED", "Browser errors during capture", errors)
        browser.close()
    return targets


def audit_map(map_data: dict[str, Any]) -> dict[str, Any]:
    ids: dict[str, set[str]] = {}; diagnostics: list[dict[str, Any]] = []
    for kind in ("hexagons", "clusters", "relations", "annotations"):
        values = [str(item.get("id", "")) for item in map_data.get(kind, [])]; ids[kind] = set(values)
        for value in set(values):
            if values.count(value) > 1: diagnostics.append({"severity": "error", "code": "HEXMAP_DUPLICATE_ID", "message": f"Duplicate {kind} ID: {value}"})
    occupied: dict[tuple[int, int], list[str]] = {}
    for item in map_data.get("hexagons", []): occupied.setdefault((item.get("q", 0), item.get("r", 0)), []).append(item.get("id", ""))
    for cell, values in occupied.items():
        if len(values) > 1: diagnostics.append({"severity": "error", "code": "HEXMAP_LAYOUT_OVERLAP", "message": f"Overlap at {cell}: {', '.join(values)}"})
    cluster_ids = ids.get("clusters", set())
    try:
        normalize_relations(map_data)
    except HexMapError as error:
        diagnostics.append({"severity": "error", "code": error.code, "message": str(error)})
    count = len(map_data.get("hexagons", [])); overview_risk = count > 120
    if overview_risk: diagnostics.append({"severity": "warning", "code": "HEXMAP_LOD_RECOMMENDED", "message": f"Large map ({count} cells) requires semantic LOD"})
    return {"verdict": "REJECT" if any(item["severity"] == "error" for item in diagnostics) else "ACCEPT_WITH_GAPS" if diagnostics else "PASS", "metrics": {"hexagons": count, "clusters": len(cluster_ids), "occupiedCells": len(occupied), "preset": map_data.get("styleRules", {}).get("preset")}, "diagnostics": diagnostics}


def _file_digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _workspace_files(root: Path) -> list[tuple[Path, bytes]]:
    if not root.is_dir(): raise HexMapError("HEXMAP_WORKSPACE_INVALID", f"Not a directory: {root}")
    members: list[tuple[Path, bytes]] = []
    total = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or ".git" in path.parts or ".hexmap/backups" in path.as_posix(): continue
        relative = path.relative_to(root)
        if relative != PROJECT_PATH and relative != MANIFEST_PATH and relative.suffix.lower() not in {".md", ".yaml", ".yml", ".json", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}:
            continue
        if path.is_symlink() and root not in path.resolve().parents:
            raise HexMapError("HEXMAP_INPUT_INVALID", f"Workspace file escapes root: {relative}")
        safe_relative_path(relative, field="bundle path")
        size = path.stat().st_size
        if size > MAX_WORKSPACE_FILE_BYTES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", f"File exceeds {MAX_WORKSPACE_FILE_BYTES} bytes: {relative}")
        content = path.read_bytes(); total += len(content)
        if total > MAX_WORKSPACE_BYTES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", f"Workspace exceeds {MAX_WORKSPACE_BYTES} bytes")
        members.append((relative, content))
    if len(members) > MAX_WORKSPACE_FILES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", f"Workspace exceeds {MAX_WORKSPACE_FILES} files")
    return members


def export_bundle(directory: Path | str, output: Path | str) -> Path:
    """Create a checksummed JSON or ZIP workspace bundle.

    JSON remains the default for compatibility with 10.1.0.  A ``.zip``
    target preserves binary assets and carries the same manifest/checksums.
    """
    root = Path(directory).expanduser().resolve(); members = _workspace_files(root)
    target = Path(output).expanduser().resolve(); target.parent.mkdir(parents=True, exist_ok=True)
    manifest = {"format": "hexmap-workspace", "version": "2.0.0", "files": [{"path": relative.as_posix(), "bytes": len(content), "sha256": _file_digest(content)} for relative, content in members]}
    if target.suffix.lower() == ".zip":
        fd, temp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent); os.close(fd)
        try:
            with zipfile.ZipFile(temp_name, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                info = zipfile.ZipInfo("bundle.json", date_time=(1980, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
                for relative, content in members:
                    info = zipfile.ZipInfo(relative.as_posix(), date_time=(1980, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, content)
            os.replace(temp_name, target)
        finally:
            if os.path.exists(temp_name): os.unlink(temp_name)
    else:
        # Keep the historical ``files`` mapping for clients that consume JSON
        # bundles, while adding a strict checksum manifest for new clients.
        text_files = {}
        for relative, content in members:
            try: text_files[relative.as_posix()] = content.decode("utf-8")
            except UnicodeDecodeError: continue
        payload = {**manifest, "files": text_files, "checksums": {relative.as_posix(): _file_digest(content) for relative, content in members}}
        atomic_json(target, payload)
    if target.stat().st_size > MAX_BUNDLE_BYTES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", "Bundle exceeds maximum size")
    return target


def _read_bundle(bundle_path: Path) -> list[tuple[Path, bytes]]:
    if not bundle_path.is_file(): raise HexMapError("HEXMAP_INPUT_INVALID", f"Bundle not found: {bundle_path}")
    if bundle_path.stat().st_size > MAX_BUNDLE_BYTES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", "Bundle exceeds maximum size")
    entries: list[tuple[str, bytes, str | None]] = []
    if bundle_path.suffix.lower() == ".zip":
        try:
            with zipfile.ZipFile(bundle_path) as archive:
                infos = archive.infolist()
                if len(infos) > MAX_WORKSPACE_FILES + 1: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", "Bundle contains too many files")
                manifest_info = archive.getinfo("bundle.json")
                manifest = json.loads(archive.read(manifest_info).decode("utf-8"))
                declared_items = manifest.get("files")
                if not isinstance(declared_items, list): raise HexMapError("HEXMAP_INPUT_INVALID", "ZIP bundle manifest files must be an array")
                declared = {item.get("path"): item for item in declared_items if isinstance(item, dict) and isinstance(item.get("path"), str)}
                if len(declared) != len(declared_items): raise HexMapError("HEXMAP_INPUT_INVALID", "ZIP bundle manifest contains invalid or duplicate paths")
                actual_names = {info.filename for info in infos if info.filename != "bundle.json" and not info.is_dir()}
                if actual_names != set(declared): raise HexMapError("HEXMAP_INPUT_INVALID", "ZIP bundle files do not match its manifest")
                uncompressed_total = 0
                for info in infos:
                    if info.filename == "bundle.json": continue
                    if info.is_dir() or (info.external_attr >> 16) & 0o170000 == 0o120000:
                        raise HexMapError("HEXMAP_INPUT_INVALID", f"Archive member is not a regular file: {info.filename}")
                    if info.file_size > MAX_WORKSPACE_FILE_BYTES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", f"Archive member exceeds size limit: {info.filename}")
                    uncompressed_total += info.file_size
                    if uncompressed_total > MAX_WORKSPACE_BYTES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", "Bundle contents exceed size limit")
                    entries.append((info.filename, archive.read(info), declared.get(info.filename, {}).get("sha256")))
                if manifest.get("format") != "hexmap-workspace" or manifest.get("version") not in {"1.0.0", "2.0.0"}: raise HexMapError("HEXMAP_INPUT_INVALID", "Unsupported workspace bundle version")
        except (zipfile.BadZipFile, KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HexMapError("HEXMAP_INPUT_INVALID", "Invalid ZIP workspace bundle") from exc
    else:
        try: bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc: raise HexMapError("HEXMAP_INPUT_INVALID", "Invalid JSON workspace bundle") from exc
        if bundle.get("format") != "hexmap-workspace" or bundle.get("version", "1.0.0") not in {"1.0.0", "2.0.0"} or not isinstance(bundle.get("files"), dict): raise HexMapError("HEXMAP_INPUT_INVALID", "Invalid workspace bundle")
        checksums = bundle.get("checksums", {}) if isinstance(bundle.get("checksums", {}), dict) else {}
        for relative, content in bundle["files"].items():
            if not isinstance(content, str): raise HexMapError("HEXMAP_INPUT_INVALID", f"Bundle content must be text: {relative}")
            encoded = content.encode("utf-8")
            entries.append((str(relative), encoded, checksums.get(relative)))
    if len(entries) > MAX_WORKSPACE_FILES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", "Bundle contains too many files")
    total = 0; result: list[tuple[Path, bytes]] = []; seen: set[str] = set()
    for relative, content, expected in entries:
        path = safe_relative_path(relative, field="bundle path")
        key = path.as_posix()
        if key in seen: raise HexMapError("HEXMAP_INPUT_INVALID", f"Duplicate bundle path: {relative}")
        seen.add(key); total += len(content)
        if total > MAX_WORKSPACE_BYTES: raise HexMapError("HEXMAP_LIMIT_EXCEEDED", "Bundle contents exceed size limit")
        if expected and expected != _file_digest(content): raise HexMapError("HEXMAP_INPUT_INVALID", f"Checksum mismatch: {relative}")
        result.append((path, content))
    return result


def backup_workspace(directory: Path | str, paths: Iterable[Path] | None = None) -> list[Path]:
    root = Path(directory).expanduser().resolve()
    existing = [path for path in (paths or sorted(root.rglob("*"))) if path.is_file() and ".hexmap/backups" not in path.as_posix()]
    if not existing: return []
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_root = root / ".hexmap" / "backups" / stamp
    suffix = 0
    while backup_root.exists(): suffix += 1; backup_root = root / ".hexmap" / "backups" / f"{stamp}-{suffix}"
    artifacts: list[Path] = []
    for source in existing:
        try: relative = source.resolve().relative_to(root)
        except ValueError: continue
        target = backup_root / relative; target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source, target); artifacts.append(target)
    return artifacts


def import_bundle(bundle_path: Path | str, directory: Path | str, *, dry_run: bool = False, backup: bool = True) -> list[Path]:
    members = _read_bundle(Path(bundle_path).expanduser().resolve())
    root = Path(directory).expanduser().resolve()
    if not dry_run: root.mkdir(parents=True, exist_ok=True)
    targets = [safe_target(root, relative, field="bundle path") for relative, _ in members]
    existing = [target for target in targets if target.exists()]
    artifacts: list[Path] = []
    if not dry_run and backup: artifacts.extend(backup_workspace(root, existing))
    artifacts.extend(targets)
    if not dry_run:
        for target, (_, content) in zip(targets, members): atomic_bytes(target, content)
    return artifacts


def install_skills(target: Path | str, *, force: bool = False) -> list[Path]:
    source = project_root() / "skills"; destination = Path(target).expanduser().resolve(); destination.mkdir(parents=True, exist_ok=True)
    artifacts = []
    for skill in sorted(path for path in source.iterdir() if path.is_dir() and (path / "SKILL.md").exists()):
        output = destination / skill.name
        if output.exists() and not force: raise HexMapError("HEXMAP_OPERATION_FAILED", f"Skill already exists: {output}; use --force")
        if output.exists(): shutil.rmtree(output)
        shutil.copytree(skill, output, ignore=shutil.ignore_patterns("__pycache__", "*.pyc")); artifacts.append(output)
    return artifacts
