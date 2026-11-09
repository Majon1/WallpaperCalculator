import { create } from 'zustand';
import { getWalls, roomError, setWallLength as setWallLengthGeom } from '../model/geometry';
import { DEFAULT_WALL_HEIGHT, OPENING_DEFAULTS, emptyProject, newId, newWallpaper } from '../model/project';
import type { Id, Opening, OpeningType, Point, Project, Room, Wallpaper, WallpaperAssignment } from '../model/types';
import { loadSavedProject } from './persistence';

export type Tool = 'select' | 'draw';

export type Selection =
  | { kind: 'room'; roomId: Id }
  | { kind: 'wall'; roomId: Id; wallIndex: number }
  | { kind: 'opening'; openingId: Id }
  /** `back`: what was selected when editing started (e.g. a wall) — kept visible on the plan and in the wall view. */
  | { kind: 'wallpaper'; wallpaperId: Id; back?: Selection }
  | null;

/** The room / wall / opening the editor shows. While editing a wallpaper opened from a wall, that wall. */
export function contextSelection(sel: Selection): Selection {
  return sel?.kind === 'wallpaper' ? (sel.back ?? null) : sel;
}

const HISTORY_LIMIT = 200;

interface EditorState {
  /** Roll highlighted in the cutting plan / wall view (UI only, not saved). */
  highlightRoll: { wallpaperId: Id; roll: number } | null;
  setHighlightRoll: (h: { wallpaperId: Id; roll: number } | null) => void;
  /** What the bottom pane shows for the selected wall: the wall itself, or the rolls of its wallpaper. */
  bottomView: 'wall' | 'rolls';
  setBottomView: (v: 'wall' | 'rolls') => void;
  project: Project;
  past: Project[];
  future: Project[];
  selection: Selection;
  tool: Tool;
  /** Incremented to ask the canvas to zoom to fit. */
  fitRequest: number;
  /** Show the wall view (elevation) for the selected wall. */
  wallViewOpen: boolean;

  setTool: (tool: Tool) => void;
  setSelection: (selection: Selection) => void;
  requestFit: () => void;
  setWallViewOpen: (open: boolean) => void;

  /** Apply an undoable change. */
  commit: (fn: (p: Project) => Project) => void;
  /** Start a drag: snapshot for undo. Follow with updateLive calls. */
  beginGesture: () => void;
  /** Change without a new undo step (during a drag). */
  updateLive: (fn: (p: Project) => Project) => void;
  /** Abort a drag and restore the snapshot taken by beginGesture. */
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
}

function validSelection(sel: Selection, p: Project): Selection {
  if (!sel) return null;
  if (sel.kind === 'opening') return p.openings.some((o) => o.id === sel.openingId) ? sel : null;
  if (sel.kind === 'wallpaper') {
    if (!p.wallpapers.some((w) => w.id === sel.wallpaperId)) return validSelection(sel.back ?? null, p);
    const back = validSelection(sel.back ?? null, p);
    return back === (sel.back ?? null) ? sel : { ...sel, back: back ?? undefined };
  }
  const room = p.rooms.find((r) => r.id === sel.roomId);
  if (!room) return null;
  if (sel.kind === 'wall' && sel.wallIndex >= room.points.length) return { kind: 'room', roomId: room.id };
  return sel;
}

export const useEditor = create<EditorState>()((set) => ({
  project: loadSavedProject() ?? emptyProject(),
  past: [],
  future: [],
  selection: null,
  tool: 'select',
  fitRequest: 0,
  wallViewOpen: true,
  highlightRoll: null,
  setHighlightRoll: (highlightRoll) => set({ highlightRoll }),
  bottomView: 'wall',
  setBottomView: (bottomView) => set({ bottomView }),

  setTool: (tool) => set({ tool }),
  setSelection: (selection) => set({ selection }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  setWallViewOpen: (wallViewOpen) => set({ wallViewOpen }),

  commit: (fn) =>
    set((s) => {
      const next = fn(s.project);
      if (next === s.project) return {};
      return { project: next, past: [...s.past, s.project].slice(-HISTORY_LIMIT), future: [] };
    }),
  beginGesture: () => set((s) => ({ past: [...s.past, s.project].slice(-HISTORY_LIMIT), future: [] })),
  updateLive: (fn) => set((s) => ({ project: fn(s.project) })),
  cancelGesture: () =>
    set((s) => {
      const prev = s.past.at(-1);
      return prev ? { project: prev, past: s.past.slice(0, -1) } : {};
    }),
  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev) return {};
      return {
        project: prev,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future],
        selection: validSelection(s.selection, prev),
      };
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return {};
      return {
        project: next,
        past: [...s.past, s.project],
        future: s.future.slice(1),
        selection: validSelection(s.selection, next),
      };
    }),
}));

