---
title: HexMap Universal Agent Platform
version: 10.3.0
status: implemented
---

# HexMap Universal Agent Platform

## Promise

Any shell or MCP-capable agent can create, inspect, compose, render, capture,
audit and export a HexMap project without a database. Markdown/frontmatter is
canonical content; `.hexmap/map.json` is portable visual state.

## Install

```bash
python3 -m pip install '.[visual]'
hexmap doctor --json
hexmap skills install --target ./agent-skills
```

The package installs `hexmap` and `hexmap-mcp`. Skills discover the executable
on `PATH`, then `HEXMAP_HOME`, then a repository ancestor.

## Headless project lifecycle

```bash
hexmap workspace init Projeto --title "Meu mapa"
hexmap workspace validate Projeto --json
hexmap compose Projeto --preset research --json
hexmap render Projeto -o delivery/preview.html --json
hexmap screenshot Projeto -o delivery/screenshots --json
hexmap visual-audit Projeto -o delivery/audit --json
hexmap workspace export Projeto -o delivery/project.hexmap-workspace.json --json
```

Every mutating workspace command supports either `--dry-run` directly or a
read-only validation counterpart. Writes are atomic and Markdown deletion is
never automatic.

## Visual system

Named presets: `editorial`, `research`, `ecosystem`, `causal`, `actors`,
`process`, `roadmap`, `comparison`, `technical`, and `minimal`.

The scalable compositor generates arbitrarily large hex disks per cluster,
packs territories from their measured radius and is deterministic. Semantic
LOD exposes overview, medium and detail states so cluster structure and
relations survive before cell microtext.

## MCP

Register `hexmap-mcp` as a local stdio server. It exposes:

- `create_project`
- `inspect_project`
- `validate_project`
- `compose_project`
- `render_project`
- `capture_project`
- `audit_project`
- `export_project`
- `import_project`

CLI and MCP call the same `hexmap_platform` library and therefore share error
codes, artifacts and behavior.

## Certification

Run:

```bash
python3 certify_harnesses.py
```

The suite checks installed Codex, Claude Code, Hermes, OpenCode and Gemini CLI
executables, initializes MCP, lists tools and performs a read-only project
call. See `harnesses/certification.json`. This proves interface conformance,
not identical editorial judgment across models.

## Acceptance gates

- clean package installation outside the repository;
- standalone runtime assets and installable skills;
- 300-cell composition without overlaps;
- Markdown workspace round-trip;
- arbitrary standalone render;
- desktop/tablet/mobile screenshots;
- reproducible audit artifacts;
- MCP initialization, discovery and tool call;
- no machine-specific paths in distributed skills/configuration.
