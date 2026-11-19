import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { pieceKey, type WallpaperResult } from '../calc/wallpaperRolls';
import type { Id, Wallpaper } from '../model/types';
import { formatLength } from '../model/units';
import { actions, useEditor } from '../store/editorStore';
import { formatMoney, rollColor } from './format';
import { useWallpaperRolls } from './useRolls';

const COL_WIDTH = 74; // px; rolls are drawn to scale lengthwise only
const COL_GAP = 50; // room for the cut labels on the right of each roll
const MT = 46; // room for the roll label and what's left over
const MB = 22; // room for the 'start' mark
const ML = 16;

/** Switch between the wall elevation and the rolls drawing in the bottom pane. */
export function BottomViewSwitch() {
  const view = useEditor((s) => s.bottomView);
  const setView = useEditor((s) => s.setBottomView);
  return (
    <span className="view-switch" role="group" aria-label="Bottom view">
      <button className={view === 'wall' ? 'active' : ''} onClick={() => setView('wall')} title="The wall, head-on">
        Wall
      </button>
      <button className={view === 'rolls' ? 'active' : ''} onClick={() => setView('rolls')} title="The rolls, unrolled, with the strips cut from them">
        Rolls
      </button>
    </span>
  );
}

/**
 * Every roll of one wallpaper drawn unrolled, bottom = start of the roll (like the strips on the wall), with a pattern
 * start at the bottom: the length set aside to line up the pattern,
 * then each piece in cutting order (with the paper cut off in between), then what's left over.
 * Pattern repeat lines continue along the roll, so you can see how the pieces line up.
 */
