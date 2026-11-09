import { getWalls, heightAlong, wallEndHeights } from './geometry';
import type { Opening, OpeningType, PatternMatch, Project, Room, Wallpaper, WallpaperAssignment } from './types';

export const DEFAULT_WALL_HEIGHT = 2500;

export const OPENING_DEFAULTS: Record<OpeningType, { width: number; height: number; sillHeight: number }> = {
  door: { width: 900, height: 2100, sillHeight: 0 },
  window: { width: 1200, height: 1200, sillHeight: 900 },
  cabinet: { width: 600, height: 2100, sillHeight: 0 },
  other: { width: 600, height: 600, sillHeight: 0 },
};

export const OPENING_LABELS: Record<OpeningType, string> = {
  door: 'Door',
  window: 'Window',
  cabinet: 'Cabinet',
  other: 'Other opening',
};

// ---------- wallpaper ----------

export const PATTERN_MATCH_LABELS: Record<PatternMatch, string> = {
  free: 'Free match (no pattern to line up)',
  straight: 'Straight match',
  offset: 'Offset / half-drop match',
};

export interface WallpaperPreset {
  label: string;
  rollWidth: number;
  rollLength: number;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { label: '53 cm × 10.05 m (standard)', rollWidth: 530, rollLength: 10_050 },
  { label: '70 cm × 10.05 m (wide)', rollWidth: 700, rollLength: 10_050 },
  { label: '106 cm × 10.05 m (double)', rollWidth: 1060, rollLength: 10_050 },
];

export const WALLPAPER_COLORS = [
  '#c9a27e',
  '#d98f8f',
  '#e2b65c',
  '#9fbf7f',
  '#6fb3a8',
  '#7fa6d6',
  '#a08fd0',
  '#c88fc0',
  '#9a9a9a',
  '#5f6f8a',
];

export function newWallpaper(id: string, existing: Wallpaper[]): Wallpaper {
  const preset = WALLPAPER_PRESETS[0];
  return {
    id,
    name: `Wallpaper ${existing.length + 1}`,
    color: WALLPAPER_COLORS[existing.length % WALLPAPER_COLORS.length],
    rollWidth: preset.rollWidth,
    rollLength: preset.rollLength,
    patternRepeat: 0,
    match: 'free',
    rollStartsAtPattern: false,
    pricePerRoll: null,
  };
}

// ---------- project ----------

export const CURRENT_VERSION = 9;

/** Default trim allowance per cut end: 5 cm. */
export const DEFAULT_TRIM_PER_END = 50;

export const emptyProject = (): Project => ({
  version: 9,
  name: 'My home',
  currency: '€',
  trimPerEnd: DEFAULT_TRIM_PER_END,
  rooms: [],
  openings: [],
  wallpapers: [],
  wallpaperAssignments: [],
});

export const newId = (): string => crypto.randomUUID();

// ---------- validation of loaded data ----------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isPoint = (v: unknown): boolean => isObj(v) && isNum(v.x) && isNum(v.y);

function isRoom(v: unknown): v is Room {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    isNum(v.wallHeight) &&
    v.wallHeight > 0 &&
    Array.isArray(v.points) &&
    v.points.length >= 3 &&
    v.points.every(isPoint) &&
    Array.isArray(v.cornerHeights) &&
    v.cornerHeights.length === v.points.length &&
    v.cornerHeights.every((h) => h === null || (isNum(h) && h > 0))
  );
}

function isOpening(v: unknown): v is Opening {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.roomId === 'string' &&
    Number.isInteger(v.wallIndex) &&
    (v.type === 'door' || v.type === 'window' || v.type === 'cabinet' || v.type === 'other') &&
    isNum(v.offset) &&
    isNum(v.width) &&
    isNum(v.height) &&
    isNum(v.sillHeight)
  );
}

function isWallpaper(v: unknown): v is Wallpaper {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.color === 'string' &&
    isNum(v.rollWidth) &&
    v.rollWidth > 0 &&
    isNum(v.rollLength) &&
    v.rollLength > 0 &&
    isNum(v.patternRepeat) &&
    v.patternRepeat >= 0 &&
    (v.match === 'free' || v.match === 'straight' || v.match === 'offset') &&
    typeof v.rollStartsAtPattern === 'boolean' &&
    (v.pricePerRoll === null || (isNum(v.pricePerRoll) && v.pricePerRoll >= 0))
  );
}

function isAssignment(v: unknown): v is WallpaperAssignment {
  return (
    isObj(v) &&
    typeof v.roomId === 'string' &&
    Number.isInteger(v.wallIndex) &&
    typeof v.wallpaperId === 'string' &&
    isNum(v.startHeight) &&
    v.startHeight >= 0
  );
}

/** Checks the shape of untrusted data (localStorage, imported files). Current version only. */
export function isProject(v: unknown): v is Project {
  if (!isObj(v) || v.version !== CURRENT_VERSION || typeof v.name !== 'string' || typeof v.currency !== 'string') return false;
  if (!isNum(v.trimPerEnd) || v.trimPerEnd < 0) return false;
  if (![v.rooms, v.openings, v.wallpapers, v.wallpaperAssignments].every(Array.isArray)) return false;
  const p = v as unknown as Project;
  if (!p.rooms.every(isRoom) || !p.openings.every(isOpening)) return false;
  if (!p.wallpapers.every(isWallpaper) || !p.wallpaperAssignments.every(isAssignment)) return false;

  const rooms = new Map(p.rooms.map((r) => [r.id, r]));
  const onValidWall = (x: { roomId: string; wallIndex: number }) => {
    const room = rooms.get(x.roomId);
    return room !== undefined && x.wallIndex >= 0 && x.wallIndex < room.points.length;
  };
  if (!p.openings.every(onValidWall)) return false;

  const wallpaperIds = new Set(p.wallpapers.map((w) => w.id));
  const walls = new Set<string>();
  return p.wallpaperAssignments.every((a) => {
    const key = `${a.roomId}:${a.wallIndex}`;
    if (walls.has(key)) return false; // one wallpaper per wall
    walls.add(key);
    return onValidWall(a) && wallpaperIds.has(a.wallpaperId);
  });
}

