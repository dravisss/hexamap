# Layout grammar

## Territories

- Each hexagon uses axial `q` and `r` coordinates.
- Hexagons with the same `clusterId` should usually form one connected territory.
- Cluster position emerges from member coordinates; there is no separate absolute cluster origin.
- Moving a cluster means applying the same axial delta to all its members.
- An ungrouped hexagon uses `clusterId: null`.

## Mosaic and paths

- Cells may tile continuously even when neighboring cells belong to different clusters.
- `showClusterHulls: false` hides contours without removing semantic membership.
- Use relation `style: edge` only for adjacent hexagon endpoints.
- A sequence of edge relations is a path; do not introduce duplicate path content.
- Switching views must not rewrite Markdown, tags, fields, or cluster identity.

## Axes

- `axisPosition.x` and `axisPosition.y` are normalized from 0 to 1.
- Semantic axis values belong in custom fields.
- `layout.axes` stores labels, ranges, and drawing frame.
- Cluster membership remains visible through border color and the editorial key; giant enclosing hulls are intentionally suppressed.

## Editorial cluster labels

Labels are placed automatically around the hull using collision-aware candidates. Keep titles short enough to scan. The label is also the handle for moving the entire cluster.
When hulls are hidden, use labels or the legend only when they add meaning; a mosaic need not display every cluster title.

## Text annotations

Use annotations for framing and interpretation, not for entities that should participate in the topology.
