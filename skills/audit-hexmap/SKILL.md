---
name: audit-hexmap
description: Validate, render, critique, and iteratively improve a HexaMap Studio map. Use when the user asks to audit quality, roast a map, find mediocrity, verify JSON integrity, inspect overlaps or routing, run browser tests, or repeat an iterate-evaluate-reflect-criticize cycle before delivery.
---

# Audit HexaMap

Audit both the data contract and the rendered experience.

## Mandatory cycle

For each requested iteration:

1. Validate the JSON schema.
2. Run the structural audit.
3. Render the map in Chromium.
4. Inspect the default state and at least one interaction state.
5. Critique composition, hierarchy, readability, routing, and interaction.
6. Correct the most load-bearing defects.
7. Repeat from validation.

Do not count code-only changes as visual iterations when the task asks for visual refinement.

## Gates

- no duplicate IDs or orphan references;
- no overlapping axial cells in free layout;
- connected territories unless fragmentation is intentional; mosaics may place different semantic groups edge-to-edge;
- cluster titles readable and collision-free;
- hexagons visually above cluster fields;
- curved routes leave and enter visible hulls outward; edge relations occupy the correct shared border;
- no route crosses an unrelated hull when an alternative exists;
- Markdown is sanitized before rendering;
- exported JSON retains views, mode, hull policy, endpoint types, viewport, positions, fields, visuals, annotations, and routing;
- browser console and page errors are empty;
- core interactions pass.

Read `references/quality-gates.md` and `references/roast-checklist.md`. Use the audit scripts for deterministic checks.
