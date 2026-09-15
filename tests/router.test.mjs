import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRelation, offsetFromControl } from '../router.js';

const relation = (mode = 'auto', perpendicular = .2, along = 0) => ({
  id: 'r', routing: { mode, offset: { along, perpendicular } },
});

const base = {
  start: { x: 0, y: 0 },
  end: { x: 400, y: 0 },
  sourceCenter: { x: -90, y: 0 },
  targetCenter: { x: 490, y: 0 },
  existingRoutes: [], labelRects: [], obstacles: [],
};

test('automatic routing prefers the exterior side of the map', () => {
  const result = routeRelation({ ...base, relation: relation(), mapCenter: { x: 200, y: 160 } });
  assert.ok(result.control.y < 0, `expected exterior/upward curve, got ${result.control.y}`);
  assert.equal(result.hardCollisions, 0);
});

test('automatic routing avoids an obstacle even when exterior preference disagrees', () => {
  const obstacle = {
    minX: 130, minY: -180, maxX: 270, maxY: -15,
    polygon: [{x:130,y:-180},{x:270,y:-180},{x:270,y:-15},{x:130,y:-15}],
  };
  const result = routeRelation({ ...base, relation: relation(), mapCenter: { x: 200, y: 160 }, obstacles: [obstacle] });
  assert.equal(result.hardCollisions, 0);
  assert.ok(result.control.y > 0, `expected obstacle to force lower curve, got ${result.control.y}`);
});

test('manual routing follows saved normalized control offset', () => {
  const result = routeRelation({ ...base, relation: relation('manual', -.44, .18), mapCenter: {x:200,y:0} });
  const offset = offsetFromControl(base.start, base.end, result.control);
  assert.ok(Math.abs(offset.perpendicular + .44) < 1e-9);
  assert.ok(Math.abs(offset.along - .18) < 1e-9);
});

test('automatic routing keeps its previous side during small layout changes', () => {
  const previousOffset = { along: 0, perpendicular: -.21 };
  const first = routeRelation({ ...base, relation: relation(), mapCenter: { x: 200, y: 0 }, previousOffset });
  const moved = routeRelation({
    ...base,
    end: { x: 404, y: 8 },
    targetCenter: { x: 494, y: 8 },
    relation: relation(),
    mapCenter: { x: 200, y: 0 },
    previousOffset: first.offset,
  });
  assert.ok(first.offset.perpendicular < 0);
  assert.ok(moved.offset.perpendicular < 0, `expected routing side continuity, got ${moved.offset.perpendicular}`);
  assert.ok(Math.abs(moved.offset.along - first.offset.along) <= .08);
});

test('a collision-free route wins even when continuity prefers a blocked curve', () => {
  const obstacle = {
    minX: 130, minY: -180, maxX: 270, maxY: -8,
    polygon: [{x:130,y:-180},{x:270,y:-180},{x:270,y:-8},{x:130,y:-8}],
  };
  const result = routeRelation({
    ...base,
    relation: relation(),
    mapCenter: { x: 200, y: 160 },
    obstacles: [obstacle],
    previousOffset: { along: 0, perpendicular: -.21 },
    hysteresis: 10000,
  });
  assert.equal(result.hardCollisions, 0);
  assert.ok(result.offset.perpendicular > 0);
});

test('short relations cannot form extreme hooks', () => {
  const result = routeRelation({
    ...base,
    end: { x: 120, y: 18 },
    targetCenter: { x: 205, y: 28 },
    relation: relation(),
    mapCenter: { x: 70, y: 120 },
  });
  assert.ok(Math.abs(result.offset.along) <= .08);
  assert.ok(Math.abs(result.offset.perpendicular) <= .56);
  assert.ok(result.score < 1000, `short connector score should remain bounded, got ${result.score}`);
});
