"""Deterministic scale probe for HexMap platform operations.

Run ``python tests/benchmarks/benchmark_platform.py --json``.  The benchmark
has no network, filesystem fixture or random seed dependency and can therefore
be used as a release regression gate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from hexmap_export import render_svg
from hexmap_platform import audit_map, scalable_compose


def fixture(count: int) -> dict:
    clusters = [{"id": "cluster-0", "title": "Benchmark", "color": "#486581", "description": "", "bodyMarkdown": "", "tags": [], "fields": {}, "label": {"mode": "auto", "offsetX": 0, "offsetY": 0}}]
    hexagons = [{"id": f"hex-{index:05d}", "title": f"Item {index:05d}", "summary": "", "bodyMarkdown": "", "tags": [], "fields": {}, "visual": {"mode": "text", "image": {}}, "q": 0, "r": 0, "clusterId": "cluster-0", "axisPosition": None} for index in range(count)]
    return {"schemaVersion": "1.0.0", "workspaceVersion": "1.0.0", "id": "benchmark", "title": "Benchmark", "description": "", "layout": {"type": "free", "viewport": {"x": 0, "y": 0, "zoom": 1}, "axes": {"xLabel": "X", "xMin": 0, "xMax": 1, "yLabel": "Y", "yMin": 0, "yMax": 1, "frame": {"x": 0, "y": 0, "width": 100, "height": 100}}}, "fieldDefinitions": [], "styleRules": {}, "hexagons": hexagons, "clusters": clusters, "relations": [], "annotations": []}


def run(count: int) -> dict:
    data = fixture(count)
    started = time.perf_counter(); composed = scalable_compose(data, "minimal", seed=17); compose_ms = (time.perf_counter() - started) * 1000
    started = time.perf_counter(); svg = render_svg(composed, width=1600, height=1000); render_ms = (time.perf_counter() - started) * 1000
    coordinates = [(item["q"], item["r"]) for item in composed["hexagons"]]
    digest = hashlib.sha256(svg.encode("utf-8")).hexdigest()[:16]
    result = {"count": count, "composeMs": round(compose_ms, 3), "renderMs": round(render_ms, 3), "uniqueCoordinates": len(coordinates) == len(set(coordinates)), "svgSha256Prefix": digest, "auditVerdict": audit_map(composed)["verdict"]}
    # Generous CI-safe budgets: this catches accidental quadratic regressions
    # while leaving room for slower clean-install runners.
    budget = 1500 if count <= 300 else 6000
    result["budgetMs"] = budget
    result["pass"] = bool(result["uniqueCoordinates"] and compose_ms + render_ms <= budget)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--count", type=int, action="append", default=[]); parser.add_argument("--json", action="store_true")
    args = parser.parse_args(); counts = args.count or [300, 1000]
    if any(value < 1 or value > 10_000 for value in counts): parser.error("count must be between 1 and 10000")
    results = [run(value) for value in counts]; payload = {"benchmark": "hexmap-platform", "deterministic": True, "results": results, "pass": all(item["pass"] for item in results)}
    print(json.dumps(payload, ensure_ascii=False, indent=2) if args.json else "\n".join(f"{item['count']} cells: {item['composeMs']}ms compose + {item['renderMs']}ms render ({'PASS' if item['pass'] else 'FAIL'})" for item in results))
    return 0 if payload["pass"] else 1


if __name__ == "__main__": raise SystemExit(main())

