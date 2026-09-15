# Routing guide

Automatic routing should be the default.

The renderer scores candidate quadratic curves using:

- outward departure from the source hull;
- exterior arrival at the target hull;
- collisions with intermediate cluster hulls;
- clearance around labels;
- crossings with existing routes;
- unnecessary length;
- preference for the exterior side of the map when both sides are valid.

Use `assisted` routing when the editor should preserve a chosen side or curvature while still making small corrections. Use `manual` only when the saved control position must be followed exactly.

Routing offsets are normalized to relation length:

- `perpendicular`: signed bend side and intensity;
- `along`: movement of the control point along the source-target axis.
