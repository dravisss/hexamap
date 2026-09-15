# Supported limits (0.1.x)

These limits are enforced before writes and are intentionally conservative:

| Resource | Limit |
|---|---:|
| Markdown notes in a workspace | 10,000 |
| Bundle members | 10,000 |
| Individual source/member | 5 MiB |
| Workspace or uncompressed bundle payload | 50 MiB |
| Standalone SVG hexagons | 10,000 |
| Standalone SVG clusters | 2,000 |

The deterministic composition path has been exercised at 300 hexagons and is
expected to remain usable at 1,000+; visual acceptance still depends on the
chosen viewport and density. A benchmark fixture records timings and fails if
the 300-cell regression budget is exceeded. Larger maps should publish SVG or
HTML and use the browser's semantic zoom rather than rasterising by default.
