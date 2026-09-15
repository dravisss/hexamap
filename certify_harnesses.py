#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HARNESSES = {"codex": "codex", "claude-code": "claude", "hermes": "hermes", "opencode": "opencode", "gemini-cli": "gemini"}

def version(command: str) -> dict:
    executable = shutil.which(command)
    if not executable: return {"installed": False, "command": command, "versionProbe": None}
    probe = subprocess.run([executable, "--version"], text=True, capture_output=True, timeout=20)
    lines = [line for line in (probe.stdout or probe.stderr).strip().splitlines() if "Install directory:" not in line]
    return {"installed": True, "command": command, "versionProbe": lines[:2], "exitCode": probe.returncode}

messages = [
    {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hexmap-certifier","version":"1"}}},
    {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}},
    {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"inspect_project","arguments":{"project":str(ROOT / "examples/workspace")}}},
]
process = subprocess.run([sys.executable, str(ROOT / "hexmap_mcp.py")], input="\n".join(json.dumps(item) for item in messages)+"\n", text=True, capture_output=True, timeout=30)
responses = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
tools = responses[1]["result"]["tools"] if len(responses) > 1 else []
protocol = {"exitCode": process.returncode, "initialize": responses[0]["result"]["serverInfo"] if responses else None, "tools": [item["name"] for item in tools], "readOnlyCall": len(responses) > 2 and not responses[2]["result"].get("isError", True), "stderr": process.stderr}
report = {"schemaVersion":"1.0.0","surface":"stdio-mcp+skills+cli","harnesses":{name:version(command) for name,command in HARNESSES.items()},"protocol":protocol,"verdict":"PASS" if process.returncode == 0 and len(tools) >= 9 and protocol["readOnlyCall"] else "REJECT","limits":["Protocol certification does not guarantee identical editorial judgment across models."]}
target = ROOT / "harnesses/certification.json"; target.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
raise SystemExit(0 if report["verdict"] == "PASS" else 1)
