# Modeling guide

## Choose the unit of analysis first

A hexagon should represent one coherent unit at the chosen analytical scale: concept, actor, practice, event, evidence item, pattern, requirement, or method. Avoid mixing whole subsystems with tiny attributes in the same map unless the distinction is explicit in fields.

## Clusters are interpretations

Use clusters to make one useful grouping visible. Do not claim they are the only possible ontology. Keep the source content in the hexagon so it can be recombined later.

## Relations are not proximity

Adjacency means the concepts are arranged together in the current composition. A directed relation means an explicit semantic link. Do not encode every association as an arrow.

## Handle uncertainty

Use custom fields such as:

- `status`: rascunho, em-analise, validado;
- `evidence`: exploratoria, moderada, forte;
- `source-type`;
- `date`;
- `confidence`.

Mark interpretive claims in Markdown instead of presenting them as settled facts.

## Images

Use images only when they add recognition or meaning. Use `icon` for symbolic imagery, `cover` for atmospheric/contextual imagery, and `image` when the visual itself is the content.
