import { getWalls, heightAlong, wallEndHeights } from './geometry';
import type { Opening, PatternMatch, Project, WallpaperAssignment } from './types';

export interface StripLayout {
  /** Seam positions measured from the starting corner (excludes 0 and the wall length). */
  seams: number[];
  /** Number of strips needed to cover the wall width. */
  count: number;
  /** Width of the last strip (equals stripWidth when it fits exactly). */
  lastWidth: number;
}

/**
 * Divide a wall into vertical strips of `stripWidth`, starting at one corner.
 * A remainder narrower than 0.5 mm is treated as an exact fit.
 */
export function stripLayout(wallLength: number, stripWidth: number): StripLayout {
  if (wallLength <= 0 || stripWidth <= 0) return { seams: [], count: 0, lastWidth: 0 };
  const tol = 0.5;
  const count = Math.max(1, Math.ceil((wallLength - tol) / stripWidth));
  const seams = Array.from({ length: count - 1 }, (_, i) => (i + 1) * stripWidth);
  return { seams, count, lastWidth: wallLength - (count - 1) * stripWidth };
}

/**
 * Heights (from the floor) where a pattern repeat starts within strip `stripIndex` (0 = first strip).
 * Strip 1's pattern starts at the floor. With a straight match every strip is the same;
 * with an offset (half-drop) match every second strip is shifted up by half the repeat.
 * Free match (or no repeat) has nothing to line up, so no heights.
 */
export function patternStartHeights(
  wallHeight: number,
  patternRepeat: number,
  match: PatternMatch,
  stripIndex: number,
): number[] {
  if (match === 'free' || patternRepeat <= 0 || wallHeight <= 0) return [];
  const shift = match === 'offset' && stripIndex % 2 === 1 ? patternRepeat / 2 : 0;
  const heights: number[] = [];
  for (let z = shift; z < wallHeight - 0.5; z += patternRepeat) heights.push(z);
  return heights;
}

/**
 * How many whole pattern repeats one roll holds, and the length left over after them.
 * A remainder under 0.5 mm counts as an exact fit. null when there is no repeat.
 */
export function repeatsPerRoll(rollLength: number, patternRepeat: number): { count: number; leftover: number } | null {
  if (patternRepeat <= 0 || rollLength <= 0) return null;
  const count = Math.floor((rollLength + 0.5) / patternRepeat);
  return { count, leftover: Math.max(0, rollLength - count * patternRepeat) };
}

type Heights = { start: number; end: number };
type OpeningBox = Pick<Opening, 'offset' | 'width' | 'height' | 'sillHeight'>;

/** Area under a sloped ceiling and above height `from`: integral of max(0, ceiling(x) - from) along the wall. */
function areaAbove(wallLength: number, heights: Heights, from: number): number {
  const a = heights.start - from;
  const b = heights.end - from;
  if (a >= 0 && b >= 0) return (wallLength * (a + b)) / 2;
  if (a <= 0 && b <= 0) return 0;
  // The ceiling crosses `from`: only a triangle is left.
  const pos = Math.max(a, b);
  return (wallLength * pos * pos) / (2 * (pos - Math.min(a, b)));
}

/**
 * Wall area covered by wallpaper (mm²): from `startHeight` up to the (possibly sloped) ceiling,
 * minus doors, windows, cabinets and other openings. Openings are clamped to the wall, to the part
 * above `startHeight`, and to the ceiling (the lower ceiling height across their width). Where openings
 * overlap, the overlap is only taken off once.
 */
export function wallpaperedArea(wallLength: number, heights: Heights, startHeight: number, openings: OpeningBox[]): number {
  if (wallLength <= 0) return 0;
  const gross = areaAbove(wallLength, heights, startHeight);
  // Each opening as a box along the wall [x1, x2] by height [z1, z2], limited to the papered part.
  const boxes = openings
    .map((o) => {
      const x1 = Math.max(0, o.offset);
      const x2 = Math.min(wallLength, o.offset + o.width);
      const ceiling = Math.min(heightAlong(heights, wallLength, x1), heightAlong(heights, wallLength, x2));
      return { x1, x2, z1: Math.max(startHeight, o.sillHeight), z2: Math.min(ceiling, o.sillHeight + o.height) };
    })
    .filter((b) => b.x2 > b.x1 && b.z2 > b.z1);
  // Sweep along the wall: between two box edges the set of boxes is fixed, so take the union of their heights.
  const xs = [...new Set(boxes.flatMap((b) => [b.x1, b.x2]))].sort((p, q) => p - q);
  let cut = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const left = xs[i];
    const right = xs[i + 1];
    const spans = boxes
      .filter((b) => b.x1 <= left && b.x2 >= right)
      .map((b) => [b.z1, b.z2] as const)
      .sort((p, q) => p[0] - q[0]);
    let covered = 0;
    let top = -Infinity;
    for (const [z1, z2] of spans) {
      if (z2 <= top) continue;
      covered += z2 - Math.max(z1, top);
      top = z2;
    }
    cut += (right - left) * covered;
  }
  return Math.max(0, gross - cut);
}

