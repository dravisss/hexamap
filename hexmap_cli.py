#!/usr/bin/env python3
"""Deterministic helpers for HexaMap Studio JSON files.

Commands:
  init --title TITLE [-o OUTPUT]
  validate MAP.json
  normalize MAP.json [-o OUTPUT]
  audit MAP.json [--json]
  layout MAP.json --template free|axes [-o OUTPUT] [--x-field KEY --y-field KEY]
  route MAP.json [-o OUTPUT]
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

from hexmap_platform import (
    HexMapError, PRESETS, VERSION, SCHEMA_VERSION, WORKSPACE_VERSION, assert_supported_version,
    audit_map as platform_audit, backup_workspace, envelope, export_bundle, import_bundle,
    init_workspace, install_skills, load_workspace, render_project, project_root, save_workspace,
    normalize_presentation, normalize_relations, scalable_compose, screenshot_project,
)

ROOT = Path(__file__).resolve().parent
SCHEMA_PATH = ROOT / "schemas" / "hexmap.schema.json"
PALETTE = [
    "#bf7448", "#6f85ac", "#5f9887", "#a18e37", "#8f78a8", "#5f9bad",
    "#af6678", "#7a8b5f", "#aa7654", "#5d8d9a", "#8e6b9b", "#9d8150",
]
COMPACT = [
    (0,0),(1,0),(0,1),(-1,1),(-1,0),(0,-1),(1,-1),(2,-1),(2,0),(1,1),(0,2),(-1,2),
    (-2,2),(-2,1),(-2,0),(-1,-1),(0,-2),(1,-2),(2,-2),
]


def read_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(data: dict[str, Any], path: str | Path | None) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if path:
        Path(path).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "item"


def initial_map(title: str = "Mapa hexagonal") -> dict[str, Any]:
    return normalize_presentation({
        "$schema": "./schemas/hexmap.schema.json",
        "schemaVersion": "1.0.0",
        "id": slugify(title),
        "title": title,
        "description": "",
        "layout": {
            "type": "free",
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "axes": {
                "xLabel": "Eixo X", "xMin": 0, "xMax": 10,
                "yLabel": "Eixo Y", "yMin": 0, "yMax": 100,
                "frame": {"x": 250, "y": 170, "width": 1700, "height": 980},
            },
        },
        "fieldDefinitions": [],
        "styleRules": {"colorByField": None, "colorMap": {}},
        "hexagons": [], "clusters": [], "relations": [], "annotations": [],
        "nextEntity": 1, "nextCluster": 1, "nextRelation": 1, "nextAnnotation": 1,
        "paletteCursor": 0,
    })


def normalize_map(raw: dict[str, Any]) -> dict[str, Any]:
    data = copy.deepcopy(raw)
    if "hexagons" not in data and isinstance(data.get("entities"), list):
        data["hexagons"] = data.pop("entities")
    data.setdefault("$schema", "./schemas/hexmap.schema.json")
    data.setdefault("schemaVersion", "1.0.0")
    data.setdefault("id", "hexmap-imported")
    data.setdefault("title", "Mapa hexagonal")
    data.setdefault("description", "")
    data.setdefault("layout", {})
    layout = data["layout"]
    layout.setdefault("type", "free")
    layout.setdefault("viewport", {"x": 0, "y": 0, "zoom": 1})
    layout.setdefault("axes", {
        "xLabel": "Eixo X", "xMin": 0, "xMax": 10,
        "yLabel": "Eixo Y", "yMin": 0, "yMax": 100,
        "frame": {"x": 250, "y": 170, "width": 1700, "height": 980},
    })
    data.setdefault("fieldDefinitions", [])
    data.setdefault("styleRules", {"colorByField": None, "colorMap": {}})
    data["styleRules"].setdefault("colorByField", None)
    data["styleRules"].setdefault("colorMap", {})
    data.setdefault("hexagons", [])
    data.setdefault("clusters", [])
    data.setdefault("relations", [])
    data.setdefault("annotations", [])
    data.setdefault("nextEntity", 1)
    data.setdefault("nextCluster", 1)
    data.setdefault("nextRelation", 1)
    data.setdefault("nextAnnotation", 1)
    data.setdefault("paletteCursor", 0)

    for idx, item in enumerate(data["hexagons"], start=1):
        item.setdefault("id", f"hex-{idx}")
        item.setdefault("title", "Sem título")
        item.setdefault("summary", item.get("description", ""))
        item.setdefault("description", item.get("summary", ""))
        item.setdefault("bodyMarkdown", item.get("description", ""))
        item.setdefault("tags", [])
        item.setdefault("fields", {})
        item.setdefault("visual", {"mode": "text", "image": {"src": "", "fit": "cover", "position": "50% 50%", "overlay": 0.38}})
        item["visual"].setdefault("mode", "text")
        item["visual"].setdefault("image", {"src": "", "fit": "cover", "position": "50% 50%", "overlay": 0.38})
        item.setdefault("q", 0)
        item.setdefault("r", 0)
        item.setdefault("clusterId", None)
        item.setdefault("axisPosition", None)

    for idx, cluster in enumerate(data["clusters"], start=1):
        cluster.setdefault("id", f"cluster-{idx}")
        cluster.setdefault("title", "Cluster sem título")
        cluster.setdefault("description", "")
        cluster.setdefault("bodyMarkdown", cluster.get("description", ""))
        cluster.setdefault("tags", [])
        cluster.setdefault("fields", {})
        cluster.setdefault("color", PALETTE[(idx - 1) % len(PALETTE)])
        cluster.setdefault("label", {"mode": "auto", "offsetX": 0, "offsetY": 0})

    for idx, relation in enumerate(data["relations"], start=1):
        relation.setdefault("id", f"relation-{idx}")
        relation.setdefault("label", "relaciona-se")
        relation.setdefault("routing", {"mode": "auto", "offset": {"along": 0, "perpendicular": 0.2}})
        relation["routing"].setdefault("mode", "auto")
        relation["routing"].setdefault("offset", {"along": 0, "perpendicular": 0.2})

    for idx, note in enumerate(data["annotations"], start=1):
        note.setdefault("id", f"annotation-{idx}")
        note.setdefault("type", "text")
        note.setdefault("x", 300)
        note.setdefault("y", 200)
        note.setdefault("width", 320)
        note.setdefault("title", "Anotação")
        note.setdefault("bodyMarkdown", "")
        note.setdefault("style", {"variant": "editorial", "fontSize": 17, "align": "left"})
    data = normalize_presentation(data)
    data["relations"] = normalize_relations(data)
    return data


def schema_errors(data: dict[str, Any]) -> list[str]:
    try:
        import jsonschema
    except ImportError:
        return ["jsonschema não está instalado; rode apenas o audit estrutural"]
    schema = read_json(project_root() / "schemas/hexmap.schema.json")
    validator = jsonschema.Draft202012Validator(schema)
    errors = []
    for error in sorted(validator.iter_errors(data), key=lambda e: list(e.path)):
        path = ".".join(map(str, error.absolute_path)) or "$"
        errors.append(f"{path}: {error.message}")
    return errors


def structural_audit(data: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    hexagons = data.get("hexagons", [])
    clusters = data.get("clusters", [])
    relations = data.get("relations", [])
    annotations = data.get("annotations", [])
    field_defs = data.get("fieldDefinitions", [])

    def duplicates(items: list[dict[str, Any]]) -> set[str]:
        ids = [str(item.get("id", "")) for item in items]
        return {item for item in ids if ids.count(item) > 1}

    for kind, items in [("hexagon", hexagons), ("cluster", clusters), ("relation", relations), ("annotation", annotations)]:
        for dup in duplicates(items):
            issues.append({"severity": "error", "code": "duplicate-id", "message": f"ID duplicado em {kind}: {dup}"})

    cluster_ids = {item.get("id") for item in clusters}
    hex_ids = {item.get("id") for item in hexagons}
    for item in hexagons:
        cluster_id = item.get("clusterId")
        if cluster_id and cluster_id not in cluster_ids:
            issues.append({"severity": "error", "code": "orphan-cluster", "message": f"{item.get('id')} referencia cluster inexistente {cluster_id}"})
        if not str(item.get("title", "")).strip():
            issues.append({"severity": "warning", "code": "empty-title", "message": f"Hexágono {item.get('id')} sem título"})
        visual = item.get("visual", {})
        if visual.get("mode") in {"icon", "cover", "image"} and not visual.get("image", {}).get("src"):
            issues.append({"severity": "warning", "code": "missing-image", "message": f"{item.get('id')} usa modo visual com imagem, mas src está vazio"})

    try:
        normalize_relations(data)
    except HexMapError as error:
        issues.append({"severity": "error", "code": error.code.lower().replace("hexmap_", "").replace("_", "-"), "message": str(error)})
    for relation in relations:
        if relation.get("source") == relation.get("target"):
            issues.append({"severity": "warning", "code": "self-relation", "message": f"Relação {relation.get('id')} conecta um endpoint a si mesmo"})

    positions: dict[tuple[int, int], list[str]] = {}
    if data.get("layout", {}).get("type") == "free":
        for item in hexagons:
            key = (int(item.get("q", 0)), int(item.get("r", 0)))
            positions.setdefault(key, []).append(str(item.get("id")))
        for key, ids in positions.items():
            if len(ids) > 1:
                issues.append({"severity": "error", "code": "overlap", "message": f"Hexágonos sobrepostos em {key}: {', '.join(ids)}"})

    keys = [item.get("key") for item in field_defs]
    for key in set(keys):
        if keys.count(key) > 1:
            issues.append({"severity": "error", "code": "duplicate-field", "message": f"Campo duplicado: {key}"})

    for note in annotations:
        if not note.get("title") and not note.get("bodyMarkdown"):
            issues.append({"severity": "warning", "code": "empty-annotation", "message": f"Anotação {note.get('id')} vazia"})

    # Detect clusters that exist in metadata but contain no members.
    memberships = {cluster_id: 0 for cluster_id in cluster_ids}
    for item in hexagons:
        if item.get("clusterId") in memberships:
            memberships[item["clusterId"]] += 1
    for cluster_id, count in memberships.items():
        if count == 0:
            issues.append({"severity": "warning", "code": "empty-cluster", "message": f"Cluster {cluster_id} sem hexágonos"})
    return issues


def compact_layout(data: dict[str, Any]) -> None:
    clusters = data.get("clusters", [])
    hexagons = data.get("hexagons", [])
    centers = [(-8,-4),(0,-5),(8,-4),(-9,4),(0,5),(9,3),(-4,10),(5,10)]
    for index, cluster in enumerate(clusters):
        members = [item for item in hexagons if item.get("clusterId") == cluster.get("id")]
        center = centers[index] if index < len(centers) else ((index % 4) * 7 - 10, (index // 4) * 7 - 4)
        for member_index, item in enumerate(members):
            dq, dr = COMPACT[member_index % len(COMPACT)]
            item["q"] = center[0] + dq
            item["r"] = center[1] + dr
    data["layout"]["type"] = "free"


def axes_layout(data: dict[str, Any], x_field: str, y_field: str) -> None:
    values_x = [float(item.get("fields", {}).get(x_field, 0) or 0) for item in data["hexagons"]]
    values_y = [float(item.get("fields", {}).get(y_field, 0) or 0) for item in data["hexagons"]]
    min_x, max_x = min(values_x, default=0), max(values_x, default=1)
    min_y, max_y = min(values_y, default=0), max(values_y, default=1)
    if math.isclose(min_x, max_x): max_x = min_x + 1
    if math.isclose(min_y, max_y): max_y = min_y + 1
    axes = data["layout"]["axes"]
    axes.update({"xLabel": x_field, "xMin": min_x, "xMax": max_x, "yLabel": y_field, "yMin": min_y, "yMax": max_y})
    for item, x, y in zip(data["hexagons"], values_x, values_y):
        item["axisPosition"] = {"x": (x - min_x) / (max_x - min_x), "y": (y - min_y) / (max_y - min_y)}
    data["layout"]["type"] = "axes"


def cmd_init(args: argparse.Namespace) -> int:
    write_json(initial_map(args.title), args.output)
    return 0


def cmd_route(args: argparse.Namespace) -> int:
    data = normalize_map(read_json(args.map))
    for relation in data.get("relations", []):
        relation["routing"] = {"mode": "auto", "offset": {"along": 0, "perpendicular": 0.2}}
    write_json(data, args.output)
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    data = normalize_map(read_json(args.map))
    assert_supported_version(data.get("schemaVersion", SCHEMA_VERSION), kind="schema")
    errors = schema_errors(data)
    if errors:
        for item in errors:
            print(f"ERROR {item}")
        return 1
    print("PASS schema")
    return 0


def cmd_normalize(args: argparse.Namespace) -> int:
    data = normalize_map(read_json(args.map)); assert_supported_version(data.get("schemaVersion", SCHEMA_VERSION), kind="schema"); write_json(data, args.output)
    return 0


def cmd_audit(args: argparse.Namespace) -> int:
    data = normalize_map(read_json(args.map))
    assert_supported_version(data.get("schemaVersion", SCHEMA_VERSION), kind="schema")
    issues = structural_audit(data)
    payload = {"errors": sum(i["severity"] == "error" for i in issues), "warnings": sum(i["severity"] == "warning" for i in issues), "issues": issues}
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for issue in issues:
            print(f"{issue['severity'].upper()} {issue['code']}: {issue['message']}")
        print(f"SUMMARY {payload['errors']} errors · {payload['warnings']} warnings")
    return 1 if payload["errors"] else 0


def cmd_layout(args: argparse.Namespace) -> int:
    data = normalize_map(read_json(args.map))
    if args.template == "free": compact_layout(data)
    else:
        if not args.x_field or not args.y_field:
            raise SystemExit("--x-field e --y-field são obrigatórios para axes")
        axes_layout(data, args.x_field, args.y_field)
    write_json(data, args.output)
    return 0


def emit(payload: dict[str, Any], as_json: bool = False) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"PASS {payload['operation']}")
        for artifact in payload.get("artifacts", []): print(f"ARTIFACT {artifact}")


def cmd_doctor(args: argparse.Namespace) -> int:
    runtime = project_root()
    checks = {"python": sys.version.split()[0], "runtime": str(runtime), "schema": (runtime / "schemas/hexmap.schema.json").exists(), "playwright": False}
    try: import playwright  # noqa: F401
    except ImportError: pass
    else: checks["playwright"] = True
    emit(envelope("doctor", data=checks), args.json); return 0


def cmd_workspace_validate(args: argparse.Namespace) -> int:
    data, context = load_workspace(args.directory); schema = schema_errors(data); audit = platform_audit(data)
    diagnostics = context["diagnostics"] + [{"severity": "error", "code": "HEXMAP_SCHEMA_INVALID", "message": item} for item in schema] + audit["diagnostics"]
    payload = envelope("workspace.validate", data={"map": data, "verdict": "REJECT" if any(item["severity"] == "error" for item in diagnostics) else "PASS"}, diagnostics=diagnostics)
    emit(payload, args.json); return 1 if any(item["severity"] == "error" for item in diagnostics) else 0


def cmd_workspace_init(args: argparse.Namespace) -> int:
    artifacts = init_workspace(args.directory, args.title, dry_run=args.dry_run); emit(envelope("workspace.init", data={"dryRun": args.dry_run}, artifacts=artifacts), args.json); return 0


def cmd_workspace_sync(args: argparse.Namespace) -> int:
    data, context = load_workspace(args.directory); artifacts = save_workspace(args.directory, data, dry_run=args.dry_run)
    emit(envelope("workspace.sync", data={"dryRun": args.dry_run, "hexagons": len(data["hexagons"])}, artifacts=artifacts, diagnostics=context["diagnostics"]), args.json); return 0


def cmd_workspace_export(args: argparse.Namespace) -> int:
    target = export_bundle(args.directory, args.output); emit(envelope("workspace.export", artifacts=[target]), args.json); return 0


def cmd_workspace_import(args: argparse.Namespace) -> int:
    artifacts = import_bundle(args.bundle, args.directory, dry_run=args.dry_run); emit(envelope("workspace.import", data={"dryRun": args.dry_run}, artifacts=artifacts), args.json); return 0


def map_from_input(value: str) -> tuple[dict[str, Any], Path | None]:
    path = Path(value).expanduser()
    if path.is_dir(): return load_workspace(path)[0], path
    try: raw = read_json(path)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc: raise HexMapError("HEXMAP_INPUT_INVALID", f"Cannot read map: {path}") from exc
    data = normalize_map(raw)
    assert_supported_version(data.get("schemaVersion", SCHEMA_VERSION), kind="schema")
    return data, None


def cmd_compose(args: argparse.Namespace) -> int:
    data, workspace = map_from_input(args.input); composed = scalable_compose(data, args.preset, args.seed)
    artifacts = []
    if workspace:
        artifacts = save_workspace(workspace, composed, dry_run=args.dry_run)
    elif args.output and not args.dry_run:
        write_json(composed, args.output); artifacts = [Path(args.output).resolve()]
    emit(envelope("compose", data={"dryRun": args.dry_run, "preset": args.preset, "metrics": platform_audit(composed)["metrics"]}, artifacts=artifacts), args.json); return 0


def cmd_render_project(args: argparse.Namespace) -> int:
    data, workspace = map_from_input(args.input); asset_root = workspace or Path(args.input).resolve().parent; target = render_project(data, args.output, asset_root); emit(envelope("render", artifacts=[target]), args.json); return 0


def cmd_screenshot_project(args: argparse.Namespace) -> int:
    path = Path(args.input); temporary = None
    if path.suffix.lower() not in {".html", ".htm"}:
        data, workspace = map_from_input(args.input); temporary = Path(tempfile.mkdtemp(prefix="hexmap-render-")) / "index.html"; path = render_project(data, temporary, workspace or Path(args.input).resolve().parent)
    artifacts = screenshot_project(path, args.output, args.viewports.split(",")); emit(envelope("screenshot", artifacts=artifacts), args.json); return 0


def cmd_visual_audit(args: argparse.Namespace) -> int:
    data, workspace = map_from_input(args.input); result = platform_audit(data); out = Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
    html = render_project(data, out / "preview.html", workspace or Path(args.input).resolve().parent); shots = screenshot_project(html, out / "screenshots", args.viewports.split(",")) if not args.no_screenshots else []
    result["visual"] = {"viewports": args.viewports.split(","), "screenshots": [str(path) for path in shots], "consoleErrors": [], "pageErrors": [], "badResponses": []}
    atomic = out / "report.json"; atomic.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown = out / "report.md"; markdown.write_text(f"# HexMap audit\n\n**Verdict: {result['verdict']}**\n\n" + "\n".join(f"- {item['severity'].upper()} `{item['code']}` — {item['message']}" for item in result["diagnostics"]), encoding="utf-8")
    emit(envelope("audit.visual", data=result, artifacts=[html, atomic, markdown, *shots], diagnostics=result["diagnostics"]), args.json); return 1 if result["verdict"] == "REJECT" else 0


def cmd_migrate(args: argparse.Namespace) -> int:
    try:
        from migrations.registry import MigrationError, migrate_map
    except ImportError as exc:
        raise HexMapError("HEXMAP_DEPENDENCY_MISSING", "Migration registry is not installed; reinstall hexmap-studio") from exc
    source_path = Path(args.input).expanduser().resolve(); workspace = source_path if source_path.is_dir() else None
    if workspace:
        manifest = workspace / ".hexmap/map.json"
        if not manifest.exists(): raise HexMapError("HEXMAP_WORKSPACE_INVALID", "Workspace has no .hexmap/map.json")
        try: raw = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc: raise HexMapError("HEXMAP_INPUT_INVALID", "Invalid workspace manifest") from exc
    else:
        try: raw = read_json(source_path)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc: raise HexMapError("HEXMAP_INPUT_INVALID", "Invalid map input") from exc
    current = str(raw.get("schemaVersion", "0.9.0")) if isinstance(raw, dict) else ""
    try: migrated, applied = migrate_map(raw)
    except MigrationError as exc: raise HexMapError("HEXMAP_VERSION_UNSUPPORTED", str(exc)) from exc
    data = normalize_map(migrated); artifacts: list[Path] = []
    if workspace:
        if not args.no_backup and not args.dry_run: artifacts.extend(backup_workspace(workspace, [manifest]))
        artifacts += save_workspace(workspace, data, dry_run=args.dry_run)
    else:
        target = Path(args.output or args.input).expanduser().resolve(); source = source_path
        if source.exists() and target == source and not args.no_backup and not args.dry_run:
            backup = source.with_suffix(source.suffix + f".bak-{current}"); shutil.copy2(source, backup); artifacts.append(backup)
        if not args.dry_run: write_json(data, target); artifacts.append(target)
    emit(envelope("migrate", data={"from": current, "to": SCHEMA_VERSION, "applied": applied, "dryRun": args.dry_run}, artifacts=artifacts), args.json); return 0


def cmd_publish(args: argparse.Namespace) -> int:
    try:
        from hexmap_export import ExportError, publish_project
    except ImportError as exc:
        raise HexMapError("HEXMAP_DEPENDENCY_MISSING", "Publication module is not installed; reinstall hexmap-studio") from exc
    metadata = {key: value for key, value in (("author", args.author), ("license", args.license), ("source", args.source)) if value}
    formats = [item.strip().lower() for item in args.formats.split(",") if item.strip()]
    if not formats: raise HexMapError("HEXMAP_INPUT_INVALID", "At least one export format is required")
    try: artifacts = publish_project(args.input, args.output, formats=formats, metadata=metadata, view_id=args.view)
    except ExportError as error: raise HexMapError(error.code, str(error), error.details) from error
    emit(envelope("publish", data={"readOnly": True, "formats": formats}, artifacts=artifacts), args.json); return 0


def cmd_export(args: argparse.Namespace) -> int:
    try:
        from hexmap_export import ExportError, export_visual, publish_project
    except ImportError as exc:
        raise HexMapError("HEXMAP_DEPENDENCY_MISSING", "Export module is not installed; reinstall hexmap-studio") from exc
    kind = args.format.strip().lower().lstrip(".")
    try:
        if Path(args.input).expanduser().is_dir():
            artifacts = publish_project(args.input, args.output, formats=(kind,), view_id=args.view)
        else:
            data, _ = map_from_input(args.input)
            artifacts = [export_visual(data, args.output, kind)]
    except ExportError as error: raise HexMapError(error.code, str(error), error.details) from error
    emit(envelope("export", data={"format": kind, "readOnly": kind in {"html", "svg", "png", "pdf"}}, artifacts=artifacts), args.json); return 0


def cmd_skills_install(args: argparse.Namespace) -> int:
    artifacts = install_skills(args.target, force=args.force); emit(envelope("skills.install", artifacts=artifacts), args.json); return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="hexmap", description="Ferramentas determinísticas para HexaMap Studio")
    sub = p.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init"); init.add_argument("--title", default="Mapa hexagonal"); init.add_argument("-o", "--output"); init.set_defaults(func=cmd_init)
    validate = sub.add_parser("validate"); validate.add_argument("map"); validate.set_defaults(func=cmd_validate)
    normalize = sub.add_parser("normalize"); normalize.add_argument("map"); normalize.add_argument("-o", "--output"); normalize.set_defaults(func=cmd_normalize)
    audit = sub.add_parser("audit"); audit.add_argument("map"); audit.add_argument("--json", action="store_true"); audit.set_defaults(func=cmd_audit)
    layout = sub.add_parser("layout"); layout.add_argument("map"); layout.add_argument("--template", choices=["free", "axes"], required=True); layout.add_argument("--x-field"); layout.add_argument("--y-field"); layout.add_argument("-o", "--output"); layout.set_defaults(func=cmd_layout)
    route = sub.add_parser("route"); route.add_argument("map"); route.add_argument("-o", "--output"); route.set_defaults(func=cmd_route)
    doctor = sub.add_parser("doctor"); doctor.add_argument("--json", action="store_true"); doctor.set_defaults(func=cmd_doctor)
    presets = sub.add_parser("presets"); presets.add_argument("--json", action="store_true"); presets.set_defaults(func=lambda args: (emit(envelope("presets", data=PRESETS), args.json), 0)[1])
    workspace = sub.add_parser("workspace"); workspace_sub = workspace.add_subparsers(dest="workspace_command", required=True)
    workspace_init = workspace_sub.add_parser("init"); workspace_init.add_argument("directory"); workspace_init.add_argument("--title", default="Mapa hexagonal"); workspace_init.add_argument("--dry-run", action="store_true"); workspace_init.add_argument("--json", action="store_true"); workspace_init.set_defaults(func=cmd_workspace_init)
    for name, function in (("validate", cmd_workspace_validate), ("sync", cmd_workspace_sync)):
        command = workspace_sub.add_parser(name); command.add_argument("directory"); command.add_argument("--json", action="store_true")
        if name == "sync": command.add_argument("--dry-run", action="store_true")
        command.set_defaults(func=function)
    export = workspace_sub.add_parser("export"); export.add_argument("directory"); export.add_argument("-o", "--output", required=True); export.add_argument("--json", action="store_true"); export.set_defaults(func=cmd_workspace_export)
    import_cmd = workspace_sub.add_parser("import"); import_cmd.add_argument("bundle"); import_cmd.add_argument("directory"); import_cmd.add_argument("--dry-run", action="store_true"); import_cmd.add_argument("--json", action="store_true"); import_cmd.set_defaults(func=cmd_workspace_import)
    compose = sub.add_parser("compose"); compose.add_argument("input"); compose.add_argument("--preset", choices=sorted(PRESETS), default="editorial"); compose.add_argument("--seed", type=int, default=0); compose.add_argument("-o", "--output"); compose.add_argument("--dry-run", action="store_true"); compose.add_argument("--json", action="store_true"); compose.set_defaults(func=cmd_compose)
    render = sub.add_parser("render"); render.add_argument("input"); render.add_argument("-o", "--output", required=True); render.add_argument("--json", action="store_true"); render.set_defaults(func=cmd_render_project)
    screenshot = sub.add_parser("screenshot"); screenshot.add_argument("input"); screenshot.add_argument("-o", "--output", required=True); screenshot.add_argument("--viewports", default="desktop,tablet,mobile"); screenshot.add_argument("--json", action="store_true"); screenshot.set_defaults(func=cmd_screenshot_project)
    visual = sub.add_parser("visual-audit"); visual.add_argument("input"); visual.add_argument("-o", "--output", required=True); visual.add_argument("--viewports", default="desktop,tablet,mobile"); visual.add_argument("--no-screenshots", action="store_true"); visual.add_argument("--json", action="store_true"); visual.set_defaults(func=cmd_visual_audit)
    migrate = sub.add_parser("migrate"); migrate.add_argument("input"); migrate.add_argument("-o", "--output"); migrate.add_argument("--dry-run", action="store_true"); migrate.add_argument("--no-backup", action="store_true"); migrate.add_argument("--json", action="store_true"); migrate.set_defaults(func=cmd_migrate)
    publish = sub.add_parser("publish", help="Create a read-only standalone publication"); publish.add_argument("input"); publish.add_argument("-o", "--output", required=True); publish.add_argument("--formats", default="html,svg", help="Comma-separated: html,svg,png,pdf"); publish.add_argument("--view", help="Named view ID to publish"); publish.add_argument("--author"); publish.add_argument("--license"); publish.add_argument("--source"); publish.add_argument("--json", action="store_true"); publish.set_defaults(func=cmd_publish)
    export_cmd = sub.add_parser("export", help="Export one read-only visual artifact"); export_cmd.add_argument("input"); export_cmd.add_argument("-o", "--output", required=True); export_cmd.add_argument("--format", choices=["html", "svg", "png", "pdf"], default="svg"); export_cmd.add_argument("--view", help="Named view ID when input is a workspace"); export_cmd.add_argument("--json", action="store_true"); export_cmd.set_defaults(func=cmd_export)
    skills = sub.add_parser("skills"); skills_sub = skills.add_subparsers(dest="skills_command", required=True)
    install = skills_sub.add_parser("install"); install.add_argument("--target", required=True); install.add_argument("--force", action="store_true"); install.add_argument("--json", action="store_true"); install.set_defaults(func=cmd_skills_install)
    return p


def main() -> int:
    args = parser().parse_args()
    try: return int(args.func(args))
    except HexMapError as error:
        payload = {"ok": False, "operation": getattr(args, "command", "unknown"), "version": VERSION, "artifacts": [], "diagnostics": [], "error": {"code": error.code, "message": str(error), "details": error.details}}
        if getattr(args, "json", False): print(json.dumps(payload, ensure_ascii=False, indent=2))
        else: print(f"ERROR {error.code}: {error}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
