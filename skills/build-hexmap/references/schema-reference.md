# HexaMap schema reference

The root object contains:

- `schemaVersion`: currently `1.0.0`.
- `id`, `title`, `description`.
- `layout`: active visual state. `mode` is `territories`, `mosaic`, or `axes`; `showClusterHulls` controls presentation without changing membership.
- `activeViewId` and `views`: optional visual readings of the same canonical content.
- `fieldDefinitions`: reusable custom field definitions.
- `styleRules`: optional field-based color rules.
- `hexagons`: canonical knowledge units.
- `clusters`: semantic group metadata.
- `relations`: explicit links whose endpoints may be hexagons or clusters.
- `annotations`: Markdown text placed freely on the canvas.

## Hexagon

Required core fields:

```json
{
  "id": "autonomy",
  "title": "Autonomia",
  "summary": "Capacidade localizada de tomar decisões.",
  "bodyMarkdown": "## Autonomia\n\nTexto completo...",
  "tags": ["trabalho", "poder"],
  "fields": {"status": "em-analise"},
  "visual": {
    "mode": "text",
    "image": {"src": "", "fit": "cover", "position": "50% 50%", "overlay": 0.38}
  },
  "q": 0,
  "r": 0,
  "clusterId": "work",
  "axisPosition": null
}
```

Visual modes: `text`, `icon`, `cover`, `image`.

## Cluster

```json
{
  "id": "work",
  "title": "Organização do trabalho",
  "description": "Resumo do agrupamento.",
  "bodyMarkdown": "## Organização do trabalho",
  "tags": [],
  "fields": {},
  "color": "#bf7448",
  "label": {"mode": "auto", "offsetX": 0, "offsetY": 0}
}
```

Membership is stored on each hexagon through `clusterId`.
It is semantic: physical adjacency and hull visibility do not change it.

## Relation

```json
{
  "id": "relation-1",
  "source": "work",
  "target": "technology",
  "sourceType": "cluster",
  "targetType": "cluster",
  "style": "curve",
  "label": "é reorganizado por",
  "routing": {
    "mode": "auto",
    "offset": {"along": 0, "perpendicular": 0.2}
  }
}
```

Prefer `routing.mode = auto`. Use `assisted` only for an intentional editorial override.
For adjacent hexagons, `style: edge` highlights the shared border and can be
chained into a path without a separate path entity. Omitted endpoint types and
style retain the legacy cluster-to-cluster `curve` behavior.

## Views

Views store layout and presentation only. They never duplicate `bodyMarkdown`.
The active view remains materialized in root `layout` for older clients.

## Annotation

```json
{
  "id": "annotation-1",
  "type": "text",
  "x": 800,
  "y": 1120,
  "width": 420,
  "title": "Hipótese central",
  "bodyMarkdown": "Texto em **Markdown**.",
  "style": {"variant": "editorial", "fontSize": 17, "align": "left"}
}
```

See the full machine-readable schema at `schemas/hexmap.schema.json`.