/** Wallpapered area of one assignment in a project (mm²); 0 if its wall no longer exists. */
export function assignmentArea(project: Project, assignment: WallpaperAssignment): number {
  const room = project.rooms.find((r) => r.id === assignment.roomId);
  const wall = room && getWalls(room)[assignment.wallIndex];
  if (!room || !wall) return 0;
  const openings = project.openings.filter((o) => o.roomId === room.id && o.wallIndex === wall.index);
  return wallpaperedArea(wall.length, wallEndHeights(room, wall.index), assignment.startHeight, openings);
}

/** A vertical stretch of a strip, as heights above the floor. */
export interface HeightRange {
  from: number;
  to: number;
}

export interface StripPlan {
  /** 0 = first strip from the left corner (as seen from inside the room). */
  index: number;
  /** Position across the wall, measured from the left corner. */
  left: number;
  right: number;
  /** Top of the strip: the ceiling at its higher edge. */
  top: number;
  /** The pieces of paper this strip needs, bottom to top. */
  pieces: HeightRange[];
  /** Parts of the strip that need no paper because something covers its whole width. */
  saved: HeightRange[];
  /**
   * Where openings / cabinets overlap this strip: the rectangle to cut out of the paper, clipped to the strip
   * (`left`/`right` across the wall from the left corner, `from`/`to` heights). `opening` = index in the input list.
   * `full` = it covers the strip's whole width (that part is in `saved`).
   */
  cutouts: { opening: number; left: number; right: number; from: number; to: number; full: boolean }[];
}

/**
 * Plan the strips of one wall, from the left corner as seen from inside the room.
 * Each strip runs from `startHeight` up to the ceiling at its higher edge. Where an opening or cabinet
 * covers the strip's whole width (within 0.5 mm), that height range is not needed: the strip is cut into
 * a piece below and a piece above, and the length in between is saved for use elsewhere.
 * An opening that covers only part of a strip's width saves nothing (the strip is trimmed around it).
 * `leftIsStart`: whether the wall's start corner is on the left (see `wallStartIsOnLeft`).
 */
export function stripPlan(
  wallLength: number,
  heights: Heights,
  leftIsStart: boolean,
  startHeight: number,
  stripWidth: number,
  openings: OpeningBox[],
): StripPlan[] {
  const layout = stripLayout(wallLength, stripWidth);
  const ceilingAtLeft = (x: number) => heightAlong(heights, wallLength, leftIsStart ? x : wallLength - x);
  // Openings in left-corner coordinates.
  const boxes = openings.map((o) => {
    const x1 = leftIsStart ? o.offset : wallLength - o.offset - o.width;
    return { x1, x2: x1 + o.width, z1: o.sillHeight, z2: o.sillHeight + o.height };
  });
  const tol = 0.5;
  return Array.from({ length: layout.count }, (_, index) => {
    const left = index * stripWidth;
    const right = index === layout.count - 1 ? wallLength : left + stripWidth;
    const top = Math.max(ceilingAtLeft(left), ceilingAtLeft(right));
    if (top - startHeight < tol) return { index, left, right, top, pieces: [], saved: [], cutouts: [] };
    const cutouts = boxes
      .map((b, opening) => ({
        opening,
        left: Math.max(left, b.x1),
        right: Math.min(right, b.x2),
        from: Math.max(startHeight, b.z1),
        to: Math.min(top, b.z2),
        full: b.x1 <= left + tol && b.x2 >= right - tol,
      }))
      .filter((c) => c.right - c.left >= tol && c.to - c.from >= tol);
    // Height ranges covered across the whole strip width, merged.
    const blocks = boxes
      .filter((b) => b.x1 <= left + tol && b.x2 >= right - tol)
      .map((b) => ({ from: Math.max(startHeight, b.z1), to: Math.min(top, b.z2) }))
      .filter((b) => b.to - b.from >= tol)
      .sort((a, b) => a.from - b.from);
    const saved: HeightRange[] = [];
    for (const b of blocks) {
      const last = saved[saved.length - 1];
      if (last && b.from <= last.to + tol) last.to = Math.max(last.to, b.to);
      else saved.push({ ...b });
    }
    const pieces: HeightRange[] = [];
    let z = startHeight;
    for (const b of saved) {
      if (b.from - z >= tol) pieces.push({ from: z, to: b.from });
      z = b.to;
    }
    if (top - z >= tol) pieces.push({ from: z, to: top });
    return { index, left, right, top, pieces, saved, cutouts };
  });
}

/** Total length of a list of height ranges. */
export const rangeLength = (ranges: HeightRange[]): number => ranges.reduce((sum, r) => sum + r.to - r.from, 0);