export function RollsView({ wallpaper, roomId, wallIndex }: { wallpaper: Wallpaper; roomId: Id; wallIndex: number }) {
  const { result, pending } = useWallpaperRolls(wallpaper.id);
  const currency = useEditor((s) => s.project.currency);
  const rooms = useEditor((s) => s.project.rooms);
  const highlight = useEditor((s) => (s.highlightRoll && s.highlightRoll.wallpaperId === wallpaper.id ? s.highlightRoll.roll : null));
  const setHighlight = useEditor((s) => s.setHighlightRoll);
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const roomName = (id: Id) => rooms.find((r) => r.id === id)?.name ?? 'Room';

  return (
    <div className="wall-view-inner">
      <header className="wall-view-header rolls-header">
        <BottomViewSwitch />
        <strong>{wallpaper.name}</strong>
        <span className="muted wall-view-info">
          {result ? (
            <>
              {result.rolls} {result.rolls === 1 ? 'roll' : 'rolls'} of {formatLength(wallpaper.rollWidth)} × {formatLength(wallpaper.rollLength)}
              {result.cost !== null && <> · {formatMoney(result.cost, currency)}</>} · {result.pieces.length} pieces · left over{' '}
              {formatLength(result.leftover)}
              {pending && ' · updating…'}
            </>
          ) : (
            'Calculating…'
          )}
        </span>
        {result?.manual && (
          <span className="manual-plan">
            <span className="badge">arranged by hand</span>
            {(result.manualChanges.dropped > 0 || result.manualChanges.added > 0) && (
              <span className="muted small" title="The pieces changed since you arranged them (e.g. a strip removed or a wall changed)">
                {[
                  result.manualChanges.dropped > 0 && `${result.manualChanges.dropped} gone`,
                  result.manualChanges.added > 0 && `${result.manualChanges.added} new placed automatically`,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            )}
            <button onClick={() => actions.setManualPlan(wallpaper.id, null)} title="Forget your arrangement and calculate the best cuts again">
              Back to automatic
            </button>
          </span>
        )}
        {result?.manualChanges.outdated && (
          <span className="manual-plan outdated" title="The pieces changed so much that none of your arrangement matches any more">
            Your arrangement no longer matches, so it was calculated automatically.
            <button onClick={() => actions.setManualPlan(wallpaper.id, null)}>Forget it</button>
          </span>
        )}
        <span className="rolls-legend muted small">
          <span className="key piece" /> piece <span className="key gap" /> ✂ cut off <span className="key align" /> lining up{' '}
          <span className="key rest" /> left over · <strong>bold</strong> = this wall · <strong>drag a piece to move it</strong>
        </span>
      </header>
      <div className="wall-view-canvas rolls-canvas" ref={containerRef}>
        {result && height > 0 && <RollColumns result={result} wallpaper={wallpaper} height={height} roomId={roomId} wallIndex={wallIndex} roomName={roomName} highlight={highlight} setHighlight={(roll) => setHighlight(roll === null ? null : { wallpaperId: wallpaper.id, roll })} />}
      </div>
    </div>
  );
}

function RollColumns({
  result,
  wallpaper,
  height,
  roomId,
  wallIndex,
  roomName,
  highlight,
  setHighlight,
}: {
  result: WallpaperResult;
  wallpaper: Wallpaper;
  height: number;
  roomId: Id;
  wallIndex: number;
  roomName: (id: Id) => string;
  highlight: number | null;
  setHighlight: (roll: number | null) => void;
}) {
  const L = wallpaper.rollLength;
  const R = wallpaper.match !== 'free' && wallpaper.patternRepeat > 0 ? wallpaper.patternRepeat : 0;
  const align = L - result.usableLength;
  const s = Math.max(0.01, (height - MT - MB) / L); // px per mm
  // one extra column: drop a piece there to give it a roll of its own
  const width = ML * 2 + (result.plan.length + 1) * (COL_WIDTH + COL_GAP);
  const manyRooms = new Set(result.pieces.map((p) => p.roomId)).size > 1;
  const Y = (mm: number) => MT + (L - mm) * s;
  const colX = (r: number) => ML + r * (COL_WIDTH + COL_GAP);

  // Where each piece sits on its roll (mm from the bottom), as drawn.
  const layout = result.plan.map((roll) => {
    const firstPhase = align > 0.5 && roll.cuts.length > 0 ? result.pieces[roll.cuts[0].piece].startPhase : 0;
    let pos = firstPhase;
    const items = roll.cuts.map((c) => {
      const gapFrom = pos;
      pos += c.gapBefore;
      const from = pos;
      pos += result.pieces[c.piece].cutLength;
      return { cut: c, gapFrom, from, to: pos };
    });
    return { firstPhase, items };
  });

  // ---------- dragging pieces between / within rolls ----------
  type Drag = { piece: number; startX: number; startY: number; x: number; y: number; moved: boolean };
  const [drag, setDrag] = useState<Drag | null>(null);
  const svgPoint = (e: ReactPointerEvent) => {
    const box = (e.currentTarget as Element).closest('svg')!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  /** Drop target for a point: roll (plan.length = a new roll), position in its cutting order, and marker height. */
  const targetAt = (x: number, y: number, piece: number) => {
    const roll = Math.max(0, Math.min(result.plan.length, Math.floor((x - ML + COL_GAP / 2) / (COL_WIDTH + COL_GAP))));
    const along = L - (y - MT) / s;
    const items = roll < layout.length ? layout[roll].items.filter((it) => it.cut.piece !== piece) : [];
    const index = items.filter((it) => (it.from + it.to) / 2 < along).length;
    const below = items[index - 1];
    const markAt = below ? below.to : roll < layout.length ? layout[roll].firstPhase : 0;
    return { roll, index, markAt };
  };
  const onPieceDown = (e: ReactPointerEvent, piece: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).closest('svg')!.setPointerCapture(e.pointerId);
    const pt = svgPoint(e);
    setDrag({ piece, startX: pt.x, startY: pt.y, x: pt.x, y: pt.y, moved: false });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const pt = svgPoint(e);
    setDrag({ ...drag, x: pt.x, y: pt.y, moved: drag.moved || Math.hypot(pt.x - drag.startX, pt.y - drag.startY) > 4 });
  };
  const onUp = () => {
    if (drag?.moved) {
      const { roll, index } = targetAt(drag.x, drag.y, drag.piece);
      const rolls = result.plan.map((r) => r.cuts.map((c) => c.piece).filter((i) => i !== drag.piece));
      if (roll >= rolls.length) rolls.push([]);
      rolls[roll].splice(index, 0, drag.piece);
      const plan = rolls.filter((r) => r.length > 0).map((r) => r.map((i) => pieceKey(result.pieces[i])));
      actions.setManualPlan(wallpaper.id, plan);
    }
    setDrag(null);
  };
  const target = drag?.moved ? targetAt(drag.x, drag.y, drag.piece) : null;

  return (
    <svg
      width={Math.max(width, 10)}
      height={height}
      className={drag?.moved ? 'dragging' : ''}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDrag(null)}
    >
      <defs>
        <pattern id="roll-gap-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#f6e4e2" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#d99a94" strokeWidth="3" />
        </pattern>
        <pattern id="roll-align-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#eceff2" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#c3c9d1" strokeWidth="3" />
        </pattern>
      </defs>
      {result.plan.map((roll, r) => {
        const x = colX(r);
        /** Rectangle covering [a, b] along the roll (mm from the bottom; the roll starts at the bottom). */
        const span = (a: number, b: number) => ({ y: Y(b), height: (b - a) * s });
        const on = highlight === r;
        const dim = highlight !== null && !on;
        // The drawing always puts a pattern start at the bottom of the roll. When the roll start isn't known
        // (align > 0), the first cut is drawn at its own pattern position above it, and the rest of the repeat
        // that the calculation sets aside is drawn at the top of the roll.
        const { firstPhase, items } = layout[r];
        const topReserve = Math.max(0, align - firstPhase);
        // Pattern repeat starts along the roll, from the bottom.
        const repeatLines: number[] = [];
        if (R > 0) for (let y = R; y < L - 0.5; y += R) repeatLines.push(y);
        return (
          <g
            key={r}
            className={`roll-col${on ? ' on' : ''}${dim && !drag ? ' dim' : ''}${roll.tooLong ? ' too-long' : ''}`}
            onPointerEnter={() => !drag && setHighlight(r)}
            onPointerLeave={() => !drag && setHighlight(null)}
          >
            <text className="roll-col-label" x={x + COL_WIDTH / 2} y={MT - 24} textAnchor="middle" fill={rollColor(r)}>
              Roll {r + 1}
            </text>
            <text className={`roll-col-foot${roll.tooLong ? ' over' : ''}`} x={x + COL_WIDTH / 2} y={MT - 8} textAnchor="middle">
              {roll.tooLong ? `${formatLength(roll.used - result.usableLength)} too long` : `${formatLength(result.usableLength - roll.used)} left`}
            </text>
            <rect className="roll-col-bg" x={x} {...span(0, L)} width={COL_WIDTH} />
            {firstPhase > 0.5 && (
              <rect x={x} {...span(0, firstPhase)} width={COL_WIDTH} fill="url(#roll-align-hatch)">
                <title>{`${formatLength(firstPhase)} to line up the first piece with the pattern`}</title>
              </rect>
            )}
            {topReserve > 0.5 && (
              <rect x={x} {...span(L - topReserve, L)} width={COL_WIDTH} fill="url(#roll-align-hatch)">
                <title>{`${formatLength(topReserve)} kept aside: where the pattern starts on a new roll isn't known`}</title>
              </rect>
            )}
            {items.map(({ cut, gapFrom, from, to }) => {
              const pc = result.pieces[cut.piece];
              const here = pc.roomId === roomId && pc.wallIndex === wallIndex;
              const h = (to - from) * s;
              const top = Y(to);
              return (
                <g
                  key={cut.piece}
                  className={`roll-piece-group${drag?.moved && drag.piece === cut.piece ? ' lifted' : ''}`}
                  onPointerDown={(e) => onPieceDown(e, cut.piece)}
                >
                  {cut.gapBefore >= 0.5 && <rect x={x} {...span(gapFrom, from)} width={COL_WIDTH} fill="url(#roll-gap-hatch)" />}
                  <rect className="roll-piece" x={x} {...span(from, to)} width={COL_WIDTH} fill={rollColor(r)} />
                  <title>{`${roomName(pc.roomId)}, wall ${pc.wallIndex + 1}, strip ${pc.stripIndex + 1}: ${formatLength(pc.from)}–${formatLength(pc.to)} on the wall, cut ${formatLength(pc.cutLength)}`}</title>
                  {h >= 14 && (
                    <text className={`roll-piece-label${here ? ' here' : ''}`} x={x + COL_WIDTH / 2} y={top + h / 2 - (h >= 28 ? 6 : 0)} textAnchor="middle" dominantBaseline="middle">
                      {manyRooms && h >= 40 ? `${roomName(pc.roomId).slice(0, 8)} ` : ''}W{pc.wallIndex + 1} S{pc.stripIndex + 1}
                    </text>
                  )}
                  {h >= 28 && (
                    <text className={`roll-piece-length${here ? ' here' : ''}`} x={x + COL_WIDTH / 2} y={top + h / 2 + 8} textAnchor="middle" dominantBaseline="middle">
                      {formatLength(pc.cutLength)}
                    </text>
                  )}
                </g>
              );
            })}
            {repeatLines.map((y) => (
              <line key={y} className="roll-repeat" x1={x} y1={Y(y)} x2={x + COL_WIDTH} y2={Y(y)} />
            ))}
            <rect className="roll-col-outline" x={x} {...span(0, L)} width={COL_WIDTH} />
            {/* where to cut: a dashed line at every piece start / end (shared when nothing is cut off between) */}
            {[...new Set(items.flatMap((it) => [it.from, it.to]).map((p) => Math.round(p * 10) / 10))].map((at) => (
              <line key={at} className="roll-cut" x1={x - 5} y1={Y(at)} x2={x + COL_WIDTH + 5} y2={Y(at)} />
            ))}
            {/* how much to cut off before the next piece starts (and to line up the first one) */}
            {spreadLabels(
              [
                ...(firstPhase > 0.5 ? [{ from: 0, to: firstPhase, text: formatLength(firstPhase), kind: 'align' }] : []),
                ...items
                  .filter((it) => it.cut.gapBefore >= 0.5)
                  .map((it) => ({ from: it.gapFrom, to: it.from, text: `✂ ${formatLength(it.cut.gapBefore)}`, kind: 'gap' })),
              ],
              Y,
            ).map((g) => (
              <g key={g.from} className="roll-gap-mark">
                <line className="roll-cut-leader" x1={x + COL_WIDTH + 5} y1={Y((g.from + g.to) / 2)} x2={x + COL_WIDTH + 9} y2={g.y} />
                <text className={`roll-cut-label ${g.kind}`} x={x + COL_WIDTH + 10} y={g.y} dominantBaseline="middle">
                  {g.text}
                </text>
              </g>
            ))}
            <text className="roll-col-foot" x={x + COL_WIDTH / 2} y={Y(0) + 14} textAnchor="middle">
              ▲ start
            </text>
          </g>
        );
      })}
      {/* drop here for a roll of its own */}
      <g className={`roll-new${target && target.roll === result.plan.length ? ' on' : ''}`}>
        <rect x={colX(result.plan.length)} y={Y(L)} width={COL_WIDTH} height={L * s} />
        <text x={colX(result.plan.length) + COL_WIDTH / 2} y={Y(L / 2)} textAnchor="middle" dominantBaseline="middle">
          {drag?.moved ? 'new roll' : ''}
        </text>
      </g>
      {target && (
        <line
          className="roll-drop-marker"
          x1={colX(target.roll) - 6}
          x2={colX(target.roll) + COL_WIDTH + 6}
          y1={Y(target.roll < result.plan.length ? target.markAt : 0)}
          y2={Y(target.roll < result.plan.length ? target.markAt : 0)}
        />
      )}
      {drag?.moved &&
        (() => {
          const pc = result.pieces[drag.piece];
          const h = pc.cutLength * s;
          return (
            <g className="roll-ghost" pointerEvents="none">
              <rect x={drag.x - COL_WIDTH / 2} y={drag.y - h / 2} width={COL_WIDTH} height={h} />
              <text x={drag.x} y={drag.y} textAnchor="middle" dominantBaseline="middle">
                W{pc.wallIndex + 1} S{pc.stripIndex + 1} · {formatLength(pc.cutLength)}
              </text>
            </g>
          );
        })()}
    </svg>
  );
}

/** Place labels next to the middle of their stretch of roll, spread at least 11 px apart (top of the roll first). */
function spreadLabels<T extends { from: number; to: number }>(labels: T[], Y: (mm: number) => number): (T & { y: number })[] {
  const sorted = [...labels].sort((a, b) => b.to - a.to);
  let last = -Infinity;
  return sorted.map((l) => {
    const y = Math.max(last + 11, Y((l.from + l.to) / 2));
    last = y;
    return { ...l, y };
  });
}
