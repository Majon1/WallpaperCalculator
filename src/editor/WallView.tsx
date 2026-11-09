import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  getWalls,
  openingProblems,
  roundTo,
  heightAlong,
  wallDimensionChain,
  wallEndHeights,
  wallGrossArea,
  wallStartIsOnLeft,
} from '../model/geometry';
import { OPENING_LABELS } from '../model/project';
import type { Id, Opening, Room } from '../model/types';
import { formatArea, formatLength } from '../model/units';
import { patternStartHeights, rangeLength, stripLayout, stripPlan, wallpaperedArea } from '../model/wallpaper';
import { actions, contextSelection, useEditor } from '../store/editorStore';
import { EditWallpaperButton, Swatch, WallpaperSelect } from './WallpaperPanel';
import { formatWallHeights, rollColor } from './format';
import { useWallpaperRolls } from './useRolls';
import { BottomViewSwitch, RollsView } from './RollsView';
import type { WallpaperResult } from '../calc/wallpaperRolls';
import { LengthInput } from './inputs';

const MIN_HEIGHT = 180;
const STEP = 10; // drag in 1 cm steps

/** Bottom pane showing the selected wall head-on, as seen from inside the room. */
export function WallView() {
  const open = useEditor((s) => s.wallViewOpen);
  const selection = useEditor((s) => contextSelection(s.selection));
  const project = useEditor((s) => s.project);
  const [height, setHeight] = useState(() => Math.round(window.innerHeight * 0.4));
  const bottomView = useEditor((s) => s.bottomView);

  let roomId: Id | undefined;
  let wallIndex: number | undefined;
  if (selection?.kind === 'wall') {
    roomId = selection.roomId;
    wallIndex = selection.wallIndex;
  } else if (selection?.kind === 'opening') {
    const o = project.openings.find((x) => x.id === selection.openingId);
    roomId = o?.roomId;
    wallIndex = o?.wallIndex;
  }
  const room = project.rooms.find((r) => r.id === roomId);
  if (!open || !room || wallIndex === undefined || wallIndex >= room.points.length) return null;
  const wallpaperId = project.wallpaperAssignments.find((a) => a.roomId === room.id && a.wallIndex === wallIndex)?.wallpaperId;
  const wallpaper = project.wallpapers.find((w) => w.id === wallpaperId);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = height;
    const el = e.currentTarget;
    const move = (ev: PointerEvent) =>
      setHeight(Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 200, startH + startY - ev.clientY)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <section className="wall-view" style={{ height }}>
      <div className="wall-view-resize" onPointerDown={startResize} title="Drag to resize" />
      {bottomView === 'rolls' && wallpaper ? (
        <RollsView wallpaper={wallpaper} roomId={room.id} wallIndex={wallIndex} />
      ) : (
        <WallElevation
          room={room}
          wallIndex={wallIndex}
          openings={project.openings.filter((o) => o.roomId === room.id && o.wallIndex === wallIndex)}
        />
      )}
    </section>
  );
}

type Drag = {
  id: Id;
  startX: number;
  startY: number;
  origOffset: number;
  origSill: number;
  lockSill: boolean;
  moved: boolean;
};

