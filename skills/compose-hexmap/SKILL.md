---
name: compose-hexmap
description: Compose an existing HexaMap as territories, mosaic/paths, or semantic axes. Use when arranging cells, choosing hull visibility, building edge paths, routing relations, creating views, or improving hierarchy without changing canonical Markdown.
---

# Compose HexaMap

Turn a valid semantic map into a legible spatial composition.

## Workflow

1. Validate the input before changing layout.
2. Choose one grammar:
   - `territories` for semantic islands, hulls and higher-level relations;
   - `mosaic` for continuous tiling, optional hulls and local edge paths;
   - `axes` when X and Y encode explicit variables.
3. Treat adjacency, cluster membership and hull visibility independently. Never merge categories merely because cells touch in a mosaic.
4. In territories, give clusters enough negative space for labels and outward arrows. In mosaic, keep cell labels and paths primary.
5. Prefer compact territories or purposeful paths over accidental chains.
6. Keep `routing.mode = auto` by default. The renderer evaluates both curve directions, obstacles, labels, crossings, and map interior. Use assisted offsets only for a deliberate override.
7. Use images selectively and preserve text contrast.
8. Use field-based coloring only when the field has analytical meaning.
9. Fit the viewport around the complete composition, including annotations.
10. Revalidate and audit after layout.

## Deterministic helpers

Use `scripts/layout_map.py` to apply supported layouts and `scripts/reset_routes.py` to return curved relations to automatic routing.

Read `references/layout-grammar.md` and `references/routing-guide.md` before making manual placement decisions.
