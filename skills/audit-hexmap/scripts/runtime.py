#!/usr/bin/env python3
from __future__ import annotations
import os, shutil, subprocess, sys
from pathlib import Path

def run(*arguments: str) -> int:
    executable = shutil.which("hexmap")
    if executable:
        return subprocess.call([executable, *arguments])
    candidates = []
    if os.environ.get("HEXMAP_HOME"):
        candidates.append(Path(os.environ["HEXMAP_HOME"]))
    candidates.extend([Path.cwd(), Path(__file__).resolve().parent])
    for candidate in candidates:
        for directory in [candidate, *candidate.parents]:
            cli = directory / "hexmap_cli.py"
            if cli.exists():
                return subprocess.call([sys.executable, str(cli), *arguments])
    raise SystemExit("HEXMAP_WORKSPACE_INVALID: install hexmap-studio or set HEXMAP_HOME")

