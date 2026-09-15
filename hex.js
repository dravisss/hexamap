export const HEX_SIZE = 58;
export const SQRT3 = Math.sqrt(3);
export const DIRECTIONS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

export function axialToPixel(q, r, origin = { x: 0, y: 0 }, size = HEX_SIZE) {
  return {
    x: origin.x + size * 1.5 * q,
    y: origin.y + size * SQRT3 * (r + q / 2),
  };
}

export function pixelToAxial(x, y, origin = { x: 0, y: 0 }, size = HEX_SIZE) {
  const px = x - origin.x;
  const py = y - origin.y;
  const q = (2 / 3 * px) / size;
  const r = (-1 / 3 * px + SQRT3 / 3 * py) / size;
  return cubeRound(q, r);
}

function cubeRound(q, r) {
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xd = Math.abs(rx - x);
  const yd = Math.abs(ry - y);
  const zd = Math.abs(rz - z);
  if (xd > yd && xd > zd) rx = -ry - rz;
  else if (yd > zd) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

export function neighbors(q, r) {
  return DIRECTIONS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

export function axialDistance(a, b) {
  const ay = -a.q - a.r;
  const by = -b.q - b.r;
  return (Math.abs(a.q - b.q) + Math.abs(ay - by) + Math.abs(a.r - b.r)) / 2;
}

export function coordKey(q, r) {
  return `${q},${r}`;
}

export function hexCorners(center, radius = HEX_SIZE * 0.94) {
  const points = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = Math.PI / 180 * (60 * i - 30);
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return points;
}

export function convexHull(points) {
  if (points.length <= 2) return [...points];
  const pts = [...points].sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function expandedHull(points, pad = 42) {
  if (!points.length) return [];
  const hull = convexHull(points);
  const center = centroid(hull);
  return hull.map((p) => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: p.x + dx / d * pad, y: p.y + dy / d * pad };
  });
}

export function smoothClosedPath(points) {
  if (points.length < 3) return '';
  let d = '';
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const next = points[(i + 1) % points.length];
    const after = points[(i + 2) % points.length];
    const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
    const mid2 = { x: (next.x + after.x) / 2, y: (next.y + after.y) / 2 };
    if (i === 0) d = `M ${mid.x} ${mid.y}`;
    d += ` Q ${next.x} ${next.y} ${mid2.x} ${mid2.y}`;
  }
  return `${d} Z`;
}

export function centroid(points) {
  if (!points.length) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

export function ring(center, radius) {
  if (radius === 0) return [{ ...center }];
  const results = [];
  let q = center.q + DIRECTIONS[4][0] * radius;
  let r = center.r + DIRECTIONS[4][1] * radius;
  for (let side = 0; side < 6; side += 1) {
    const [dq, dr] = DIRECTIONS[side];
    for (let step = 0; step < radius; step += 1) {
      results.push({ q, r });
      q += dq;
      r += dr;
    }
  }
  return results;
}

export function spiral(center, radius) {
  const results = [{ ...center }];
  for (let r = 1; r <= radius; r += 1) results.push(...ring(center, r));
  return results;
}

export function quadraticPath(start, end, bend = 0.18) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const mx = (start.x + end.x) / 2 + nx * length * bend;
  const my = (start.y + end.y) / 2 + ny * length * bend;
  return { d: `M ${start.x} ${start.y} Q ${mx} ${my} ${end.x} ${end.y}`, control: { x: mx, y: my } };
}

export function quadraticPoint(start, control, end, t = 0.5) {
  const mt = 1 - t;
  return {
    x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
    y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
  };
}
