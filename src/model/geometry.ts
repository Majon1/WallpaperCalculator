import type { Opening, Point, Room, Wall } from './types';

// ---------- vector helpers ----------

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

export const samePoint = (a: Point, b: Point, eps = 0.01): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

export const roundTo = (value: number, step: number): number => Math.round(value / step) * step + 0;

/** Round to 0.01 mm to keep stored coordinates tidy (and turn -0 into 0). */
export const roundPoint = (p: Point): Point => ({
  x: Math.round(p.x * 100) / 100 + 0,
  y: Math.round(p.y * 100) / 100 + 0,
});

export function unitVector(a: Point, b: Point): Point {
  const len = distance(a, b);
  return len === 0 ? { x: 0, y: 0 } : { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** Point at `length` from `from`, in the direction of `toward`. */
export function pointAlong(from: Point, toward: Point, length: number): Point {
  return roundPoint(add(from, scale(unitVector(from, toward), length)));
}

// ---------- polygons ----------

/** Shoelace area. Positive = clockwise on screen (y points down). */
export function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export const polygonArea = (points: Point[]): number => Math.abs(signedArea(points));

export function perimeter(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += distance(points[i], points[(i + 1) % points.length]);
  return total;
}

export function centroid(points: Point[]): Point {
  const area = signedArea(points);
  if (Math.abs(area) < 1e-9) {
    const sum = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return scale(sum, 1 / Math.max(points.length, 1));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

export function getWalls(room: Room): Wall[] {
  return room.points.map((start, index) => {
    const end = room.points[(index + 1) % room.points.length];
    return { roomId: room.id, index, start, end, length: distance(start, end) };
  });
}

// ---------- heights ----------

/** Ceiling height at corner `index`: its own height if set, otherwise the room's. */
export function cornerHeightOf(room: Room, index: number): number {
  return room.cornerHeights[index] ?? room.wallHeight;
}

/** Ceiling height at the start and end corner of wall `index`. */
export function wallEndHeights(room: Room, index: number): { start: number; end: number } {
  return { start: cornerHeightOf(room, index), end: cornerHeightOf(room, (index + 1) % room.points.length) };
}

/** Ceiling height at distance `along` from the wall start (linear between the two corners, clamped to the wall). */
export function heightAlong(heights: { start: number; end: number }, wallLength: number, along: number): number {
  if (wallLength <= 0) return Math.min(heights.start, heights.end);
  const t = Math.min(1, Math.max(0, along / wallLength));
  return heights.start + (heights.end - heights.start) * t;
}

/** Gross area of a wall whose top runs straight from `start` to `end` height (a trapezoid). */
export function wallGrossArea(wallLength: number, heights: { start: number; end: number }): number {
  return (wallLength * (heights.start + heights.end)) / 2;
}

/** Unit normal of wall `index` pointing out of the room. */
export function outwardNormal(points: Point[], index: number): Point {
  const u = unitVector(points[index], points[(index + 1) % points.length]);
  // With y pointing down and clockwise winding (positive area), (-u.y, u.x) points inward.
  const inward = signedArea(points) >= 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
  return { x: -inward.x + 0, y: -inward.y + 0 };
}

/**
 * Standing inside the room facing wall `index`: is the wall's start corner on your left?
 * Used to draw the wall view (elevation) the way you'd see it.
 */
export function wallStartIsOnLeft(points: Point[], index: number): boolean {
  const n = outwardNormal(points, index);
  const right = { x: -n.y, y: n.x }; // facing n with y pointing down
  return dot(sub(points[(index + 1) % points.length], points[index]), right) >= 0;
}

// ---------- validation ----------

function orient(a: Point, b: Point, c: Point): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(v) < 1e-9 ? 0 : Math.sign(v);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a.x, b.x) - 1e-9 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= p.y &&
    p.y <= Math.max(a.y, b.y) + 1e-9
  );
}

/** True if segments p1-p2 and p3-p4 touch or cross. */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, p3)) return true;
  if (o2 === 0 && onSegment(p1, p2, p4)) return true;
  if (o3 === 0 && onSegment(p3, p4, p1)) return true;
  if (o4 === 0 && onSegment(p3, p4, p2)) return true;
  return false;
}

