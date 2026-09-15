# Quality gates

## Data

- schema validation passes;
- IDs are unique;
- relation endpoints exist;
- endpoint types resolve to the declared hexagon or cluster;
- edge relations join adjacent hexagons;
- field keys are unique;
- all image modes have a source;
- free-layout cells do not overlap;
- empty clusters are removed or explicitly documented.

## Visual

- the map, not chrome, dominates the viewport;
- hexagon title contrast remains readable;
- cluster fields support rather than veil cells;
- labels are editorial and large enough at fit-to-view scale;
- annotations do not cover clusters by default;
- axes do not generate giant enclosing hulls;
- mosaic hull visibility matches the view contract and paths use shared borders;
- arrows have a coherent direction and clear head.

## Interaction

- drag individual hexagon;
- drag entire cluster;
- form, split, and recombine clusters;
- create and edit relation;
- auto and assisted routing;
- Markdown edit, preview, and full-screen reading;
- custom fields and tags;
- image modes;
- free text annotation;
- territories, mosaic/path and axes layouts;
- switching views without content loss;
- JSON import/export;
- undo/redo.
