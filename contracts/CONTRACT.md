# HexMap portable contract

HexMap projects are ordinary directories. Markdown and YAML are canonical for
content; `.hexmap/map.json` is canonical for layout, relations and appearance.

## Stable paths

- `hexmap.yaml` — project identity and configuration.
- `**/*.md` — knowledge units with YAML frontmatter.
- `.hexmap/map.json` — visual manifest.
- `.hexmap/views/*.json` — named presentation views; Markdown content is not duplicated.
- `assets/**` — project-relative media.

## Version policy

- `schemaVersion` governs the visual map contract.
- `workspaceVersion` governs the directory projection.
- Major changes require migration; minor changes are backwards-compatible.
- The runtime refuses unsupported major versions with `HEXMAP_VERSION_UNSUPPORTED`.

## Operation envelope

Every machine-facing operation can emit an envelope conforming to
`operation-result.schema.json`: `ok`, `operation`, `version`, `artifacts`,
`diagnostics`, and optional `data`. Failures include a stable `error.code`.

## Extension policy

Unknown YAML frontmatter is preserved in `fields`. Vendor extensions in JSON
must use an `x-<vendor>-*` key. Canonical objects reject accidental unknown
properties where doing so would lose meaning.

## Universal map grammar

- `layout.mode` is `territories`, `mosaic`, or `axes`; legacy `layout.type`
  remains materialized for compatible clients.
- `showClusterHulls` affects presentation only. Physical adjacency (`q`, `r`)
  and semantic membership (`clusterId`) are independent.
- Relations declare `sourceType` and `targetType` as `hexagon` or `cluster`.
  `curve` may connect either level. `edge` connects adjacent hexagons only;
  non-adjacent edges fail with `HEXMAP_RELATION_NOT_ADJACENT`.
- `views` share the same semantic corpus. `activeViewId` selects the view
  materialized in top-level `layout`, preserving older readers.

## Write safety

- workspace writes are atomic;
- source Markdown is never physically deleted automatically;
- `--dry-run` reports intended mutations;
- generated artifacts stay inside the selected output directory.
