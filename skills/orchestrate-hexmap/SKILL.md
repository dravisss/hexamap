---
name: orchestrate-hexmap
description: Operate an entire HexMap project from source material or a Markdown workspace through semantic modeling, scalable composition, rendering, screenshots, adversarial QA, and portable delivery. Use when the user wants a complete agent-driven hexagonal mapping workflow rather than one isolated operation.
---

# Orchestrate HexMap

Deliver a complete, evidence-backed HexMap project without a database.

## Preconditions

1. Locate `hexmap` on `PATH`, or use `HEXMAP_HOME`.
2. Run `hexmap doctor --json` and stop on a missing required dependency.
3. Treat Markdown/YAML as canonical content and `.hexmap/map.json` as visual state.

## Workflow

1. Inspect source material and declare the unit of analysis.
2. Use `build-hexmap` to create stable semantic units and explicit relations.
3. Run `hexmap workspace validate PROJECT --json`.
4. Use `compose-hexmap` with an explicit grammar (`territories`, `mosaic`, or `axes`), named preset and deterministic seed.
5. Run `hexmap render`, `hexmap screenshot`, and `hexmap visual-audit`.
6. Correct every P0/P1; retain P2 only with an explicit known-gap note.
7. Export a portable workspace bundle and a delivery manifest.

## Required outputs

- valid Markdown workspace;
- `.hexmap/map.json`;
- optional `.hexmap/views/*.json` files containing visual state only;
- standalone HTML preview;
- desktop, tablet and mobile screenshots;
- `report.json` and `report.md`;
- portable `*.hexmap-workspace.json` bundle;
- short provenance note separating source facts from interpretation.

## Completion gate

Do not claim completion unless schema, structural audit, render, screenshots and
visual audit all ran against the delivered project and the operation envelopes
contain no errors.

Read `references/handoff-contract.md` before delivery. Use the wrapper script so
the skill works whether HexMap is installed or referenced through `HEXMAP_HOME`.
