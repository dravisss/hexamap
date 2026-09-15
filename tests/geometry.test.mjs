import test from 'node:test';
import assert from 'node:assert/strict';
import { axialToPixel, pixelToAxial, neighbors, axialDistance, coordKey } from '../hex.js';

test('axial coordinates round-trip through pixels', () => {
  const origin = { x: 1100, y: 700 };
  for (const cell of [{q:0,r:0},{q:-6,r:-1},{q:7,r:-4},{q:3,r:5}]) {
    const pixel = axialToPixel(cell.q, cell.r, origin);
    assert.deepEqual(pixelToAxial(pixel.x, pixel.y, origin), cell);
  }
});

test('a hex has six unique neighbors at distance one', () => {
  const cells = neighbors(2, -3);
  assert.equal(cells.length, 6);
  assert.equal(new Set(cells.map(({q,r}) => coordKey(q,r))).size, 6);
  for (const cell of cells) assert.equal(axialDistance({q:2,r:-3}, cell), 1);
});