function cornerHeightsFromV3(r: unknown): unknown {
  if (!isObj(r) || !Array.isArray(r.points)) return r;
  const n = r.points.length;
  const own: unknown[] = Array.isArray(r.wallHeights) ? r.wallHeights : [];
  const ownAt = (i: number) => (isNum(own[i]) ? own[i] : null);
  const cornerHeights = r.points.map((_, j) => {
    const hs = [ownAt(j), ownAt((j - 1 + n) % n)].filter((h): h is number => h !== null);
    return hs.length ? Math.max(...hs) : null;
  });
  const { wallHeights: _dropped, ...rest } = r;
  return { ...rest, cornerHeights };
}

/**
 * v7: the "gap at the left/right end" of a wallpapered wall (startInset / endInset) becomes a cabinet object
 * on that wall, from the floor to the ceiling, so the wallpaper goes around it like around a door.
 */
function gapsToCabinets(v: Record<string, unknown>): Record<string, unknown> {
  const rooms = Array.isArray(v.rooms) ? v.rooms : [];
  const cabinets: Opening[] = [];
  const wallpaperAssignments = Array.isArray(v.wallpaperAssignments)
    ? v.wallpaperAssignments.map((a) => {
        if (!isObj(a)) return a;
        const { startInset, endInset, ...rest } = a;
        const room = rooms.find((r) => isObj(r) && r.id === a.roomId) as Room | undefined;
        const wall = room && Array.isArray(room.points) && Array.isArray(room.cornerHeights) ? getWalls(room)[a.wallIndex as number] : undefined;
        if (room && wall) {
          const heights = wallEndHeights(room, wall.index);
          const add = (offset: number, width: number) => {
            const ceiling = Math.min(heightAlong(heights, wall.length, offset), heightAlong(heights, wall.length, offset + width));
            cabinets.push({ id: newId(), roomId: room.id, wallIndex: wall.index, type: 'cabinet', offset, width, height: ceiling, sillHeight: 0 });
          };
          const s = isNum(startInset) ? Math.min(startInset, wall.length) : 0;
          const e = isNum(endInset) ? Math.min(endInset, wall.length - s) : 0;
          if (s >= 0.5) add(0, s);
          if (e >= 0.5) add(wall.length - e, e);
        }
        return rest;
      })
    : v.wallpaperAssignments;
  const openings = Array.isArray(v.openings) ? [...v.openings, ...cabinets] : v.openings;
  return { ...v, version: 7, openings, wallpaperAssignments };
}

/** Upgrade older saved projects to the current version. Returns null if the data isn't a project. */
export function migrateProject(v: unknown): Project | null {
  if (isObj(v) && v.version === 1) {
    v = { ...v, version: 2, currency: '€', wallpapers: [], wallpaperAssignments: [] };
  }
  if (isObj(v) && (v.version === 2 || v.version === 3)) {
    // v4: ceiling height per corner. v2 rooms are level; v3 per-wall heights move to both corners of the wall
    // (where two walls with their own height meet, the higher one wins).
    const rooms = Array.isArray(v.rooms) ? v.rooms.map(cornerHeightsFromV3) : v.rooms;
    v = { ...v, version: 4, rooms };
  }
  if (isObj(v) && v.version === 4) {
    // v5: wallpaper can start above the floor. Existing wallpaper starts at the floor.
    const wallpaperAssignments = Array.isArray(v.wallpaperAssignments)
      ? v.wallpaperAssignments.map((a) => (isObj(a) ? { ...a, startHeight: 0 } : a))
      : v.wallpaperAssignments;
    v = { ...v, version: 5, wallpaperAssignments };
  }
  if (isObj(v) && v.version === 5) {
    // v6: wallpaper can stop short of a corner. Existing wallpaper covers the full width.
    const wallpaperAssignments = Array.isArray(v.wallpaperAssignments)
      ? v.wallpaperAssignments.map((a) => (isObj(a) ? { ...a, startInset: 0, endInset: 0 } : a))
      : v.wallpaperAssignments;
    v = { ...v, version: 6, wallpaperAssignments };
  }
  if (isObj(v) && v.version === 6) v = gapsToCabinets(v);
  if (isObj(v) && v.version === 7) v = { ...v, version: 8, trimPerEnd: DEFAULT_TRIM_PER_END };
  if (isObj(v) && v.version === 8) {
    // v9: whether rolls start at the start of the pattern. Not known for existing wallpapers → false (as before).
    const wallpapers = Array.isArray(v.wallpapers)
      ? v.wallpapers.map((w) => (isObj(w) ? { ...w, rollStartsAtPattern: false } : w))
      : v.wallpapers;
    v = { ...v, version: 9, wallpapers };
  }
  return isProject(v) ? v : null;
}
