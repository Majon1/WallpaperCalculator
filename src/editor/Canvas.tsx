import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  add,
  centroid,
  distance,
  dot,
  getWalls,
  offsetWall,
  openingProblems,
  wallEndHeights,
  outwardNormal,
  pointAlong,
  polygonArea,
  roomError,
  roundTo,
  samePoint,
  scale,
  snapDirection,
  snapToGrid,
  sub,
  translatePoints,
  unitVector,
  wallDimensionChain,
  type DimensionSegment,
} from '../model/geometry';
import type { Id, Opening, Point, Room, Wall } from '../model/types';
import { formatArea, formatLength, parseLength } from '../model/units';
import { actions, contextSelection, useEditor } from '../store/editorStore';
import { formatWallHeights } from './format';

interface View {
  /** Pixels per millimetre. */
  scale: number;
  x: number;
  y: number;
}

const GRID = 100; // 10 cm
const FINE = 10; // 1 cm (Shift)
const SNAP_PX = 12;
const MIN_SCALE = 0.005;
const MAX_SCALE = 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Drag = { startScreen: Point; moved: boolean } & (
  | { kind: 'pan'; startView: View }
  | { kind: 'room'; roomId: Id; startWorld: Point; origPoints: Point[] }
  | { kind: 'vertex'; roomId: Id; index: number; origPoints: Point[] }
  | { kind: 'wall'; roomId: Id; wallIndex: number; startWorld: Point; origPoints: Point[]; normal: Point }
  | { kind: 'opening'; openingId: Id; wall: Wall; grabOffset: number; width: number }
);

/** Cabinets have no depth in the model; this is how deep they are drawn on the plan. */
const CABINET_PLAN_DEPTH = 600;

