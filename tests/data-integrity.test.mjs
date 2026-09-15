import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialMap, createJourneyMap, createLibraryMap, createTemplateMap } from '../data.js';
import { coordKey, neighbors } from '../hex.js';

test('demo dataset has rich V9 structure and unique ids', () => {
  const map = createInitialMap();
  assert.equal(map.schemaVersion, '1.0.0');
  assert.equal(map.hexagons.length, 48);
  assert.equal(map.clusters.length, 6);
  assert.equal(map.relations.length, 6);
  assert.equal(new Set(map.hexagons.map((item) => item.id)).size, map.hexagons.length);
  assert.equal(new Set(map.clusters.map((item) => item.id)).size, map.clusters.length);
  assert.equal(new Set(map.relations.map((item) => item.id)).size, map.relations.length);
  assert.equal(new Set(map.hexagons.map((item) => coordKey(item.q, item.r))).size, map.hexagons.length);
  assert.ok(map.fieldDefinitions.some((field) => field.key === 'status'));
  assert.ok(map.hexagons.every((item) => typeof item.bodyMarkdown === 'string'));
  assert.ok(map.hexagons.every((item) => item.visual && item.visual.image));
  assert.ok(map.relations.every((item) => item.routing?.mode === 'auto'));
});

test('each initial cluster is a connected honeycomb', () => {
  const map = createInitialMap();
  for (const cluster of map.clusters) {
    const members = map.hexagons.filter((entity) => entity.clusterId === cluster.id);
    assert.ok(members.length >= 2, `${cluster.title} needs members`);
    const byCoord = new Map(members.map((entity) => [coordKey(entity.q, entity.r), entity]));
    const queue = [members[0]];
    const visited = new Set([members[0].id]);
    while (queue.length) {
      const current = queue.shift();
      for (const cell of neighbors(current.q, current.r)) {
        const next = byCoord.get(coordKey(cell.q, cell.r));
        if (next && !visited.has(next.id)) {
          visited.add(next.id);
          queue.push(next);
        }
      }
    }
    assert.equal(visited.size, members.length, `${cluster.title} must be connected`);
  }
});

test('positions, fields and visual modes survive JSON round-trip', () => {
  const source = createInitialMap();
  source.clusters[0].view3d = { x: -7.1, z: -4.25 };
  const restored = JSON.parse(JSON.stringify(source));
  const autonomy = restored.hexagons.find((item) => item.id === 'autonomy');
  const automation = restored.hexagons.find((item) => item.id === 'automation');
  assert.deepEqual({ q: autonomy.q, r: autonomy.r, clusterId: autonomy.clusterId }, { q: -5, r: -1, clusterId: 'work' });
  assert.equal(autonomy.visual.mode, 'icon');
  assert.equal(automation.visual.mode, 'cover');
  assert.ok(Object.hasOwn(autonomy.fields, 'time'));
  assert.deepEqual(restored.clusters[0].view3d, { x: -7.1, z: -4.25 });
});

test('task templates express territories, paths and a Markdown library with one map shape', () => {
  const system = createTemplateMap('Sistema');
  const journey = createJourneyMap('Jornada');
  const library = createLibraryMap('Biblioteca');
  assert.equal(system.layout.mode, 'territories');
  assert.equal(system.layout.showClusterHulls, true);
  assert.equal(journey.layout.mode, 'mosaic');
  assert.equal(journey.layout.showClusterHulls, false);
  assert.ok(journey.relations.every((relation) => relation.sourceType === 'hexagon' && relation.targetType === 'hexagon' && relation.style === 'edge'));
  assert.equal(library.layout.mode, 'mosaic');
  assert.ok(library.hexagons.every((hexagon) => typeof hexagon.bodyMarkdown === 'string' && hexagon.clusterId));
  for (const map of [system, journey, library]) {
    assert.equal(map.schemaVersion, '1.0.0');
    assert.ok(Array.isArray(map.hexagons) && Array.isArray(map.clusters) && Array.isArray(map.relations));
  }
});
