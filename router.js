import { quadraticPoint } from './hex.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function rectDistance(point, rect) {
  const dx = Math.max(rect.minX - point.x, 0, point.x - rect.maxX);
  const dy = Math.max(rect.minY - point.y, 0, point.y - rect.maxY);
  return Math.hypot(dx, dy);
}

function pointInsideRect(point, rect) {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
}

function pointInPolygon(point, polygon = []) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distancePointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy || 1;
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length2, 0, 1);
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function polygonDistance(point, polygon = []) {
  if (!polygon.length) return Infinity;
  if (pointInPolygon(point, polygon)) return 0;
  let best = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    best = Math.min(best, distancePointToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]));
  }
  return best;
}

function orientation(a, b, c) {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) < 1e-7) return 0;
  return Math.sign(value);
}

function segmentsCross(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

function controlFromOffset(start, end, offset = { along: 0, perpendicular: 0.22 }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return {
    x: midpoint.x + ux * length * (offset.along || 0) + nx * length * (offset.perpendicular || 0),
    y: midpoint.y + uy * length * (offset.along || 0) + ny * length * (offset.perpendicular || 0),
  };
}

export function offsetFromControl(start, end, control) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const vx = control.x - midpoint.x;
  const vy = control.y - midpoint.y;
  return {
    along: clamp((vx * ux + vy * uy) / length, -0.65, 0.65),
    perpendicular: clamp((vx * nx + vy * ny) / length, -0.95, 0.95),
  };
}

export function sampleQuadratic(start, control, end, count = 36) {
  return Array.from({ length: count + 1 }, (_, index) => quadraticPoint(start, control, end, index / count));
}

