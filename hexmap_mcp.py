"""Dependency-free MCP stdio adapter for HexMap Studio.

The adapter intentionally delegates every operation to hexmap_platform so CLI
and MCP have identical behavior and error codes.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from typing import Any

from hexmap_platform import (
    HexMapError, PRESETS, VERSION, audit_map, envelope, export_bundle,
    import_bundle, init_workspace, load_workspace, render_project, save_workspace,
    scalable_compose, screenshot_project,
)
MAX_REQUEST_BYTES = 2 * 1024 * 1024

TOOLS = [
    {"name": "create_project", "description": "Create an empty portable Markdown/YAML HexMap workspace.", "inputSchema": {"type": "object", "required": ["project", "title"], "properties": {"project": {"type": "string"}, "title": {"type": "string"}, "dryRun": {"type": "boolean"}}}},
    {"name": "inspect_project", "description": "Read a Markdown HexMap workspace and return its map and diagnostics without modifying files.", "inputSchema": {"type": "object", "required": ["project"], "properties": {"project": {"type": "string"}}}},
    {"name": "validate_project", "description": "Validate workspace identities, topology and references.", "inputSchema": {"type": "object", "required": ["project"], "properties": {"project": {"type": "string"}}}},
    {"name": "compose_project", "description": "Apply scalable deterministic composition and a named visual preset.", "inputSchema": {"type": "object", "required": ["project"], "properties": {"project": {"type": "string"}, "preset": {"type": "string", "enum": sorted(PRESETS)}, "dryRun": {"type": "boolean"}}}},
    {"name": "render_project", "description": "Render any project as a standalone HTML artifact.", "inputSchema": {"type": "object", "required": ["project", "output"], "properties": {"project": {"type": "string"}, "output": {"type": "string"}}}},
    {"name": "capture_project", "description": "Capture desktop, tablet and mobile screenshots from a project.", "inputSchema": {"type": "object", "required": ["project", "output"], "properties": {"project": {"type": "string"}, "output": {"type": "string"}, "viewports": {"type": "array", "items": {"enum": ["desktop", "tablet", "mobile"]}}}}},
    {"name": "audit_project", "description": "Run structural audit and optionally capture visual evidence.", "inputSchema": {"type": "object", "required": ["project"], "properties": {"project": {"type": "string"}, "output": {"type": "string"}, "capture": {"type": "boolean"}}}},
    {"name": "export_project", "description": "Export a portable no-database workspace bundle.", "inputSchema": {"type": "object", "required": ["project", "output"], "properties": {"project": {"type": "string"}, "output": {"type": "string"}}}},
    {"name": "import_project", "description": "Import a portable bundle into a project directory.", "inputSchema": {"type": "object", "required": ["bundle", "project"], "properties": {"bundle": {"type": "string"}, "project": {"type": "string"}, "dryRun": {"type": "boolean"}}}},
    {"name": "publish_project", "description": "Create read-only standalone HTML/SVG (PNG/PDF when Playwright is installed).", "inputSchema": {"type": "object", "required": ["project", "output"], "properties": {"project": {"type": "string"}, "output": {"type": "string"}, "view": {"type": "string"}, "formats": {"type": "array", "items": {"enum": ["html", "svg", "png", "pdf"]}}, "metadata": {"type": "object"}}}},
]


def call_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(args, dict): raise HexMapError("HEXMAP_INPUT_INVALID", "Tool arguments must be an object")
    if name == "create_project":
        artifacts = init_workspace(args["project"], args["title"], dry_run=args.get("dryRun", False)); return envelope(name, data={"dryRun": args.get("dryRun", False)}, artifacts=artifacts)
    if name in {"inspect_project", "validate_project"}:
        data, context = load_workspace(args["project"]); audit = audit_map(data)
        return envelope(name, data={"map": data, "audit": audit}, diagnostics=context["diagnostics"] + audit["diagnostics"])
    if name == "compose_project":
        data, context = load_workspace(args["project"]); composed = scalable_compose(data, args.get("preset", "editorial"))
        artifacts = save_workspace(args["project"], composed, dry_run=args.get("dryRun", False))
        return envelope(name, data={"map": composed, "dryRun": args.get("dryRun", False)}, artifacts=artifacts, diagnostics=context["diagnostics"])
    if name == "render_project":
        data, _ = load_workspace(args["project"]); target = render_project(data, args["output"]); return envelope(name, artifacts=[target])
    if name == "capture_project":
        data, _ = load_workspace(args["project"]); temp = Path(tempfile.mkdtemp(prefix="hexmap-mcp-")) / "preview.html"; render_project(data, temp)
        shots = screenshot_project(temp, args["output"], args.get("viewports", ["desktop", "tablet", "mobile"])); return envelope(name, artifacts=shots)
    if name == "audit_project":
        data, _ = load_workspace(args["project"]); audit = audit_map(data); artifacts = []
        if args.get("capture"):
            output = Path(args.get("output") or "hexmap-audit"); html = render_project(data, output / "preview.html"); artifacts = [html, *screenshot_project(html, output / "screenshots")]
        return envelope(name, data=audit, artifacts=artifacts, diagnostics=audit["diagnostics"])
    if name == "export_project":
        target = export_bundle(args["project"], args["output"]); return envelope(name, artifacts=[target])
    if name == "import_project":
        targets = import_bundle(args["bundle"], args["project"], dry_run=args.get("dryRun", False)); return envelope(name, data={"dryRun": args.get("dryRun", False)}, artifacts=targets)
    if name == "publish_project":
        try:
            from hexmap_export import ExportError, publish_project
        except ImportError as exc:
            raise HexMapError("HEXMAP_DEPENDENCY_MISSING", "Publication module is not installed; reinstall hexmap-studio") from exc
        formats = args.get("formats", ["html", "svg"])
        if not isinstance(formats, list) or not formats or any(str(item).lower().lstrip(".") not in {"html", "svg", "png", "pdf"} for item in formats):
            raise HexMapError("HEXMAP_INPUT_INVALID", "formats must be a non-empty list of html, svg, png or pdf")
        try: artifacts = publish_project(args["project"], args["output"], formats=[str(item) for item in formats], metadata=args.get("metadata") if isinstance(args.get("metadata"), dict) else None, view_id=str(args["view"]) if args.get("view") else None)
        except ExportError as error: raise HexMapError(error.code, str(error), error.details) from error
        return envelope(name, data={"readOnly": True, "formats": formats}, artifacts=artifacts)
    raise HexMapError("HEXMAP_INPUT_INVALID", f"Unknown tool: {name}")


def response(request_id: Any, result: Any = None, error: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"jsonrpc": "2.0", "id": request_id}
    payload["error" if error else "result"] = error or result
    return payload


def dispatch(message: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(message, dict): return response(None, error={"code": -32600, "message": "Invalid Request"})
    method, request_id = message.get("method"), message.get("id")
    if request_id is None: return None
    if method == "initialize":
        return response(request_id, {"protocolVersion": "2024-11-05", "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "hexmap-studio", "version": VERSION}})
    if method == "ping": return response(request_id, {})
    if method == "tools/list": return response(request_id, {"tools": TOOLS})
    if method == "tools/call":
        params = message.get("params", {})
        if not isinstance(params, dict) or not isinstance(params.get("arguments", {}), dict):
            return response(request_id, error={"code": -32602, "message": "Invalid tool arguments"})
        try:
            result = call_tool(params.get("name", ""), params.get("arguments", {}))
            return response(request_id, {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}], "structuredContent": result, "isError": not result.get("ok", False)})
        except HexMapError as exc:
            result = {"ok": False, "operation": params.get("name", ""), "version": VERSION, "artifacts": [], "diagnostics": [], "error": {"code": exc.code, "message": str(exc), "details": exc.details}}
            return response(request_id, {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}], "structuredContent": result, "isError": True})
    return response(request_id, error={"code": -32601, "message": f"Method not found: {method}"})


def main() -> int:
    for line in sys.stdin:
        if len(line.encode("utf-8")) > MAX_REQUEST_BYTES:
            print(json.dumps(response(None, error={"code": -32600, "message": "Request exceeds size limit"}), ensure_ascii=False), flush=True)
            continue
        try:
            outgoing = dispatch(json.loads(line))
            if outgoing is not None: print(json.dumps(outgoing, ensure_ascii=False), flush=True)
        except json.JSONDecodeError:
            print(json.dumps(response(None, error={"code": -32700, "message": "Parse error"}), ensure_ascii=False), flush=True)
        except Exception as exc:
            print(json.dumps(response(None, error={"code": -32603, "message": str(exc)})), flush=True)
    return 0


if __name__ == "__main__": raise SystemExit(main())