export function isSelfIntersecting(points: Point[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsIntersect(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

export const MIN_ROOM_AREA = 10_000; // 0.01 m²

/** Returns a user-facing reason why the polygon isn't a valid room, or null if it is. */
export function roomError(points: Point[]): string | null {
  if (points.length < 3) return 'A room needs at least 3 corners.';
  for (let i = 0; i < points.length; i++) {
    if (distance(points[i], points[(i + 1) % points.length]) < 1) return 'Two corners are on top of each other.';
  }
  if (isSelfIntersecting(points)) return 'Walls cross each other.';
  if (polygonArea(points) < MIN_ROOM_AREA) return 'The room is too small.';
  return null;
}

/**
 * Reasons an opening doesn't fit on its wall. Empty array = fits.
 * The wall's top may slope from `startHeight` to `endHeight`; the opening must stay below it across its whole width.
 */
export function openingProblems(opening: Opening, wallLength: number, startHeight: number, endHeight = startHeight): string[] {
  const heights = { start: startHeight, end: endHeight };
  const ceiling = Math.min(
    heightAlong(heights, wallLength, opening.offset),
    heightAlong(heights, wallLength, opening.offset + opening.width),
  );
  const tol = 0.5;
  const problems: string[] = [];
  if (opening.width <= 0) problems.push('Width must be greater than 0.');
  if (opening.height <= 0) problems.push('Height must be greater than 0.');
  if (opening.offset < -tol) problems.push('Starts before the beginning of the wall.');
  if (opening.offset + opening.width > wallLength + tol) problems.push('Extends past the end of the wall.');
  if (opening.sillHeight < -tol) problems.push('Height above floor cannot be negative.');
  if (opening.sillHeight + opening.height > ceiling + tol) problems.push('Reaches above the ceiling.');
  return problems;
}

// ---------- dimensions ----------

export interface DimensionSegment {
  /** Distances along the wall from its start corner, in mm. */
  from: number;
  to: number;
  kind: 'gap' | 'opening';
  openingId?: string;
}

/**
 * Split a wall into a chain of measurements: corner → opening → gap → opening → … → corner.
 * Openings are clamped to the wall; overlapping openings don't produce negative gaps.
 */
export function wallDimensionChain(
  wallLength: number,
  openings: Pick<Opening, 'id' | 'offset' | 'width'>[],
): DimensionSegment[] {
  const tol = 0.5;
  const clampToWall = (v: number) => Math.min(wallLength, Math.max(0, v));
  const segments: DimensionSegment[] = [];
  let pos = 0;
  for (const o of [...openings].sort((a, b) => a.offset - b.offset)) {
    const start = clampToWall(o.offset);
    const end = clampToWall(o.offset + o.width);
    if (start - pos > tol) segments.push({ from: pos, to: start, kind: 'gap' });
    const from = Math.max(start, pos);
    if (end - from > tol) segments.push({ from, to: end, kind: 'opening', openingId: o.id });
    pos = Math.max(pos, end);
  }
  if (wallLength - pos > tol) segments.push({ from: pos, to: wallLength, kind: 'gap' });
  return segments;
}

// ---------- snapping ----------

export const snapToGrid = (p: Point, step: number): Point => ({ x: roundTo(p.x, step), y: roundTo(p.y, step) });

/** Snap the direction from→to to multiples of `angleStepDeg` and the length to `lengthStep` (0 = no length snap). */
export function snapDirection(from: Point, to: Point, angleStepDeg: number, lengthStep: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { ...from };
  const step = (angleStepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const snappedLen = lengthStep > 0 ? roundTo(len, lengthStep) : len;
  return roundPoint({ x: from.x + Math.cos(angle) * snappedLen, y: from.y + Math.sin(angle) * snappedLen });
}

// ---------- edits ----------

export const translatePoints = (points: Point[], delta: Point): Point[] =>
  points.map((p) => roundPoint(add(p, delta)));

/**
 * Change the length of wall `index` by moving its end corner and the following corner
 * along the wall direction. The following wall keeps its length and angle.
 */
export function setWallLength(points: Point[], index: number, newLength: number): Point[] {
  const n = points.length;
  const endIdx = (index + 1) % n;
  const nextIdx = (index + 2) % n;
  const a = points[index];
  const b = points[endIdx];
  const len = distance(a, b);
  if (len === 0) return points;
  const shift = scale(unitVector(a, b), newLength - len);
  return points.map((p, i) => (i === endIdx || (i === nextIdx && nextIdx !== index) ? roundPoint(add(p, shift)) : p));
}

/** Move both corners of wall `index` by `delta`. */
export function offsetWall(points: Point[], index: number, delta: Point): Point[] {
  const endIdx = (index + 1) % points.length;
  return points.map((p, i) => (i === index || i === endIdx ? roundPoint(add(p, delta)) : p));
}