export function Canvas() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => contextSelection(s.selection));
  const tool = useEditor((s) => s.tool);
  const fitRequest = useEditor((s) => s.fitRequest);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [view, setView] = useState<View>({ scale: 0.1, x: 400, y: 300 });
  const viewInitialised = useRef(false);
  const dragRef = useRef<Drag | null>(null);

  // Draw tool state
  const [drawPoints, setDrawPoints] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const rawCursorRef = useRef<Point | null>(null);
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const toScreen = (p: Point): Point => ({ x: p.x * view.scale + view.x, y: p.y * view.scale + view.y });
  const clientToWorld = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.scale, y: (e.clientY - r.top - view.y) / view.scale };
  };

  // ---------- view: size, fit, zoom ----------

  useEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const { width, height } = sizeRef.current;
    if (width === 0) return;
    const pts = useEditor.getState().project.rooms.flatMap((r) => r.points);
    if (pts.length === 0) {
      setView({ scale: 0.1, x: width / 2, y: height / 2 });
      return;
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const margin = 80;
    const s = clamp(
      Math.min((width - 2 * margin) / Math.max(maxX - minX, 1000), (height - 2 * margin) / Math.max(maxY - minY, 1000)),
      MIN_SCALE,
      MAX_SCALE,
    );
    setView({ scale: s, x: width / 2 - ((minX + maxX) / 2) * s, y: height / 2 - ((minY + maxY) / 2) * s });
  }, []);

  useEffect(() => {
    if (!viewInitialised.current && size.width > 0) {
      viewInitialised.current = true;
      fit();
    }
  }, [size, fit]);

  useEffect(() => {
    if (fitRequest > 0) fit();
  }, [fitRequest, fit]);

  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      setView((v) => {
        const s = clamp(v.scale * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
        const k = s / v.scale;
        return { scale: s, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Leaving the draw tool discards the unfinished room.
  useEffect(() => {
    setDrawPoints([]);
    setTyped('');
    setMessage(null);
  }, [tool]);

  // ---------- snapping ----------

  const snapToCorner = (world: Point, exclude?: { roomId: Id; index: number }): Point | null => {
    const threshold = SNAP_PX / view.scale;
    let best: Point | null = null;
    let bestDist = threshold;
    const consider = (p: Point) => {
      const d = distance(p, world);
      if (d <= bestDist) {
        best = p;
        bestDist = d;
      }
    };
    if (drawPoints.length >= 3) consider(drawPoints[0]);
    for (const room of project.rooms) {
      room.points.forEach((p, i) => {
        if (!(exclude && exclude.roomId === room.id && exclude.index === i)) consider(p);
      });
    }
    return best;
  };

  const snapDrawPoint = (world: Point, free: boolean): Point => {
    const corner = snapToCorner(world);
    if (corner) return corner;
    const last = drawPoints.at(-1);
    if (last && !free) return snapDirection(last, world, 45, GRID);
    return snapToGrid(world, free ? FINE : GRID);
  };

  // ---------- draw tool ----------

  const finishRoom = (points: Point[]) => {
    const error = roomError(points);
    if (error) {
      setMessage(error);
      return;
    }
    actions.addRoom(points);
    setDrawPoints([]);
    setTyped('');
    useEditor.getState().setTool('select');
  };

  const addDrawPoint = (p: Point) => {
    if (drawPoints.length >= 3 && samePoint(p, drawPoints[0])) {
      finishRoom(drawPoints);
      return;
    }
    const last = drawPoints.at(-1);
    if (last && samePoint(p, last)) return;
    setDrawPoints([...drawPoints, p]);
    setMessage(null);
  };

  const applyTypedLength = () => {
    const mm = parseLength(typed);
    setTyped('');
    const last = drawPoints.at(-1);
    if (!last) {
      setMessage('Click to place the first corner, then type lengths.');
      return;
    }
    if (mm === null || mm <= 0) {
      setMessage(`"${typed}" is not a valid length. Try 345 (cm) or 3.45 m.`);
      return;
    }
    const raw = rawCursorRef.current;
    const toward = raw && distance(raw, last) > 0 ? snapDirection(last, raw, 45, 0) : { x: last.x + 1, y: last.y };
    addDrawPoint(pointAlong(last, toward, mm));
  };

  // ---------- pointer handling ----------

  const startDrag = (e: ReactPointerEvent, drag: Drag) => {
    svgRef.current!.setPointerCapture(e.pointerId);
    dragRef.current = drag;
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const startScreen = { x: e.clientX, y: e.clientY };
    if (e.button === 1 || (e.button === 0 && tool === 'select')) {
      e.preventDefault();
      startDrag(e, { kind: 'pan', startScreen, moved: false, startView: view });
    } else if (e.button === 0 && tool === 'draw') {
      addDrawPoint(snapDrawPoint(clientToWorld(e), e.shiftKey));
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const world = clientToWorld(e);
    if (tool === 'draw') {
      rawCursorRef.current = world;
      setCursor(snapDrawPoint(world, e.shiftKey));
    }
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startScreen.x, e.clientY - drag.startScreen.y) < 3) return;
      drag.moved = true;
      if (drag.kind !== 'pan') useEditor.getState().beginGesture();
    }
    const step = e.shiftKey ? FINE : GRID;
    switch (drag.kind) {
      case 'pan':
        setView({
          ...drag.startView,
          x: drag.startView.x + e.clientX - drag.startScreen.x,
          y: drag.startView.y + e.clientY - drag.startScreen.y,
        });
        break;
      case 'room': {
        const d = sub(world, drag.startWorld);
        actions.setRoomPointsLive(drag.roomId, translatePoints(drag.origPoints, { x: roundTo(d.x, step), y: roundTo(d.y, step) }));
        break;
      }
      case 'vertex': {
        const target = snapToCorner(world, { roomId: drag.roomId, index: drag.index }) ?? snapToGrid(world, step);
        const points = drag.origPoints.slice();
        points[drag.index] = target;
        actions.setRoomPointsLive(drag.roomId, points);
        break;
      }
      case 'wall': {
        const d = roundTo(dot(sub(world, drag.startWorld), drag.normal), step);
        actions.setRoomPointsLive(drag.roomId, offsetWall(drag.origPoints, drag.wallIndex, scale(drag.normal, d)));
        break;
      }
      case 'opening': {
        const { wall } = drag;
        const along = dot(sub(world, wall.start), unitVector(wall.start, wall.end));
        const offset = clamp(roundTo(along - drag.grabOffset, FINE), 0, Math.max(0, wall.length - drag.width));
        actions.setOpeningLive(drag.openingId, { offset });
        break;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    if (drag.kind === 'pan') {
      if (!drag.moved && tool === 'select') useEditor.getState().setSelection(null);
      return;
    }
    if (drag.moved && (drag.kind === 'vertex' || drag.kind === 'wall')) {
      const room = useEditor.getState().project.rooms.find((r) => r.id === drag.roomId);
      const error = room && roomError(room.points);
      if (error) {
        useEditor.getState().cancelGesture();
        setMessage(`Change undone: ${error.toLowerCase()}`);
      }
    }
  };

  const onRoomDown = (e: ReactPointerEvent, room: Room) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMessage(null);
    useEditor.getState().setSelection({ kind: 'room', roomId: room.id });
    startDrag(e, {
      kind: 'room',
      startScreen: { x: e.clientX, y: e.clientY },
      moved: false,
      roomId: room.id,
      startWorld: clientToWorld(e),
      origPoints: room.points,
    });
  };

  const onWallDown = (e: ReactPointerEvent, room: Room, wallIndex: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMessage(null);
    useEditor.getState().setSelection({ kind: 'wall', roomId: room.id, wallIndex });
    useEditor.getState().setWallViewOpen(true);
    startDrag(e, {
      kind: 'wall',
      startScreen: { x: e.clientX, y: e.clientY },
      moved: false,
      roomId: room.id,
      wallIndex,
      startWorld: clientToWorld(e),
      origPoints: room.points,
      normal: outwardNormal(room.points, wallIndex),
    });
  };

  const onVertexDown = (e: ReactPointerEvent, room: Room, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMessage(null);
    startDrag(e, {
      kind: 'vertex',
      startScreen: { x: e.clientX, y: e.clientY },
      moved: false,
      roomId: room.id,
      index,
      origPoints: room.points,
    });
  };

  const onOpeningDown = (e: ReactPointerEvent, opening: Opening, wall: Wall) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMessage(null);
    useEditor.getState().setSelection({ kind: 'opening', openingId: opening.id });
    const along = dot(sub(clientToWorld(e), wall.start), unitVector(wall.start, wall.end));
    startDrag(e, {
      kind: 'opening',
      startScreen: { x: e.clientX, y: e.clientY },
      moved: false,
      openingId: opening.id,
      wall,
      grabOffset: along - opening.offset,
      width: opening.width,
    });
  };

  // ---------- keyboard ----------

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
    const st = useEditor.getState();
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) st.redo();
      else st.undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      st.redo();
      return;
    }
    if (mod || e.altKey) return;

    if (tool === 'draw') {
      if (/^[0-9.,]$/.test(e.key) || (typed && /^[cm ]$/.test(key))) {
        e.preventDefault();
        setTyped((t) => t + e.key);
        return;
      }
      if (key === 'backspace') {
        e.preventDefault();
        if (typed) setTyped((t) => t.slice(0, -1));
        else setDrawPoints((p) => p.slice(0, -1));
        return;
      }
      if (key === 'enter') {
        e.preventDefault();
        if (typed) applyTypedLength();
        else if (drawPoints.length >= 3) finishRoom(drawPoints);
        return;
      }
      if (key === 'escape') {
        if (typed) setTyped('');
        else if (drawPoints.length) setDrawPoints([]);
        else st.setTool('select');
        return;
      }
    } else {
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        actions.deleteSelection();
        return;
      }
      if (key === 'escape') {
        st.setSelection(null);
        return;
      }
    }
    if (key === 'v') st.setTool('select');
    else if (key === 'r') st.setTool('draw');
    else if (key === 'f') st.requestFit();
  };
  const keyHandlerRef = useRef(onKeyDown);
  keyHandlerRef.current = onKeyDown;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---------- rendering ----------

  const pointsAttr = (pts: Point[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

  /** " · h 190 cm" (or "250–190 cm" when sloped) for walls that aren't at the room height. */
  const heightLabel = (room: Room, index: number) => {
    const h = wallEndHeights(room, index);
    if (h.start === room.wallHeight && h.end === room.wallHeight) return null;
    return <tspan className="wall-label-height"> · h {formatWallHeights(h)}</tspan>;
  };

  const wallLabel = (room: Room, wall: Wall) => {
    const a = toScreen(wall.start);
    const b = toScreen(wall.end);
    if (distance(a, b) < 40) return null;
    const normal = outwardNormal(room.points, wall.index);
    const pos = add(scale(add(a, b), 0.5), scale(normal, 14));
    let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return (
      <text
        key={`label-${wall.index}`}
        className="wall-label"
        transform={`translate(${pos.x} ${pos.y}) rotate(${angle})`}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {formatLength(wall.length)}
        {heightLabel(room, wall.index)}
      </text>
    );
  };

  const renderOpening = (opening: Opening, room: Room, walls: Wall[]) => {
    const wall = walls[opening.wallIndex];
    if (!wall || wall.length === 0) return null;
    const u = unitVector(wall.start, wall.end);
    const p1 = add(wall.start, scale(u, opening.offset));
    const p2 = add(wall.start, scale(u, opening.offset + opening.width));
    const s1 = toScreen(p1);
    const s2 = toScreen(p2);
    const ok = openingProblems(opening, wall.length, wallEndHeights(room, opening.wallIndex).start, wallEndHeights(room, opening.wallIndex).end).length === 0;
    const selected = selection?.kind === 'opening' && selection.openingId === opening.id;
    let swing = null;
    if (opening.type === 'door') {
      const inward = scale(outwardNormal(room.points, opening.wallIndex), -1);
      const tip = toScreen(add(p1, scale(inward, opening.width)));
      const r = opening.width * view.scale;
      const cross = (s2.x - s1.x) * (tip.y - s1.y) - (s2.y - s1.y) * (tip.x - s1.x);
      swing = (
        <path
          className="door-swing"
          d={`M ${s2.x} ${s2.y} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${tip.x} ${tip.y} L ${s1.x} ${s1.y}`}
        />
      );
    }
    // A cabinet is drawn as a box standing against the wall (depth is only for the drawing).
    let cabinet = null;
    if (opening.type === 'cabinet') {
      const inward = scale(outwardNormal(room.points, opening.wallIndex), -1);
      const depth = Math.min(CABINET_PLAN_DEPTH, opening.width);
      const q1 = toScreen(add(p1, scale(inward, depth)));
      const q2 = toScreen(add(p2, scale(inward, depth)));
      cabinet = <polygon className="cabinet-box" points={`${s1.x},${s1.y} ${s2.x},${s2.y} ${q2.x},${q2.y} ${q1.x},${q1.y}`} />;
    }
    return (
      <g
        key={opening.id}
        className={`opening ${opening.type}${selected ? ' selected' : ''}${ok ? '' : ' invalid'}`}
        onPointerDown={(e) => onOpeningDown(e, opening, wall)}
      >
        {swing}
        {cabinet}
        <line className="opening-gap" x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} />
        <line className="opening-line" x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} />
        <line className="hit" x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} />
      </g>
    );
  };

  /** Measurement chain along the inside of a wall: corner → opening → gap → … → corner. */
  const renderDimensions = (room: Room, wall: Wall | undefined) => {
    if (!wall || wall.length === 0) return null;
    const onWall = project.openings.filter((o) => o.roomId === room.id && o.wallIndex === wall.index);
    const chain = wallDimensionChain(wall.length, onWall);
    const u = unitVector(wall.start, wall.end);
    const inward = scale(outwardNormal(room.points, wall.index), -1);
    const OFFSET = 30; // px from the wall
    const TICK = 5;
    const selectedId = selection?.kind === 'opening' ? selection.openingId : null;
    let angle = (Math.atan2(u.y, u.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const at = (along: number) => add(toScreen(add(wall.start, scale(u, along))), scale(inward, OFFSET));
    const ticks = new Set(chain.flatMap((s) => [s.from, s.to]));

    return (
      <g className="dimensions">
        {[...ticks].map((t) => {
          const p = at(t);
          const onWallPt = toScreen(add(wall.start, scale(u, t)));
          return (
            <g key={`t${t}`}>
              <line className="dim-extension" x1={onWallPt.x} y1={onWallPt.y} x2={p.x + inward.x * TICK} y2={p.y + inward.y * TICK} />
              <line
                className="dim-tick"
                x1={p.x - (u.x - inward.x) * TICK}
                y1={p.y - (u.y - inward.y) * TICK}
                x2={p.x + (u.x - inward.x) * TICK}
                y2={p.y + (u.y - inward.y) * TICK}
              />
            </g>
          );
        })}
        {chain.map((s) => {
          const a = at(s.from);
          const b = at(s.to);
          const mid = add(scale(add(a, b), 0.5), scale(inward, 10));
          const highlight = s.kind === 'opening' ? s.openingId === selectedId : isNextToSelected(chain, s, selectedId);
          return (
            <g key={`${s.from}-${s.to}`} className={`dim ${s.kind}${highlight ? ' highlight' : ''}`}>
              <line className="dim-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              {distance(a, b) >= 26 && (
                <text
                  className="dim-label"
                  transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {formatLength(s.to - s.from)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  };

  const renderRoom = (room: Room) => {
    const walls = getWalls(room);
    const screenPts = room.points.map(toScreen);
    const roomSelected = selection?.kind === 'room' && selection.roomId === room.id;
    const selectedOpening =
      selection?.kind === 'opening' ? project.openings.find((o) => o.id === selection.openingId) : undefined;
    const active =
      roomSelected || (selection?.kind === 'wall' && selection.roomId === room.id) || selectedOpening?.roomId === room.id;
    const label = toScreen(centroid(room.points));
    const highlightedWall =
      selection?.kind === 'wall' && selection.roomId === room.id
        ? selection.wallIndex
        : selectedOpening?.roomId === room.id
          ? selectedOpening.wallIndex
          : null;
    const wallStart = highlightedWall !== null ? screenPts[highlightedWall] : null;
    return (
      <g key={room.id} className={`room${active ? ' active' : ''}`}>
        <polygon
          className={`room-fill${roomSelected ? ' selected' : ''}`}
          points={pointsAttr(screenPts)}
          onPointerDown={(e) => onRoomDown(e, room)}
        />
        {walls.map((w) => {
          const a = screenPts[w.index];
          const b = screenPts[(w.index + 1) % screenPts.length];
          const selected = selection?.kind === 'wall' && selection.roomId === room.id && selection.wallIndex === w.index;
          const wpId = project.wallpaperAssignments.find((x) => x.roomId === room.id && x.wallIndex === w.index)?.wallpaperId;
          const wp = wpId ? project.wallpapers.find((x) => x.id === wpId) : undefined;
          const inset = wp ? scale(outwardNormal(room.points, w.index), -4.5) : null;
          return (
            <g key={w.index}>
              {wp && inset && (
                <line
                  className="wall-paper"
                  stroke={wp.color}
                  x1={a.x + inset.x}
                  y1={a.y + inset.y}
                  x2={b.x + inset.x}
                  y2={b.y + inset.y}
                />
              )}
              <line className={`wall${selected ? ' selected' : ''}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              <line className="hit wall-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} onPointerDown={(e) => onWallDown(e, room, w.index)} />
            </g>
          );
        })}
        {project.openings.filter((o) => o.roomId === room.id).map((o) => renderOpening(o, room, walls))}
        {walls.map((w) => wallLabel(room, w))}
        <text className="room-label" x={label.x} y={label.y - 8} textAnchor="middle">
          {room.name}
        </text>
        <text className="room-area" x={label.x} y={label.y + 10} textAnchor="middle">
          {formatArea(polygonArea(room.points))}
        </text>
        {active &&
          screenPts.map((p, i) => (
            <circle key={i} className="vertex" cx={p.x} cy={p.y} r={5} onPointerDown={(e) => onVertexDown(e, room, i)} />
          ))}
        {highlightedWall !== null && renderDimensions(room, walls[highlightedWall])}
        {wallStart && <circle className="wall-start" cx={wallStart.x} cy={wallStart.y} r={10} />}
      </g>
    );
  };

  const renderDrawPreview = () => {
    if (tool !== 'draw') return null;
    const pts = drawPoints.map(toScreen);
    const last = drawPoints.at(-1);
    const closing = cursor && drawPoints.length >= 3 && samePoint(cursor, drawPoints[0]);
    let segmentLabel = null;
    if (last && cursor) {
      const a = toScreen(last);
      const b = toScreen(cursor);
      const mid = scale(add(a, b), 0.5);
      segmentLabel = (
        <>
          <line className="draw-next" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          <text className={`draw-length${typed ? ' typed' : ''}`} x={mid.x + 10} y={mid.y - 10}>
            {typed ? `${typed}▏` : formatLength(distance(last, cursor))}
          </text>
        </>
      );
    }
    const c = cursor && toScreen(cursor);
    return (
      <g className="draw-preview">
        {pts.length > 1 && <polyline className="draw-path" points={pointsAttr(pts)} />}
        {segmentLabel}
        {pts.map((p, i) => (
          <circle key={i} className={`draw-point${i === 0 && closing ? ' closing' : ''}`} cx={p.x} cy={p.y} r={i === 0 && closing ? 8 : 4} />
        ))}
        {c && <circle className="draw-cursor" cx={c.x} cy={c.y} r={4} />}
      </g>
    );
  };

  const hint =
    tool === 'draw'
      ? drawPoints.length === 0
        ? 'Click to place the first corner. Hold Shift for free angles. Esc to stop drawing.'
        : 'Click to add corners, or type a length in cm (e.g. 345) and press Enter. Click the first corner or press Enter to finish. Backspace removes the last corner.'
      : project.rooms.length === 0
        ? 'Start with "Draw room" (R) or "Rectangle room".'
        : 'Click to select. Drag rooms, walls and corners to edit (Shift = 1 cm steps). Scroll to zoom, drag the background to pan.';

  return (
    <div className="canvas" ref={containerRef}>
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        className={tool === 'draw' ? 'drawing' : ''}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Grid view={view} width={size.width} height={size.height} />
        <g style={{ pointerEvents: tool === 'draw' ? 'none' : 'auto' }}>{project.rooms.map(renderRoom)}</g>
        {renderDrawPreview()}
      </svg>
      <div className={`canvas-hint${message ? ' error' : ''}`}>{message ?? hint}</div>
      <ScaleBar scale={view.scale} />
    </div>
  );
}

/** A gap is highlighted when it borders the selected opening (its distances to the neighbours). */
function isNextToSelected(chain: DimensionSegment[], seg: DimensionSegment, selectedId: Id | null): boolean {
  if (!selectedId) return false;
  const i = chain.indexOf(seg);
  return chain[i - 1]?.openingId === selectedId || chain[i + 1]?.openingId === selectedId;
}

function Grid({ view, width, height }: { view: View; width: number; height: number }) {
  const steps = [100, 500, 1000, 5000, 10000, 50000];
  const minor = steps.find((s) => s * view.scale >= 10) ?? 50000;
  const major = minor < 1000 ? 1000 : minor * 5;
  const lines = [];
  const x0 = Math.ceil(-view.x / view.scale / minor);
  const x1 = Math.floor((width - view.x) / view.scale / minor);
  const y0 = Math.ceil(-view.y / view.scale / minor);
  const y1 = Math.floor((height - view.y) / view.scale / minor);
  for (let k = x0; k <= x1; k++) {
    const sx = k * minor * view.scale + view.x;
    lines.push(<line key={`x${k}`} className={(k * minor) % major === 0 ? 'major' : ''} x1={sx} y1={0} x2={sx} y2={height} />);
  }
  for (let k = y0; k <= y1; k++) {
    const sy = k * minor * view.scale + view.y;
    lines.push(<line key={`y${k}`} className={(k * minor) % major === 0 ? 'major' : ''} x1={0} y1={sy} x2={width} y2={sy} />);
  }
  return <g className="grid">{lines}</g>;
}

function ScaleBar({ scale: s }: { scale: number }) {
  const options = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const length = options.find((mm) => mm * s >= 80) ?? 50000;
  return (
    <div className="scale-bar">
      <div className="scale-bar-line" style={{ width: length * s }} />
      <span>{length >= 1000 ? `${length / 1000} m` : `${length / 10} cm`}</span>
    </div>
  );
}
