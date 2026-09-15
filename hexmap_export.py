"""Dependency-light publication and visual export for HexMap.

The publication path is intentionally separate from the editor: it emits a
self-contained, read-only HTML document with an accessible SVG.  PNG and PDF
are optional browser-backed exports and fail with a stable diagnostic when the
optional renderer is unavailable.
"""
from __future__ import annotations

import datetime as dt
import html
import json
import math
import mimetypes
import os
import tempfile
from pathlib import Path
from typing import Any, Iterable


VERSION = "0.1.10"
MAX_EXPORT_HEXAGONS = 10_000
MAX_EXPORT_CLUSTERS = 2_000
MAX_EXPORT_OUTPUT_BYTES = 50 * 1024 * 1024


class ExportError(RuntimeError):
    def __init__(self, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.code = code
        self.details = details


def _esc(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


def _safe_metadata(map_data: dict[str, Any], metadata: dict[str, Any] | None = None) -> dict[str, str]:
    source = map_data.get("metadata") if isinstance(map_data.get("metadata"), dict) else {}
    source = {**source, **(metadata or {})}
    fields = ("author", "license", "licenseUrl", "source", "description", "title")
    result = {key: str(source.get(key, ""))[:2_000] for key in fields if source.get(key) is not None}
    result.setdefault("title", str(map_data.get("title", "HexMap")))
    result.setdefault("description", str(map_data.get("description", "")))
    result.setdefault("author", "")
    result.setdefault("license", "")
    result.setdefault("source", "")
    result["generatedAt"] = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    return result


def _hex_points(cx: float, cy: float, radius: float) -> str:
    return " ".join(f"{cx + radius * math.cos(math.radians(30 + i * 60)):.2f},{cy + radius * math.sin(math.radians(30 + i * 60)):.2f}" for i in range(6))


def _coordinates(map_data: dict[str, Any], radius: float = 48.0) -> tuple[dict[str, tuple[float, float]], dict[str, tuple[float, float]]]:
    hexagons = map_data.get("hexagons", [])
    clusters = map_data.get("clusters", [])
    coords: dict[str, tuple[float, float]] = {}
    grouped: dict[str, list[tuple[float, float]]] = {}
    for index, item in enumerate(hexagons):
        try:
            q, r = int(item.get("q", index)), int(item.get("r", 0))
        except (TypeError, ValueError):
            q, r = index, 0
        x = q * radius * 1.5
        y = (r + q / 2) * radius * math.sqrt(3)
        coords[str(item.get("id", f"hex-{index}"))] = (x, y)
        cluster = item.get("clusterId")
        if cluster:
            grouped.setdefault(str(cluster), []).append((x, y))
    centers = {cluster_id: (sum(x for x, _ in points) / len(points), sum(y for _, y in points) / len(points)) for cluster_id, points in grouped.items() if points}
    for index, cluster in enumerate(clusters):
        cluster_id = str(cluster.get("id", f"cluster-{index}"))
        centers.setdefault(cluster_id, (index * radius * 4.0, 0.0))
    return coords, centers


def _endpoint_coordinates(relation: dict[str, Any], coords: dict[str, tuple[float, float]], centers: dict[str, tuple[float, float]]) -> tuple[tuple[float, float] | None, tuple[float, float] | None]:
    catalogs = {"hexagon": coords, "cluster": centers}
    return (catalogs.get(str(relation.get("sourceType")), {}).get(str(relation.get("source"))),
            catalogs.get(str(relation.get("targetType")), {}).get(str(relation.get("target"))))


def _cluster_hull(points: list[tuple[float, float]], padding: float = 68.0) -> str:
    if not points:
        return ""
    cx = sum(x for x, _ in points) / len(points)
    cy = sum(y for _, y in points) / len(points)
    expanded = []
    for x, y in sorted(points, key=lambda point: math.atan2(point[1] - cy, point[0] - cx)):
        dx, dy = x - cx, y - cy
        length = math.hypot(dx, dy) or 1.0
        expanded.append((x + padding * dx / length, y + padding * dy / length))
    if len(expanded) == 1:
        x, y = expanded[0]
        return f"M {x - padding:.2f},{y:.2f} A {padding:.2f},{padding:.2f} 0 1 0 {x + padding:.2f},{y:.2f} A {padding:.2f},{padding:.2f} 0 1 0 {x - padding:.2f},{y:.2f}"
    return "M " + " L ".join(f"{x:.2f},{y:.2f}" for x, y in expanded) + " Z"


def render_svg(map_data: dict[str, Any], *, metadata: dict[str, Any] | None = None, width: int = 1600, height: int = 1000) -> str:
    """Return deterministic, standalone SVG for a map."""
    if not isinstance(map_data, dict):
        raise ExportError("HEXMAP_INPUT_INVALID", "Map must be an object")
    hexagons = map_data.get("hexagons", [])
    clusters = map_data.get("clusters", [])
    if not isinstance(hexagons, list) or not isinstance(clusters, list):
        raise ExportError("HEXMAP_INPUT_INVALID", "hexagons and clusters must be arrays")
    if len(hexagons) > MAX_EXPORT_HEXAGONS or len(clusters) > MAX_EXPORT_CLUSTERS:
        raise ExportError("HEXMAP_LIMIT_EXCEEDED", "Map exceeds standalone export limits", {"hexagons": len(hexagons), "clusters": len(clusters)})
    if width < 320 or height < 240 or width > 8_000 or height > 8_000:
        raise ExportError("HEXMAP_INPUT_INVALID", "SVG dimensions must be between 320x240 and 8000x8000")
    meta = _safe_metadata(map_data, metadata)
    coords, centers = _coordinates(map_data)
    all_points = list(coords.values()) or [(0.0, 0.0)]
    min_x = min(x for x, _ in all_points) - 130
    max_x = max(x for x, _ in all_points) + 130
    min_y = min(y for _, y in all_points) - 120
    max_y = max(y for _, y in all_points) + 120
    view_width, view_height = max(max_x - min_x, 320), max(max_y - min_y, 240)
    palette = ["#b76543", "#486581", "#39756a", "#8a762f", "#775a8c", "#9a536c"]
    out: list[str] = [f'<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="hexmap-title hexmap-desc" viewBox="{min_x:.2f} {min_y:.2f} {view_width:.2f} {view_height:.2f}" width="{width}" height="{height}">']
    out.append("<title id=\"hexmap-title\">" + _esc(meta["title"]) + "</title>")
    out.append("<desc id=\"hexmap-desc\">" + _esc(meta["description"] or f'{len(hexagons)} hexágonos') + "</desc>")
    out.append("<style>svg{background:#f8f5ef;color:#17212b;font-family:Inter,ui-sans-serif,system-ui,sans-serif} .cluster-hull{stroke-width:2;fill-opacity:.06;stroke-opacity:.55} .cluster-label{font-size:22px;font-weight:700;letter-spacing:.01em;fill:#263746} .hex{stroke:#fff;stroke-width:3} .hex-label{font-size:13px;font-weight:650;fill:#13212c;text-anchor:middle;dominant-baseline:middle} .relation{stroke:#8798a4;stroke-width:2.5;fill:none;opacity:.72}.relation.curve{stroke-dasharray:8 7}.relation.edge{stroke-width:7;stroke-linecap:round;opacity:.9} .meta{font-size:12px;fill:#5a6872}</style>")
    if map_data.get("layout", {}).get("showClusterHulls", True):
        out.append('<g aria-label="Contornos dos clusters">')
        for index, cluster in enumerate(clusters):
            cluster_id = str(cluster.get("id", f"cluster-{index}"))
            points = [coords[str(item.get("id"))] for item in hexagons if str(item.get("clusterId")) == cluster_id and str(item.get("id")) in coords]
            path = _cluster_hull(points)
            if path:
                color = str(cluster.get("color") or palette[index % len(palette)])
                out.append(f'<path class="cluster-hull" d="{path}" fill="{_esc(color)}" stroke="{_esc(color)}"/>')
        out.append("</g>")
    out.append('<g aria-label="Relações">')
    for relation in map_data.get("relations", []):
        source, target = _endpoint_coordinates(relation, coords, centers)
        if source and target and source != target:
            style = str(relation.get("style", "curve"))
            if style == "curve":
                mx, my = (source[0] + target[0]) / 2, (source[1] + target[1]) / 2
                dx, dy = target[0] - source[0], target[1] - source[1]
                length = math.hypot(dx, dy) or 1.0
                control = (mx - dy / length * 38, my + dx / length * 38)
                path = f"M {source[0]:.2f},{source[1]:.2f} Q {control[0]:.2f},{control[1]:.2f} {target[0]:.2f},{target[1]:.2f}"
            else:
                path = f"M {source[0]:.2f},{source[1]:.2f} L {target[0]:.2f},{target[1]:.2f}"
            out.append(f'<path class="relation {style}" d="{path}" aria-label="{_esc(relation.get("label", "relação"))}"/>')
    out.append("</g>")
    out.append('<g aria-label="Clusters">')
    for index, cluster in enumerate(clusters):
        cluster_id = str(cluster.get("id", f"cluster-{index}"))
        center = centers.get(cluster_id)
        if center:
            out.append(f'<text class="cluster-label" x="{center[0]:.2f}" y="{center[1] - 72:.2f}" text-anchor="middle">{_esc(cluster.get("title", cluster_id))}</text>')
    out.append("</g>")
    out.append('<g aria-label="Hexágonos">')
    for index, item in enumerate(hexagons):
        item_id = str(item.get("id", f"hex-{index}"))
        cx, cy = coords.get(item_id, (0.0, 0.0))
        color = next((str(cluster.get("color")) for cluster in clusters if str(cluster.get("id")) == str(item.get("clusterId")) and cluster.get("color")), palette[index % len(palette)])
        label = str(item.get("title", item_id))[:120]
        out.append(f'<g class="hex-node" tabindex="0" aria-label="{_esc(label)}"><polygon class="hex" points="{_hex_points(cx, cy, 48)}" fill="{_esc(color)}"/><text class="hex-label" x="{cx:.2f}" y="{cy:.2f}">{_esc(label)}</text></g>')
    out.append("</g>")
    out.append(f'<text class="meta" x="{min_x + 20:.2f}" y="{max_y - 24:.2f}">{_esc(meta.get("author") or "")}{" · " if meta.get("author") and meta.get("license") else ""}{_esc(meta.get("license") or "")}</text>')
    out.append("</svg>")
    return "".join(out)


def standalone_html(map_data: dict[str, Any], *, metadata: dict[str, Any] | None = None, svg_width: int = 1600, svg_height: int = 1000) -> str:
    meta = _safe_metadata(map_data, metadata)
    svg = render_svg(map_data, metadata=meta, width=svg_width, height=svg_height)
    payload = json.dumps({"title": meta["title"], "author": meta["author"], "license": meta["license"], "generatedAt": meta["generatedAt"]}, ensure_ascii=False).replace("</", "<\\/")
    description = _esc(meta.get("description", ""))
    return f'''<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="hexmap-version" content="{_esc(VERSION)}"><meta name="author" content="{_esc(meta['author'])}"><meta name="license" content="{_esc(meta['license'])}">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>{_esc(meta['title'])}</title><style>:root{{color-scheme:light}}body{{margin:0;background:#f8f5ef;color:#17212b;font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}}main{{max-width:1800px;margin:0 auto;padding:clamp(18px,3vw,52px)}}header{{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:20px}}h1{{font:700 clamp(26px,4vw,50px)/1.05 Georgia,serif;margin:0;letter-spacing:-.025em}}p{{margin:.45rem 0;color:#52616b}}.meta{{font-size:.84rem;text-align:right;color:#52616b}}.canvas{{overflow:auto;border:1px solid #d9d0c2;border-radius:18px;background:#f8f5ef;box-shadow:0 14px 40px #34261610}}svg{{display:block;min-width:720px;width:100%;height:auto}}footer{{margin-top:14px;font-size:.82rem;color:#66757f}}@media(max-width:640px){{header{{display:block}}.meta{{margin-top:12px;text-align:left}}}}</style></head>
<body><main><header><div><h1>{_esc(meta['title'])}</h1><p>{description}</p></div><div class="meta"><div>{_esc(meta['author'])}</div><div>{_esc(meta['license'])}</div></div></header><section class="canvas" aria-label="Mapa HexMap somente leitura">{svg}</section><footer>Publicação somente leitura · gerado em {_esc(meta['generatedAt'])}</footer></main><script type="application/json" id="hexmap-metadata">{payload}</script></body></html>'''


def _write(path: Path, content: str | bytes) -> Path:
    path = path.expanduser().resolve()
    if isinstance(content, str):
        encoded = content.encode("utf-8")
    else:
        encoded = content
    if len(encoded) > MAX_EXPORT_OUTPUT_BYTES:
        raise ExportError("HEXMAP_LIMIT_EXCEEDED", "Export exceeds output size limit")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
    return path


def export_visual(map_data: dict[str, Any], output: Path | str, format: str | None = None, *, metadata: dict[str, Any] | None = None) -> Path:
    target = Path(output).expanduser().resolve()
    kind = (format or target.suffix.lstrip(".") or "html").lower()
    if kind in {"htm", "html"}:
        return _write(target, standalone_html(map_data, metadata=metadata))
    if kind == "svg":
        return _write(target, render_svg(map_data, metadata=metadata))
    if kind not in {"png", "pdf"}:
        raise ExportError("HEXMAP_INPUT_INVALID", f"Unsupported export format: {kind}")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise ExportError("HEXMAP_DEPENDENCY_MISSING", f"{kind.upper()} export requires optional Playwright; SVG/HTML remain available") from exc
    with tempfile.TemporaryDirectory(prefix="hexmap-export-") as temp:
        html_path = Path(temp) / "index.html"
        _write(html_path, standalone_html(map_data, metadata=metadata))
        try:
            with sync_playwright() as playwright:
                candidates = [Path("/usr/bin/chromium"), Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), Path("/Applications/Chromium.app/Contents/MacOS/Chromium")]
                executable = next((str(path) for path in candidates if path.exists()), None)
                browser = playwright.chromium.launch(headless=True, executable_path=executable, args=["--no-sandbox"])
                page = browser.new_page(viewport={"width": 1600, "height": 1100}, device_scale_factor=1)
                page.goto(html_path.as_uri(), wait_until="load")
                if kind == "png":
                    page.screenshot(path=str(target), full_page=True)
                else:
                    page.pdf(path=str(target), format="A3", print_background=True, margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
                browser.close()
        except Exception as exc:
            raise ExportError("HEXMAP_RENDER_FAILED", f"{kind.upper()} export failed", {"reason": str(exc)}) from exc
    if not target.exists() or target.stat().st_size > MAX_EXPORT_OUTPUT_BYTES:
        raise ExportError("HEXMAP_RENDER_FAILED", f"{kind.upper()} export produced an invalid artifact")
    return target


def publish_project(directory: Path | str, output: Path | str, *, formats: Iterable[str] = ("html",), metadata: dict[str, Any] | None = None, view_id: str | None = None) -> list[Path]:
    from hexmap_platform import load_workspace, select_view

    data, context = load_workspace(directory)
    if context.get("diagnostics"):
        # Missing source notes are a publication blocker: publishing a partial
        # map would look successful while silently omitting canonical content.
        raise ExportError("HEXMAP_AUDIT_REJECTED", "Cannot publish workspace with source diagnostics", context["diagnostics"])
    data = select_view(data, view_id)
    base = Path(output).expanduser().resolve()
    if base.suffix:
        base.parent.mkdir(parents=True, exist_ok=True)
        output_dir = base.parent
        stem = base.stem
    else:
        output_dir = base
        stem = data.get("id", "hexmap")
    output_dir.mkdir(parents=True, exist_ok=True)
    artifacts: list[Path] = []
    for requested in formats:
        kind = str(requested).lower().lstrip(".")
        target = output_dir / f"{stem}.{kind}"
        artifacts.append(export_visual(data, target, kind, metadata=metadata))
    return artifacts