// ---------- actions ----------

const get = () => useEditor.getState();
const commit = (fn: (p: Project) => Project) => get().commit(fn);

const mapRoom = (p: Project, id: Id, fn: (r: Room) => Room): Project => ({
  ...p,
  rooms: p.rooms.map((r) => (r.id === id ? fn(r) : r)),
});

const mapOpening = (p: Project, id: Id, fn: (o: Opening) => Opening): Project => ({
  ...p,
  openings: p.openings.map((o) => (o.id === id ? fn(o) : o)),
});

function nextRoomName(p: Project): string {
  const names = new Set(p.rooms.map((r) => r.name));
  let n = p.rooms.length + 1;
  while (names.has(`Room ${n}`)) n++;
  return `Room ${n}`;
}

export const actions = {
  addRoom(points: Point[]): Id {
    const id = newId();
    commit((p) => ({
      ...p,
      rooms: [...p.rooms, { id, name: nextRoomName(p), points, wallHeight: DEFAULT_WALL_HEIGHT, cornerHeights: points.map(() => null) }],
    }));
    get().setSelection({ kind: 'room', roomId: id });
    return id;
  },

  /** Add a width × length rectangle to the right of existing rooms. */
  addRectRoom(width: number, length: number): Id {
    const pts = get().project.rooms.flatMap((r) => r.points);
    const x0 = pts.length ? Math.ceil((Math.max(...pts.map((p) => p.x)) + 1000) / 100) * 100 : 0;
    const y0 = pts.length ? Math.round(Math.min(...pts.map((p) => p.y)) / 100) * 100 : 0;
    const id = actions.addRoom([
      { x: x0, y: y0 },
      { x: x0 + width, y: y0 },
      { x: x0 + width, y: y0 + length },
      { x: x0, y: y0 + length },
    ]);
    get().requestFit();
    return id;
  },

  updateRoom(id: Id, patch: Partial<Omit<Room, 'id'>>) {
    commit((p) => mapRoom(p, id, (r) => ({ ...r, ...patch })));
  },

  /** Set the ceiling height of the whole room (every corner level again). */
  setRoomHeight(id: Id, height: number) {
    commit((p) => mapRoom(p, id, (r) => ({ ...r, wallHeight: height, cornerHeights: r.points.map(() => null) })));
  },

  /**
   * Set the ceiling height at some corners; null = back to the room height.
   * A wall's height = both its corners, so the walls next to it slope.
   */
  setCornerHeights(roomId: Id, corners: number[], height: number | null) {
    commit((p) =>
      mapRoom(p, roomId, (r) => ({
        ...r,
        cornerHeights: r.cornerHeights.map((h, i) => (corners.includes(i) ? (height === r.wallHeight ? null : height) : h)),
      })),
    );
  },

  setRoomPointsLive(id: Id, points: Point[]) {
    get().updateLive((p) => mapRoom(p, id, (r) => ({ ...r, points })));
  },

  deleteRoom(id: Id) {
    commit((p) => ({
      ...p,
      rooms: p.rooms.filter((r) => r.id !== id),
      openings: p.openings.filter((o) => o.roomId !== id),
      wallpaperAssignments: p.wallpaperAssignments.filter((a) => a.roomId !== id),
    }));
    get().setSelection(null);
  },

  /** Returns an error message if the new length would make the room invalid. */
  setWallLength(roomId: Id, wallIndex: number, length: number): string | null {
    const room = get().project.rooms.find((r) => r.id === roomId);
    if (!room) return null;
    const points = setWallLengthGeom(room.points, wallIndex, length);
    const error = roomError(points);
    if (error) return `Can't use that length: ${error.toLowerCase()}`;
    commit((p) => mapRoom(p, roomId, (r) => ({ ...r, points })));
    return null;
  },

  addOpening(roomId: Id, wallIndex: number, type: OpeningType): Id | null {
    const room = get().project.rooms.find((r) => r.id === roomId);
    const wall = room && getWalls(room)[wallIndex];
    if (!wall) return null;
    const defaults = OPENING_DEFAULTS[type];
    const width = Math.min(defaults.width, wall.length);
    const id = newId();
    const opening: Opening = {
      id,
      roomId,
      wallIndex,
      type,
      ...defaults,
      width,
      offset: Math.round((wall.length - width) / 2),
    };
    commit((p) => ({ ...p, openings: [...p.openings, opening] }));
    get().setSelection({ kind: 'opening', openingId: id });
    return id;
  },

  updateOpening(id: Id, patch: Partial<Omit<Opening, 'id' | 'roomId' | 'wallIndex'>>) {
    commit((p) => mapOpening(p, id, (o) => ({ ...o, ...patch })));
  },

  setOpeningLive(id: Id, patch: Partial<Pick<Opening, 'offset' | 'sillHeight'>>) {
    get().updateLive((p) => mapOpening(p, id, (o) => ({ ...o, ...patch })));
  },

  deleteOpening(id: Id) {
    commit((p) => ({ ...p, openings: p.openings.filter((o) => o.id !== id) }));
    get().setSelection(null);
  },

  deleteSelection() {
    const sel = get().selection;
    if (sel?.kind === 'room') actions.deleteRoom(sel.roomId);
    else if (sel?.kind === 'opening') actions.deleteOpening(sel.openingId);
  },

  // ---------- wallpaper ----------

  addWallpaper(): Id {
    const id = newId();
    commit((p) => ({ ...p, wallpapers: [...p.wallpapers, newWallpaper(id, p.wallpapers)] }));
    get().setSelection({ kind: 'wallpaper', wallpaperId: id });
    return id;
  },

  updateWallpaper(id: Id, patch: Partial<Omit<Wallpaper, 'id'>>) {
    commit((p) => ({ ...p, wallpapers: p.wallpapers.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  },

  deleteWallpaper(id: Id) {
    commit((p) => ({
      ...p,
      wallpapers: p.wallpapers.filter((w) => w.id !== id),
      wallpaperAssignments: p.wallpaperAssignments.filter((a) => a.wallpaperId !== id),
    }));
    get().setSelection(null);
  },

  /** Put wallpaper on the given walls of a room (null = remove). */
  setWallpaper(roomId: Id, wallIndexes: number[], wallpaperId: Id | null) {
    commit((p) => {
      const others = p.wallpaperAssignments.filter((a) => !(a.roomId === roomId && wallIndexes.includes(a.wallIndex)));
      // Changing the wallpaper keeps where it starts and stops on that wall.
      const placementOf = (wallIndex: number) => {
        const a = p.wallpaperAssignments.find((x) => x.roomId === roomId && x.wallIndex === wallIndex);
        return { startHeight: a?.startHeight ?? 0 };
      };
      const added = wallpaperId
        ? wallIndexes.map((wallIndex) => ({ roomId, wallIndex, wallpaperId, ...placementOf(wallIndex) }))
        : [];
      return { ...p, wallpaperAssignments: [...others, ...added] };
    });
  },

  /** Height above the floor where the wallpaper starts, on walls that have wallpaper. */
  setWallpaperStart(roomId: Id, wallIndexes: number[], startHeight: number) {
    actions.setWallpaperPlacement(roomId, wallIndexes, { startHeight });
  },

  /** Change where the wallpaper starts on walls that have wallpaper. */
  setWallpaperPlacement(
    roomId: Id,
    wallIndexes: number[],
    patch: Partial<Pick<WallpaperAssignment, 'startHeight'>>,
  ) {
    commit((p) => ({
      ...p,
      wallpaperAssignments: p.wallpaperAssignments.map((a) =>
        a.roomId === roomId && wallIndexes.includes(a.wallIndex) ? { ...a, ...patch } : a,
      ),
    }));
  },

  setCurrency(currency: string) {
    commit((p) => ({ ...p, currency }));
  },

  setTrimPerEnd(trimPerEnd: number) {
    commit((p) => ({ ...p, trimPerEnd }));
  },

  renameProject(name: string) {
    commit((p) => ({ ...p, name }));
  },

  loadProject(project: Project) {
    commit(() => project);
    get().setSelection(null);
    get().requestFit();
  },

  newProject() {
    actions.loadProject(emptyProject());
  },
};
