---
name: build-hexmap
description: Build a valid HexaMap Studio map or Markdown workspace from source material. Use when information must become canonical hexagons, semantic clusters, cell or cluster relations, fields, paths, annotations, or reusable views before visual composition.
---

# Build HexaMap

Produce a semantically coherent HexaMap JSON file before making layout decisions.

## Workflow

1. Read the user's source material and identify the map's purpose and unit of analysis.
2. Create one canonical hexagon per meaningful unit. Do not duplicate an idea merely because it belongs to several themes.
3. Write a short `title`, a concise `summary`, and useful `bodyMarkdown` for each hexagon.
4. Define custom fields only when they support filtering, styling, axes, or grouping.
5. Add tags conservatively. Prefer stable analytical terms over decorative labels.
6. Form initial clusters only when the grouping is supported by the source or clearly stated as an interpretation. Adjacency alone is not evidence of membership.
7. Add relations between the smallest useful endpoints: hexagon-to-hexagon for local links and paths, cluster-to-cluster for territory-level claims. Use explicit labels such as `constrange`, `depende de`, or `habilita`.
8. Add canvas annotations for framing questions, hypotheses, cautions, or explanatory text that should not become a hexagon.
9. Keep all IDs stable, unique, lowercase, and hyphenated.
10. Choose no visual grammar here unless the source already requires territories, mosaic, paths, or axes. Validate before delivery.

## Required output

- A UTF-8 JSON file conforming to `schemas/hexmap.schema.json`.
- A brief note separating source-backed structure from interpretive choices.

## Use the references

Read `references/schema-reference.md` for the data contract and `references/modeling-guide.md` for modeling choices. Use the scripts rather than manually approximating validation.