function WallElevation({ room, wallIndex, openings }: { room: Room; wallIndex: number; openings: Opening[] }) {
  const selection = useEditor((s) => contextSelection(s.selection));
  const select = useEditor((s) => s.setSelection);
  const assignment = useEditor((s) =>
    s.project.wallpaperAssignments.find((a) => a.roomId === room.id && a.wallIndex === wallIndex),
  );
  const wallpaper = useEditor((s) =>
    assignment ? s.project.wallpapers.find((w) => w.id === assignment.wallpaperId) : undefined,
  );
  /** Height above the floor where the wallpaper starts. */
  const paperFrom = assignment?.startHeight ?? 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const walls = getWalls(room);
  const wall = walls[wallIndex];
  const n = walls.length;
  const L = wall.length;
  const heights = wallEndHeights(room, wallIndex);
  const sloped = Math.abs(heights.start - heights.end) >= 0.5;
  const H = Math.max(heights.start, heights.end); // highest point, for layout
  /** Ceiling height at a distance along the wall (from its start corner). */
  const ceilAt = (along: number) => heightAlong(heights, L, along);
  const leftIsStart = wallStartIsOnLeft(room.points, wallIndex);
  const leftNeighbour = leftIsStart ? (wallIndex - 1 + n) % n : (wallIndex + 1) % n;
  const rightNeighbour = leftIsStart ? (wallIndex + 1) % n : (wallIndex - 1 + n) % n;
  const selectedId = selection?.kind === 'opening' ? selection.openingId : null;

  // Layout: fit the wall into the pane, leaving room for dimensions.
  const ML = 70;
  const MT = 50;
  const MB = 78;
  const hasPatternEarly = !!wallpaper && wallpaper.match !== 'free' && wallpaper.patternRepeat > 0;
  const MR = 50 + (sloped && hasPatternEarly ? 34 : 0);
  const s = L > 0 && H > 0 ? Math.max(0.001, Math.min((size.width - ML - MR) / L, (size.height - MT - MB) / H)) : 0.1;
  const x0 = ML + Math.max(0, (size.width - ML - MR - L * s) / 2);
  const y0 = MT + Math.max(0, (size.height - MT - MB - H * s) / 2);
  const X = (along: number) => x0 + (leftIsStart ? along : L - along) * s;
  const Y = (z: number) => y0 + (H - z) * s;
  const xL = X(leftIsStart ? 0 : L);
  const xR = X(leftIsStart ? L : 0);
  const yFloor = Y(0);
  const yCeil = Y(H); // top of the highest end
  const hLeft = ceilAt(leftIsStart ? 0 : L);
  const hRight = ceilAt(leftIsStart ? L : 0);
  /** Screen y of the ceiling at screen x. */
  const ceilY = (x: number) => Y(ceilAt(leftIsStart ? (x - x0) / s : L - (x - x0) / s));
  const wallPolygon = `${xL},${yFloor} ${xL},${Y(hLeft)} ${xR},${Y(hRight)} ${xR},${yFloor}`;
  const clipId = `wall-clip-${room.id}-${wallIndex}`;
  const yPaper = Y(paperFrom);


  // ---------- dragging openings ----------

  const onOpeningDown = (e: ReactPointerEvent<SVGGElement>, o: Opening) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select({ kind: 'opening', openingId: o.id });
    e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
    dragRef.current = {
      id: o.id,
      startX: e.clientX,
      startY: e.clientY,
      origOffset: o.offset,
      origSill: o.sillHeight,
      lockSill: o.type === 'door',
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      useEditor.getState().beginGesture();
    }
    const o = openings.find((x) => x.id === d.id);
    if (!o) return;
    const offset = Math.min(
      Math.max(0, L - o.width),
      Math.max(0, roundTo(d.origOffset + ((leftIsStart ? 1 : -1) * dx) / s, STEP)),
    );
    const sillHeight = d.lockSill
      ? d.origSill
      : Math.min(
          Math.max(0, Math.min(ceilAt(offset), ceilAt(offset + o.width)) - o.height),
          Math.max(0, roundTo(d.origSill - dy / s, STEP)),
        );
    actions.setOpeningLive(d.id, { offset, sillHeight });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  // ---------- rendering ----------

  const chain = wallDimensionChain(L, openings);
  // Strips are hung from the left corner as you face the wall.
  // Strips are hung from the left corner as you face the wall.
  const strips = wallpaper ? stripLayout(L, wallpaper.rollWidth) : null;
  const stripX = (d: number) => xL + d * s;
  const hasPattern = hasPatternEarly;
  const wallArea = wallGrossArea(L, heights);
  const openingArea = openings.reduce((sum, o) => sum + o.width * o.height, 0);
  const paperArea = wallpaper ? wallpaperedArea(L, heights, paperFrom, openings) : 0;
  // Which roll each piece on this wall is cut from (Part 3).
  const rolls = useWallpaperRolls(wallpaper?.id ?? '').result;
  const highlight = useEditor((st) => (st.highlightRoll && st.highlightRoll.wallpaperId === wallpaper?.id ? st.highlightRoll.roll : null));
  const setHighlight = useEditor((st) => st.setHighlightRoll);
  const pieceRolls = (rolls?.plan ?? []).flatMap((roll, r) =>
    roll.cuts.map((c, k) => ({ roll: r, order: k, count: roll.cuts.length, piece: rolls!.pieces[c.piece] })),
  ).filter((x) => x.piece.roomId === room.id && x.piece.wallIndex === wallIndex);
  // Which parts of each strip are needed, and which are covered across the whole strip width (saved).
  const plan = wallpaper ? stripPlan(L, heights, leftIsStart, paperFrom, wallpaper.rollWidth, openings) : [];
  const paperLength = plan.reduce((sum, st) => sum + rangeLength(st.pieces), 0);
  const savedLength = plan.reduce((sum, st) => sum + rangeLength(st.saved), 0);

  const renderOpening = (o: Opening) => {
    const xa = Math.min(X(o.offset), X(o.offset + o.width));
    const xb = Math.max(X(o.offset), X(o.offset + o.width));
    const yt = Y(o.sillHeight + o.height);
    const yb = Y(o.sillHeight);
    const w = xb - xa;
    const h = yb - yt;
    const ok = openingProblems(o, L, heights.start, heights.end).length === 0;
    const selected = o.id === selectedId;
    // Door handle on the side away from the nearest corner
    const handleX = (xa + xb) / 2 < (xL + xR) / 2 ? xb - Math.min(10, w * 0.15) : xa + Math.min(10, w * 0.15);
    return (
      <g
        key={o.id}
        className={`elev-opening ${o.type}${selected ? ' selected' : ''}${ok ? '' : ' invalid'}`}
        onPointerDown={(e) => onOpeningDown(e, o)}
      >
        <rect x={xa} y={yt} width={w} height={h} />
        {o.type === 'window' && (
          <>
            <line className="mullion" x1={(xa + xb) / 2} y1={yt} x2={(xa + xb) / 2} y2={yb} />
            <line className="mullion" x1={xa} y1={(yt + yb) / 2} x2={xb} y2={(yt + yb) / 2} />
          </>
        )}
        {o.type === 'door' && (
          <circle className="handle" cx={handleX} cy={Y(o.sillHeight + Math.min(1000, o.height / 2))} r={2.5} />
        )}
        {o.type === 'cabinet' &&
          (() => {
            // Cabinet fronts about 60 cm wide, each with a handle next to the middle of a pair.
            const fronts = Math.max(1, Math.round(o.width / 600));
            const fw = w / fronts;
            const hy1 = yt + Math.min(h * 0.15, 30);
            const hy2 = hy1 + Math.min(h * 0.2, 24);
            return Array.from({ length: fronts }, (_, k) => {
              const fx = xa + k * fw;
              const hx = k % 2 === 0 && k < fronts - 1 ? fx + fw - 5 : k % 2 === 1 ? fx + 5 : fx + fw - 5;
              return (
                <g key={k}>
                  {k > 0 && <line className="cabinet-front" x1={fx} y1={yt} x2={fx} y2={yb} />}
                  {fw > 12 && h > 30 && <line className="cabinet-handle" x1={hx} y1={hy1} x2={hx} y2={hy2} />}
                </g>
              );
            });
          })()}
        {o.type !== 'window' && w > 70 && h > 34 && (
          <text className="elev-opening-label" x={(xa + xb) / 2} y={(yt + yb) / 2} textAnchor="middle" dominantBaseline="middle">
            {OPENING_LABELS[o.type]}
          </text>
        )}
      </g>
    );
  };

  /** Vertical measurements beside an opening: floor → bottom, opening height, top → ceiling. */
  const renderOpeningHeights = (o: Opening) => {
    const xa = Math.min(X(o.offset), X(o.offset + o.width));
    const xb = Math.max(X(o.offset), X(o.offset + o.width));
    const onRight = xR - xb > 46 || xa - xL < 46;
    const x = onRight ? xb + 16 : xa - 16;
    // On a sloped wall, measure to the ceiling at the side the measurement is drawn on.
    const ceiling = ceilAt(onRight === leftIsStart ? o.offset + o.width : o.offset);
    const top = Math.min(ceiling, o.sillHeight + o.height);
    const bottom = Math.max(0, Math.min(ceiling, o.sillHeight));
    const segs = [
      { from: 0, to: bottom, kind: 'gap' },
      { from: bottom, to: top, kind: 'opening' },
      { from: top, to: ceiling, kind: 'gap' },
    ].filter((sg) => sg.to - sg.from > 0.5);
    const selected = o.id === selectedId;
    return (
      <g key={`h-${o.id}`} className={`elev-dims${selected ? ' highlight' : ''}`}>
        {segs.map((sg) => (
          <VDim
            key={sg.from}
            x={x}
            y1={Y(sg.to)}
            y2={Y(sg.from)}
            label={formatLength(sg.to - sg.from)}
            side={onRight ? 'right' : 'left'}
            extFrom={onRight ? xb : xa}
            className={sg.kind}
          />
        ))}
      </g>
    );
  };

  const prev = () => select({ kind: 'wall', roomId: room.id, wallIndex: leftNeighbour });
  const next = () => select({ kind: 'wall', roomId: room.id, wallIndex: rightNeighbour });

  return (
    <div className="wall-view-inner">
      <header className="wall-view-header">
        <button onClick={prev} title={`Wall ${leftNeighbour + 1} (to the left)`}>
          ‹
        </button>
        {wallpaper && <BottomViewSwitch />}
        <strong>
          {room.name} · Wall {wallIndex + 1}
        </strong>
        <button onClick={next} title={`Wall ${rightNeighbour + 1} (to the right)`}>
          ›
        </button>
        <span className="muted wall-view-info">
          {formatLength(L)} × {sloped ? `${formatWallHeights({ start: hLeft, end: hRight })} (sloped)` : formatLength(H)} · wall{' '}
          {formatArea(wallArea)}
          {openings.length > 0 && <> · openings {formatArea(openingArea)}</>}
          {wallpaper && (
            <>
              {' '}
              · <strong className="paper-area">wallpaper {formatArea(paperArea)}</strong>
            </>
          )}
          {strips && (
            <>
              {' '}
              · {strips.count} strips
              {strips.lastWidth < wallpaper!.rollWidth - 0.5 && <>, last {formatLength(strips.lastWidth)}</>}
              {' '}
              · paper {formatLength(paperLength)}
              {savedLength >= 0.5 && <>, {formatLength(savedLength)} saved</>}
              {hasPattern && (
                <>
                  {' '}
                  · repeat {formatLength(wallpaper!.patternRepeat)} {wallpaper!.match === 'offset' ? '(half-drop)' : '(straight)'}
                </>
              )}
            </>
          )}
        </span>
        <span className="wall-view-wallpaper">
          {wallpaper && <Swatch color={wallpaper.color} />}
          <WallpaperSelect
            ariaLabel="Wallpaper on this wall"
            value={wallpaper?.id ?? null}
            onChange={(id) => actions.setWallpaper(room.id, [wallIndex], id)}
          />
          {wallpaper && <EditWallpaperButton wallpaperId={wallpaper.id} />}
          {wallpaper && (
            <label className="wall-view-from" title="Height above the floor where the wallpaper starts">
              from
              <LengthInput
                ariaLabel="Wallpaper starts at"
                value={paperFrom}
                min={0}
                max={10_000}
                onCommit={(h) => actions.setWallpaperStart(room.id, [wallIndex], h)}
              />
            </label>
          )}
        </span>
        <button onClick={() => actions.addOpening(room.id, wallIndex, 'door')}>+ Door</button>
        <button onClick={() => actions.addOpening(room.id, wallIndex, 'window')}>+ Window</button>
        <button onClick={() => actions.addOpening(room.id, wallIndex, 'cabinet')} title="Cabinet or other fixed furniture: no wallpaper behind it">
          + Cabinet
        </button>
        <button className="close" onClick={() => useEditor.getState().setWallViewOpen(false)} title="Close wall view">
          ×
        </button>
      </header>
      <div className="wall-view-canvas" ref={containerRef}>
        <svg
          width={size.width}
          height={size.height}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {size.width > 0 && (
            <>
              {/* neighbours */}
              <text className="elev-neighbour" x={xL} y={yCeil - 26} textAnchor="start">
                ← Wall {leftNeighbour + 1}
              </text>
              <text className="elev-neighbour" x={xR} y={yCeil - 26} textAnchor="end">
                Wall {rightNeighbour + 1} →
              </text>

              <text className="elev-caption" x={12} y={size.height - 10}>
                Seen from inside the room
              </text>

              {/* the wall */}
              <defs>
                <clipPath id={clipId}>
                  <polygon points={wallPolygon} />
                </clipPath>
                <pattern id="saved-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line className="saved-hatch-line" x1="0" y1="0" x2="0" y2="6" />
                </pattern>
              </defs>
              <polygon
                className="elev-wall"
                points={wallPolygon}
                onPointerDown={() => select({ kind: 'wall', roomId: room.id, wallIndex })}
              />
              {wallpaper && yPaper > yCeil && (
                <g clipPath={`url(#${clipId})`}>
                  <rect className="elev-wallpaper" fill={wallpaper.color} x={xL} y={yCeil} width={xR - xL} height={yPaper - yCeil} />
                  {paperFrom > 0 && <line className="elev-wallpaper-start" x1={xL} y1={yPaper} x2={xR} y2={yPaper} />}
                </g>
              )}
              <line className="elev-floor" x1={xL - 14} y1={yFloor} x2={xR + 14} y2={yFloor} />
              <circle className="elev-start" cx={X(0)} cy={yFloor} r={6} />

              {strips && wallpaper && (
                <g className="elev-strips">
                  {strips.seams.map((d) =>
                    ceilY(stripX(d)) < yPaper ? (
                      <line key={d} className="elev-seam" x1={stripX(d)} y1={ceilY(stripX(d))} x2={stripX(d)} y2={yPaper} />
                    ) : null,
                  )}
                  {Array.from({ length: strips.count }, (_, i) => {
                    const from = i * wallpaper.rollWidth;
                    const width = i === strips.count - 1 ? strips.lastWidth : wallpaper.rollWidth;
                    const cx = stripX(from + width / 2);
                    const px = width * s;
                    const partial = width < wallpaper.rollWidth - 0.5;
                    const x1 = stripX(from);
                    const x2 = stripX(from + width);
                    // A strip runs from where the wallpaper starts up to its higher edge under a sloped ceiling;
                    // the pattern starts at the bottom of the strip. Lines are clipped to the wall.
                    const stripTop = Math.min(ceilY(x1), ceilY(x2));
                    const stripLength = Math.max(0, (yPaper - stripTop) / s);
                    const repeats = patternStartHeights(stripLength, wallpaper.patternRepeat, wallpaper.match, i).map(
                      (z) => paperFrom + z,
                    );
                    const yTopAtCentre = ceilY(cx);
                    return (
                      <g key={i}>
                        <g clipPath={`url(#${clipId})`}>
                          {repeats.map((z) => {
                            const y = Y(z);
                            const m = Math.min(5, (x2 - x1) / 3);
                            return (
                              <g key={z} className="elev-pattern">
                                {z > paperFrom && <line className="elev-pattern-line" x1={x1} y1={y} x2={x2} y2={y} />}
                                {m >= 2 && y - yTopAtCentre >= 20 && (
                                  <path
                                    className="elev-pattern-mark"
                                    d={`M ${cx} ${y - m} L ${cx + m} ${y} L ${cx} ${y + m} L ${cx - m} ${y} Z`}
                                  />
                                )}
                              </g>
                            );
                          })}
                        </g>
                        {px >= 14 && (
                          <text className="elev-strip-number" x={cx} y={yTopAtCentre + 14} textAnchor="middle">
                            {i + 1}
                          </text>
                        )}
                        {partial && (
                          <text className="elev-strip-width" x={cx} y={stripTop - 7} textAnchor="middle">
                            {formatLength(width)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              )}

              {openings.map(renderOpening)}

              {/* cut-outs for doors, windows and other openings, strip by strip (dashed cut lines) */}
              {plan.map((st) =>
                st.cutouts
                  .filter((c) => !c.full && openings[c.opening].type !== 'cabinet')
                  .map((c) => {
                    const xa = stripX(c.left);
                    const xb = stripX(c.right);
                    const yt = Y(c.to);
                    const yb = Y(c.from);
                    const tol = 0.5;
                    return (
                      <g key={`cut-${st.index}-${c.opening}`} className="elev-cutout">
                        {c.to < st.top - tol && <line className="elev-cut" x1={xa} y1={yt} x2={xb} y2={yt} />}
                        {c.from > paperFrom + tol && <line className="elev-cut" x1={xa} y1={yb} x2={xb} y2={yb} />}
                        {c.left > st.left + tol && <line className="elev-cut" x1={xa} y1={yt} x2={xa} y2={yb} />}
                        {c.right < st.right - tol && <line className="elev-cut" x1={xb} y1={yt} x2={xb} y2={yb} />}
                      </g>
                    );
                  }),
              )}

              {/* strip parts that need no paper: covered across the whole strip width */}
              {plan.map((st) =>
                st.saved.map((r) => {
                  const x = stripX(st.left);
                  const w = (st.right - st.left) * s;
                  const y = Y(r.to);
                  const h = (r.to - r.from) * s;
                  return (
                    <g key={`saved-${st.index}-${r.from}`} className="elev-saved">
                      <rect x={x} y={y} width={w} height={h} fill="url(#saved-hatch)" />
                      <line className="elev-cut" x1={x} y1={y} x2={x + w} y2={y} />
                      <line className="elev-cut" x1={x} y1={y + h} x2={x + w} y2={y + h} />
                    </g>
                  );
                }),
              )}

              {/* which roll each piece comes from */}
              {wallpaper &&
                pieceRolls.map(({ roll, order, count, piece }) => {
                  const left = piece.stripIndex * wallpaper.rollWidth;
                  const right = Math.min(L, left + wallpaper.rollWidth);
                  const xa = stripX(left);
                  const xb = stripX(right);
                  const ya = Y(piece.to);
                  const yb = Y(piece.from);
                  const on = highlight === roll;
                  const dim = highlight !== null && !on;
                  const cx = (xa + xb) / 2;
                  const cy = (ya + yb) / 2;
                  const fits = xb - xa >= 22 && yb - ya >= 16;
                  return (
                    <g
                      key={`roll-${piece.stripIndex}-${piece.from}`}
                      className={`elev-piece${on ? ' on' : ''}${dim ? ' dim' : ''}`}
                      onPointerEnter={() => setHighlight({ wallpaperId: wallpaper.id, roll })}
                      onPointerLeave={() => setHighlight(null)}
                    >
                      <title>{`Strip ${piece.stripIndex + 1}: roll ${roll + 1}, piece ${order + 1} of ${count} (${formatLength(piece.cutLength)} with trim)`}</title>
                      {on && <rect className="elev-piece-outline" x={xa + 1.5} y={ya + 1.5} width={xb - xa - 3} height={yb - ya - 3} stroke={rollColor(roll)} />}
                      {fits && (
                        <>
                          <rect className="elev-roll-badge" x={cx - 13} y={cy - 8} width={26} height={16} rx={8} fill={rollColor(roll)} />
                          <text className="elev-roll-badge-text" x={cx} y={cy + 0.5} textAnchor="middle" dominantBaseline="middle">
                            R{roll + 1}
                          </text>
                        </>
                      )}
                    </g>
                  );
                })}

              {/* widths along the wall */}
              {chain.map((sg) => (
                <HDim
                  key={`${sg.from}-${sg.to}`}
                  x1={Math.min(X(sg.from), X(sg.to))}
                  x2={Math.max(X(sg.from), X(sg.to))}
                  y={yFloor + 24}
                  extFrom={yFloor}
                  label={formatLength(sg.to - sg.from)}
                  className={`${sg.kind}${
                    sg.kind === 'opening'
                      ? sg.openingId === selectedId
                        ? ' highlight'
                        : ''
                      : isNextTo(chain, sg, selectedId)
                        ? ' highlight'
                        : ''
                  }`}
                />
              ))}
              {/* total length and height */}
              <HDim x1={xL} x2={xR} y={yFloor + 54} extFrom={yFloor + 24} label={formatLength(L)} className="total" />
              <VDim
                x={xL - 30}
                y1={Y(hLeft)}
                y2={yFloor}
                extFrom={xL}
                label={formatLength(hLeft)}
                side="left"
                className="total"
              />
              {sloped && (
                <VDim
                  x={xR + 30}
                  y1={Y(hRight)}
                  y2={yFloor}
                  extFrom={xR}
                  label={formatLength(hRight)}
                  side="right"
                  className="total"
                />
              )}

              {wallpaper && paperFrom > 0 && (
                <VDim
                  x={xL - 12}
                  y1={yPaper}
                  y2={yFloor}
                  extFrom={xL}
                  label={formatLength(paperFrom)}
                  side="left"
                  className="paper-start"
                />
              )}

              {openings.map(renderOpeningHeights)}

              {hasPattern && (
                <VDim
                  x={xR + (sloped ? 64 : 22)}
                  y1={Y(Math.min(hRight, paperFrom + wallpaper!.patternRepeat))}
                  y2={yPaper}
                  extFrom={xR}
                  label={`repeat ${formatLength(wallpaper!.patternRepeat)}`}
                  side="right"
                  className="pattern"
                />
              )}
            </>
          )}
        </svg>
        {rolls && highlight !== null && rolls.plan[highlight] && (
          <RollInfo result={rolls} roll={highlight} roomId={room.id} wallIndex={wallIndex} />
        )}
      </div>
    </div>
  );
}

function isNextTo(chain: ReturnType<typeof wallDimensionChain>, seg: (typeof chain)[number], id: Id | null): boolean {
  if (!id) return false;
  const i = chain.indexOf(seg);
  return chain[i - 1]?.openingId === id || chain[i + 1]?.openingId === id;
}

// ---------- dimension primitives (screen coordinates) ----------

const TICK = 4;

function HDim({
  x1,
  x2,
  y,
  extFrom,
  label,
  className,
}: {
  x1: number;
  x2: number;
  y: number;
  extFrom: number;
  label: ReactNode;
  className?: string;
}) {
  const narrow = x2 - x1 < 34;
  return (
    <g className={`edim ${className ?? ''}`}>
      <line className="edim-ext" x1={x1} y1={extFrom} x2={x1} y2={y + TICK} />
      <line className="edim-ext" x1={x2} y1={extFrom} x2={x2} y2={y + TICK} />
      <line className="edim-line" x1={x1} y1={y} x2={x2} y2={y} />
      <line className="edim-tick" x1={x1 - TICK} y1={y + TICK} x2={x1 + TICK} y2={y - TICK} />
      <line className="edim-tick" x1={x2 - TICK} y1={y + TICK} x2={x2 + TICK} y2={y - TICK} />
      <text className={`edim-label${narrow ? ' narrow' : ''}`} x={(x1 + x2) / 2} y={y - 5} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function VDim({
  x,
  y1,
  y2,
  extFrom,
  label,
  side,
  className,
}: {
  x: number;
  y1: number;
  y2: number;
  extFrom: number;
  label: ReactNode;
  side: 'left' | 'right';
  className?: string;
}) {
  const lx = side === 'left' ? x - 6 : x + 12;
  const my = (y1 + y2) / 2;
  const extEnd = side === 'left' ? x - TICK : x + TICK;
  return (
    <g className={`edim ${className ?? ''}`}>
      <line className="edim-ext" x1={extFrom} y1={y1} x2={extEnd} y2={y1} />
      <line className="edim-ext" x1={extFrom} y1={y2} x2={extEnd} y2={y2} />
      <line className="edim-line" x1={x} y1={y1} x2={x} y2={y2} />
      <line className="edim-tick" x1={x - TICK} y1={y1 + TICK} x2={x + TICK} y2={y1 - TICK} />
      <line className="edim-tick" x1={x - TICK} y1={y2 + TICK} x2={x + TICK} y2={y2 - TICK} />
      {y2 - y1 >= 22 && (
        <text className="edim-label" transform={`translate(${lx} ${my}) rotate(-90)`} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

/** List of the pieces on the highlighted roll, in cutting order, with their lengths. */
function RollInfo({ result, roll, roomId, wallIndex }: { result: WallpaperResult; roll: number; roomId: Id; wallIndex: number }) {
  const rooms = useEditor((s) => s.project.rooms);
  const trim = useEditor((s) => s.project.trimPerEnd);
  const plan = result.plan[roll];
  const roomName = (id: Id) => rooms.find((r) => r.id === id)?.name ?? 'Room';
  const manyRooms = new Set(plan.cuts.map((c) => result.pieces[c.piece].roomId)).size > 1 || result.pieces[plan.cuts[0].piece].roomId !== roomId;
  return (
    <div className="roll-info">
      <div className="roll-info-title" style={{ color: rollColor(roll) }}>
        Roll {roll + 1}
      </div>
      <table>
        <tbody>
          {plan.cuts.map((c, k) => {
            const pc = result.pieces[c.piece];
            const here = pc.roomId === roomId && pc.wallIndex === wallIndex;
            return [
              c.gapBefore >= 0.5 && (
                <tr key={`g${k}`} className="gap">
                  <td />
                  <td>cut off</td>
                  <td>{formatLength(c.gapBefore)}</td>
                </tr>
              ),
              <tr key={`p${k}`} className={here ? 'here' : ''}>
                <td>{k + 1}.</td>
                <td>
                  {manyRooms && `${roomName(pc.roomId)}, `}wall {pc.wallIndex + 1}, strip {pc.stripIndex + 1}
                  <span className="muted"> · {formatLength(pc.from).replace(' cm', '')}–{formatLength(pc.to)}</span>
                </td>
                <td>{formatLength(pc.cutLength)}</td>
              </tr>,
            ];
          })}
          <tr className="sum">
            <td />
            <td>used / left over</td>
            <td>
              {formatLength(plan.used)} / {formatLength(result.usableLength - plan.used)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="muted small">
        Cut lengths include {formatLength(trim)} trim at each end. Bold = on this wall.
      </div>
    </div>
  );
}
