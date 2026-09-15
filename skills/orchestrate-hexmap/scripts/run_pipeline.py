#!/usr/bin/env python3
from __future__ import annotations
import argparse, os, shutil, subprocess, sys
from pathlib import Path

def command() -> list[str]:
    executable = shutil.which("hexmap")
    if executable: return [executable]
    if os.environ.get("HEXMAP_HOME"):
        candidate = Path(os.environ["HEXMAP_HOME"]) / "hexmap_cli.py"
        if candidate.exists(): return [sys.executable, str(candidate)]
    for directory in [Path.cwd(), *Path.cwd().parents, Path(__file__).resolve().parent, *Path(__file__).resolve().parents]:
        candidate = directory / "hexmap_cli.py"
        if candidate.exists(): return [sys.executable, str(candidate)]
    raise SystemExit("HEXMAP_WORKSPACE_INVALID: install hexmap-studio or set HEXMAP_HOME")

parser = argparse.ArgumentParser()
parser.add_argument("project")
parser.add_argument("--preset", default="editorial")
parser.add_argument("--output", default="hexmap-delivery")
args = parser.parse_args()
base, project, output = command(), Path(args.project).resolve(), Path(args.output).resolve()
steps = [
    ["workspace", "validate", str(project), "--json"],
    ["compose", str(project), "--preset", args.preset, "--json"],
    ["render", str(project), "-o", str(output / "preview.html"), "--json"],
    ["visual-audit", str(project), "-o", str(output / "audit"), "--json"],
    ["workspace", "export", str(project), "-o", str(output / f"{project.name}.hexmap-workspace.json"), "--json"],
]
for step in steps:
    code = subprocess.call([*base, *step])
    if code: raise SystemExit(code)
