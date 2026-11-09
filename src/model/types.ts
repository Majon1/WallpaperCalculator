/** All lengths are in millimetres, areas in mm². See SPEC.md, Part 1. */

export type Id = string;

export interface Point {
  x: number;
  y: number;
}

export interface Room {
  id: Id;
  name: string;
  /** Corners in order. Wall i runs from points[i] to points[(i + 1) % n]. */
  points: Point[];
  /** Default ceiling height (floor to ceiling). */
  wallHeight: number;
  /**
   * Ceiling height at each corner, same length as `points`. null = use `wallHeight`.
   * Wall i runs from the height at corner i to the height at corner i+1 — if they differ, its top slopes.
   */
  cornerHeights: (number | null)[];
}

/** Anything on a wall that the wallpaper goes around. A cabinet is fixed furniture against the wall (no wallpaper behind it). */
export type OpeningType = 'door' | 'window' | 'cabinet' | 'other';

export interface Opening {
  id: Id;
  roomId: Id;
  wallIndex: number;
  type: OpeningType;
  /** Distance along the wall from its start corner to the opening's near edge. */
  offset: number;
  width: number;
  height: number;
  /** Distance from the floor to the bottom of the opening. */
  sillHeight: number;
}

/**
 * How the pattern lines up between neighbouring strips.
 * - free: no pattern to match (plain, textured, random) — repeat is ignored
 * - straight: the pattern continues at the same height on the next strip
 * - offset: the next strip is shifted by half the repeat (half-drop match)
 */
export type PatternMatch = 'free' | 'straight' | 'offset';

export interface Wallpaper {
  id: Id;
  name: string;
  /** Display colour (hex), used on the plan and in the wall view. */
  color: string;
  rollWidth: number;
  rollLength: number;
  /** Vertical pattern repeat. 0 = none. */
  patternRepeat: number;
  match: PatternMatch;
  /**
   * The pattern starts exactly at the start of every roll (so no repeat has to be set aside to line up the
   * first cut). Unknown / not checked = false.
   */
  rollStartsAtPattern: boolean;
  /** In the project currency. null = unknown. */
  pricePerRoll: number | null;
}

/** Wallpaper on one wall, from `startHeight` up to the ceiling. At most one per wall. */
export interface WallpaperAssignment {
  roomId: Id;
  wallIndex: number;
  wallpaperId: Id;
  /** Height above the floor where the wallpaper starts (e.g. above tiles or panelling). 0 = from the floor. */
  startHeight: number;
}

export interface Project {
  version: 9;
  name: string;
  /** Symbol shown next to prices, e.g. "€". */
  currency: string;
  /** Extra wallpaper length at each cut end of a piece, for trimming (Part 3). */
  trimPerEnd: number;
  rooms: Room[];
  openings: Opening[];
  wallpapers: Wallpaper[];
  wallpaperAssignments: WallpaperAssignment[];
}

/** Derived from a room; not stored. */
export interface Wall {
  roomId: Id;
  index: number;
  start: Point;
  end: Point;
  length: number;
}