function approximateLength(points) {
  let result = 0;
  for (let index = 1; index < points.length; index += 1) {
    result += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return result;
}

function normalizedDot(a, b) {
  const la = Math.hypot(a.x, a.y) || 1;
  const lb = Math.hypot(b.x, b.y) || 1;
  return (a.x * b.x + a.y * b.y) / (la * lb);
}

function obstaclePenalty(point, obstacle) {
  if (obstacle.polygon?.length) {
    const distance = polygonDistance(point, obstacle.polygon);
    if (distance === 0) return 15000;
    if (distance < 54) return (54 - distance) * 24;
    return 0;
  }
  if (pointInsideRect(point, obstacle)) return 13500;
  const distance = rectDistance(point, obstacle);
  return distance < 48 ? (48 - distance) * 22 : 0;
}

function outwardPenalty({ start, control, end, sourceCenter, targetCenter }) {
  let score = 0;
  if (sourceCenter) {
    const outward = { x: start.x - sourceCenter.x, y: start.y - sourceCenter.y };
    const tangent = { x: control.x - start.x, y: control.y - start.y };
    const dot = normalizedDot(outward, tangent);
    if (dot < 0) score += 11000 + Math.abs(dot) * 4500;
    else if (dot < 0.28) score += (0.28 - dot) * 1200;
  }
  if (targetCenter) {
    // The incoming tangent should point from the outside towards the target centre.
    const inward = { x: targetCenter.x - end.x, y: targetCenter.y - end.y };
    const tangent = { x: end.x - control.x, y: end.y - control.y };
    const dot = normalizedDot(inward, tangent);
    if (dot < 0) score += 11000 + Math.abs(dot) * 4500;
    else if (dot < 0.28) score += (0.28 - dot) * 1200;
  }
  return score;
}

function mapInteriorPenalty(start, control, end, mapCenter) {
  if (!mapCenter) return 0;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const directDistance = Math.hypot(midpoint.x - mapCenter.x, midpoint.y - mapCenter.y);
  const controlDistance = Math.hypot(control.x - mapCenter.x, control.y - mapCenter.y);
  // Prefer the side that opens towards the exterior when both alternatives are otherwise valid.
  return Math.max(0, directDistance - controlDistance) * 1.65;
}

function curveScore({ start, control, end, samples, obstacles, labelRects, existingRoutes, sourceCenter, targetCenter, mapCenter, preference, continuityOffset }) {
  let score = 0;
  const directLength = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  score += (approximateLength(samples) - directLength) * 0.16;
  if (directLength >= 300) score += outwardPenalty({ start, control, end, sourceCenter, targetCenter });
  score += mapInteriorPenalty(start, control, end, mapCenter);

  let hardCollisions = 0;
  for (let index = 2; index < samples.length - 2; index += 1) {
    const point = samples[index];
    for (const obstacle of obstacles) {
      const penalty = obstaclePenalty(point, obstacle);
      if (penalty >= 10000) hardCollisions += 1;
      score += penalty;
    }
    for (const rect of labelRects) {
      if (pointInsideRect(point, rect)) score += 5200;
      else {
        const distance = rectDistance(point, rect);
        if (distance < 28) score += (28 - distance) * 12;
      }
    }
  }

  let crossings = 0;
  for (const route of existingRoutes) {
    for (let a = 1; a < samples.length; a += 1) {
      for (let b = 1; b < route.length; b += 1) {
        if (segmentsCross(samples[a - 1], samples[a], route[b - 1], route[b])) crossings += 1;
      }
    }
  }
  score += crossings * 980;

  if (preference) {
    const offset = offsetFromControl(start, end, control);
    score += Math.abs(offset.along - (preference.along || 0)) * 145;
    score += Math.abs(offset.perpendicular - (preference.perpendicular || 0)) * 220;
  }
  if (continuityOffset) {
    const offset = offsetFromControl(start, end, control);
    score += Math.abs(offset.along - continuityOffset.along) * 110;
    score += Math.abs(offset.perpendicular - continuityOffset.perpendicular) * 170;
  }
  return { score, hardCollisions, crossings };
}

function candidatesFor(relation, previousOffset = null) {
  const routing = relation.routing || {};
  if (routing.mode === 'manual' || routing.mode === 'assisted') {
    const preferred = routing.offset || { along: 0, perpendicular: 0.22 };
    if (routing.mode === 'manual') return [preferred];
    const alongNudges = [-0.08, -0.04, 0, 0.04, 0.08];
    const perpendicularNudges = [-0.08, -0.04, 0, 0.04, 0.08];
    return alongNudges.flatMap((along) => perpendicularNudges.map((perpendicular) => ({
      along: clamp((preferred.along || 0) + along, -0.65, 0.65),
      perpendicular: clamp((preferred.perpendicular || 0.22) + perpendicular, -0.95, 0.95),
    })));
  }
  const perps = [0.08, -0.08, 0.14, -0.14, 0.21, -0.21, 0.30, -0.30, 0.42, -0.42, 0.56, -0.56, 0.72, -0.72, 0.88, -0.88];
  const alongs = [0, -0.08, 0.08, -0.17, 0.17, -0.30, 0.30];
  const candidates = perps.flatMap((perpendicular) => alongs.map((along) => ({ along, perpendicular })));
  if (previousOffset) {
    candidates.unshift(
      previousOffset,
      { along: previousOffset.along, perpendicular: clamp(previousOffset.perpendicular - .035, -.95, .95) },
      { along: previousOffset.along, perpendicular: clamp(previousOffset.perpendicular + .035, -.95, .95) },
    );
  }
  return candidates.filter((candidate, index, list) => index === list.findIndex((other) => (
    Math.abs(other.along - candidate.along) < 1e-6 && Math.abs(other.perpendicular - candidate.perpendicular) < 1e-6
  )));
}

function structurallyBetter(candidate, incumbent) {
  if (!incumbent) return true;
  if (candidate.hardCollisions !== incumbent.hardCollisions) return candidate.hardCollisions < incumbent.hardCollisions;
  if (candidate.crossings !== incumbent.crossings) return candidate.crossings < incumbent.crossings;
  return candidate.score < incumbent.score;
}

export function routeRelation({ relation, start, end, sourceCenter, targetCenter, mapCenter, obstacles = [], labelRects = [], existingRoutes = [], previousOffset = null, hysteresis = 220 }) {
  const routing = relation.routing || { mode: 'auto' };
  let candidates = candidatesFor(relation, routing.mode === 'auto' ? previousOffset : null);
  const directDistance = Math.hypot(end.x - start.x, end.y - start.y);
  if (routing.mode === 'auto' && directDistance < 300) {
    const shortCandidates = [-.56, -.42, .42, .56].map((perpendicular) => ({ along: 0, perpendicular }));
    if (previousOffset && Math.abs(previousOffset.along) <= .08 && Math.abs(previousOffset.perpendicular) <= .56) shortCandidates.unshift(previousOffset);
    candidates = shortCandidates;
  }
  let best = null;
  let previous = null;
  for (const offset of candidates) {
    const control = controlFromOffset(start, end, offset);
    const samples = sampleQuadratic(start, control, end);
    const metrics = curveScore({
      start, control, end, samples, obstacles, labelRects, existingRoutes,
      sourceCenter, targetCenter, mapCenter,
      preference: routing.mode === 'assisted' ? routing.offset : null,
      continuityOffset: routing.mode === 'auto' ? previousOffset : null,
    });
    const candidate = { ...metrics, control, samples, offset };
    if (previousOffset && Math.abs(offset.along - previousOffset.along) < 1e-6 && Math.abs(offset.perpendicular - previousOffset.perpendicular) < 1e-6) previous = candidate;
    if (structurallyBetter(candidate, best)) best = candidate;
  }
  if (previous && best && previous.hardCollisions === best.hardCollisions && previous.crossings === best.crossings && previous.score <= best.score + hysteresis) best = previous;
  const control = best?.control || controlFromOffset(start, end, { along: 0, perpendicular: 0.2 });
  const samples = best?.samples || sampleQuadratic(start, control, end);
  return {
    d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    control,
    samples,
    score: best?.score || 0,
    hardCollisions: best?.hardCollisions || 0,
    crossings: best?.crossings || 0,
    offset: best?.offset || { along: 0, perpendicular: 0.2 },
  };
}
