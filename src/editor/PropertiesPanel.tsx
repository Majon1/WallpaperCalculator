import { useState } from 'react';
import { getWalls, heightAlong, openingProblems, perimeter, polygonArea, wallEndHeights, wallGrossArea, wallStartIsOnLeft } from '../model/geometry';
import { OPENING_LABELS } from '../model/project';
import type { Opening, OpeningType, Room } from '../model/types';
import { formatArea, formatLength } from '../model/units';
import { actions, useEditor } from '../store/editorStore';
import { assignmentArea, rangeLength, stripPlan } from '../model/wallpaper';
import { formatMoney, formatWallHeights } from './format';
import { useRolls } from './useRolls';
import { Field, LengthInput, OptionalLengthInput, TextInput } from './inputs';
import { EditWallpaperButton, Swatch, WallpaperLibrary, WallpaperPanel, WallpaperSelect } from './WallpaperPanel';

export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);

  let content = <ProjectPanel />;
  if (selection?.kind === 'room' || selection?.kind === 'wall') {
    const room = project.rooms.find((r) => r.id === selection.roomId);
    if (room) {
      const openings = project.openings.filter((o) => o.roomId === room.id);
      content =
        selection.kind === 'room' ? (
          <RoomPanel key={room.id} room={room} openings={openings} />
        ) : (
          <WallPanel key={`${room.id}-${selection.wallIndex}`} room={room} wallIndex={selection.wallIndex} openings={openings} />
        );
    }
  } else if (selection?.kind === 'opening') {
    const opening = project.openings.find((o) => o.id === selection.openingId);
    const room = opening && project.rooms.find((r) => r.id === opening.roomId);
    if (opening && room) content = <OpeningPanel key={opening.id} opening={opening} room={room} />;
  } else if (selection?.kind === 'wallpaper') {
    const wallpaper = project.wallpapers.find((w) => w.id === selection.wallpaperId);
    if (wallpaper) content = <WallpaperPanel key={wallpaper.id} wallpaper={wallpaper} />;
  }

  return <aside className="panel">{content}</aside>;
}

function ProjectPanel() {
  const project = useEditor((s) => s.project);
  const select = useEditor((s) => s.setSelection);
  const total = project.rooms.reduce((sum, r) => sum + polygonArea(r.points), 0);
  return (
    <>
      <h2>Project</h2>
      <Field label="Name">
        <TextInput value={project.name} onCommit={actions.renameProject} />
      </Field>
      <Field label="Currency">
        <TextInput value={project.currency} onCommit={actions.setCurrency} />
      </Field>
      <h3>Rooms</h3>
      {project.rooms.length === 0 ? (
        <p className="muted">No rooms yet.</p>
      ) : (
        <ul className="list">
          {project.rooms.map((r) => (
            <li key={r.id}>
              <button className="link" onClick={() => select({ kind: 'room', roomId: r.id })}>
                {r.name}
              </button>
              <span className="muted">{formatArea(polygonArea(r.points))}</span>
            </li>
          ))}
          <li className="total">
            <span>Total floor area</span>
            <span>{formatArea(total)}</span>
          </li>
        </ul>
      )}
      <h3>Wallpapers</h3>
      <WallpaperLibrary />
      <WallpaperTotal />
      <Field label="Trim per cut end">
        <LengthInput value={project.trimPerEnd} min={0} max={200} onCommit={actions.setTrimPerEnd} />
      </Field>
      <p className="note">Extra length at the top and bottom of every piece, for trimming at the ceiling, floor and openings.</p>
      <h3>Shortcuts</h3>
      <dl className="shortcuts">
        <dt>V</dt>
        <dd>Select</dd>
        <dt>R</dt>
        <dd>Draw room</dd>
        <dt>F</dt>
        <dd>Fit view</dd>
        <dt>Ctrl+Z / Ctrl+Y</dt>
        <dd>Undo / redo</dd>
        <dt>Delete</dt>
        <dd>Delete selected room or opening</dd>
        <dt>Shift</dt>
        <dd>Free angle / 1 cm steps</dd>
      </dl>
    </>
  );
}

function RoomPanel({ room, openings }: { room: Room; openings: Opening[] }) {
  const select = useEditor((s) => s.setSelection);
  const [error, setError] = useState<string | null>(null);
  const walls = getWalls(room);
  const project = useEditor((s) => s.project);
  const wallpaperOf = (i: number) => project.wallpaperAssignments.find((a) => a.roomId === room.id && a.wallIndex === i)?.wallpaperId ?? null;
  const ids = walls.map((w) => wallpaperOf(w.index));
  const roomWallpaper = ids.every((id) => id === ids[0]) ? ids[0] : 'mixed';
  const papered = project.wallpaperAssignments.filter((a) => a.roomId === room.id);
  const starts = papered.map((a) => a.startHeight);
  return (
    <>
      <h2>Room</h2>
      <Field label="Name">
        <TextInput value={room.name} onCommit={(name) => actions.updateRoom(room.id, { name })} />
      </Field>
      <Field label="Wall height">
        <LengthInput value={room.wallHeight} min={500} max={10_000} onCommit={(h) => actions.setRoomHeight(room.id, h)} />
      </Field>
      {room.cornerHeights.some((h) => h !== null) && (
        <p className="note">
          Some walls are lower, higher or sloped (heights in the list below). Changing the wall height here makes the whole room
          level again.
        </p>
      )}
      <dl className="stats">
        <dt>Floor area</dt>
        <dd>{formatArea(polygonArea(room.points))}</dd>
        <dt>Perimeter</dt>
        <dd>{formatLength(perimeter(room.points))}</dd>
        <dt>Doors, windows, cabinets</dt>
        <dd>{openings.length}</dd>
        {papered.length > 0 && (
          <>
            <dt>Wall area with wallpaper</dt>
            <dd>{formatArea(papered.reduce((sum, a) => sum + assignmentArea(project, a), 0))}</dd>
          </>
        )}
      </dl>
      <Field label="Wallpaper (all walls)">
        <WallpaperSelect
          value={roomWallpaper}
          onChange={(id) => actions.setWallpaper(room.id, walls.map((w) => w.index), id)}
        />
      </Field>
      {roomWallpaper && roomWallpaper !== 'mixed' && (
        <div className="actions inline">
          <EditWallpaperButton wallpaperId={roomWallpaper} />
        </div>
      )}
      {papered.length > 0 && (
        <Field label="Wallpaper starts at">
          <OptionalLengthInput
            ariaLabel="Wallpaper starts at (all walls)"
            value={starts.every((h) => h === starts[0]) ? starts[0] : null}
            placeholder="mixed"
            min={0}
            max={10_000}
            onCommit={(h) => actions.setWallpaperStart(room.id, papered.map((a) => a.wallIndex), h)}
          />
        </Field>
      )}
      <h3>Walls</h3>
      <ul className="list walls">
        {walls.map((w) => {
          const count = openings.filter((o) => o.wallIndex === w.index).length;
          return (
            <li key={w.index}>
              <button className="link" onClick={() => select({ kind: 'wall', roomId: room.id, wallIndex: w.index })}>
                {(() => {
                  const wp = project.wallpapers.find((x) => x.id === wallpaperOf(w.index));
                  return wp ? <Swatch color={wp.color} /> : <span className="swatch empty" />;
                })()}
                Wall {w.index + 1}
                {count > 0 && <span className="badge">{count}</span>}
                {(() => {
                  const h = wallEndHeights(room, w.index);
                  return h.start === room.wallHeight && h.end === room.wallHeight ? null : (
                    <span className="muted small"> h {formatWallHeights(h)}</span>
                  );
                })()}
              </button>
              <LengthInput
                ariaLabel={`Wall ${w.index + 1} length`}
                value={w.length}
                min={10}
                onCommit={(len) => setError(actions.setWallLength(room.id, w.index, len))}
              />
            </li>
          );
        })}
      </ul>
      {error && <p className="error">{error}</p>}
      <p className="note">Changing a wall's length moves its end corner and the next corner, so the following wall keeps its shape.</p>
      <div className="actions">
        <button className="danger" onClick={() => actions.deleteRoom(room.id)}>
          Delete room
        </button>
      </div>
    </>
  );
}

function WallPanel({ room, wallIndex, openings }: { room: Room; wallIndex: number; openings: Opening[] }) {
  const select = useEditor((s) => s.setSelection);
  const wallViewOpen = useEditor((s) => s.wallViewOpen);
  const [error, setError] = useState<string | null>(null);
  const assignment = useEditor((s) =>
    s.project.wallpaperAssignments.find((a) => a.roomId === room.id && a.wallIndex === wallIndex),
  );
  const wallpaperId = assignment?.wallpaperId ?? null;
  const paperArea = useEditor((s) => (assignment ? assignmentArea(s.project, assignment) : null));
  const rollWidth = useEditor((s) => s.project.wallpapers.find((w) => w.id === assignment?.wallpaperId)?.rollWidth);
  const wall = getWalls(room)[wallIndex];
  if (!wall) return null;
  const onWall = openings.filter((o) => o.wallIndex === wallIndex);
  const heights = wallEndHeights(room, wallIndex);
  const sloped = Math.abs(heights.start - heights.end) >= 0.5;
  const startCorner = wallIndex;
  const endCorner = (wallIndex + 1) % room.points.length;
  const ownHeight = room.cornerHeights[startCorner] !== null || room.cornerHeights[endCorner] !== null;
  const leftIsStart = wallStartIsOnLeft(room.points, wallIndex);
  return (
    <>
      <button className="link back" onClick={() => select({ kind: 'room', roomId: room.id })}>
        ← {room.name}
      </button>
      <h2>Wall {wallIndex + 1}</h2>
      <Field label="Length">
        <LengthInput value={wall.length} min={10} onCommit={(len) => setError(actions.setWallLength(room.id, wallIndex, len))} />
      </Field>
      {error && <p className="error">{error}</p>}
      <h3>Height</h3>
      <Field label="Whole wall">
        <OptionalLengthInput
          ariaLabel="Wall height"
          value={sloped ? null : heights.start}
          placeholder="sloped"
          min={100}
          max={10_000}
          onCommit={(h) => actions.setCornerHeights(room.id, [startCorner, endCorner], h)}
        />
      </Field>
      <Field label="Left end">
        <LengthInput
          ariaLabel="Height at left end"
          value={leftIsStart ? heights.start : heights.end}
          min={100}
          max={10_000}
          onCommit={(h) => actions.setCornerHeights(room.id, [leftIsStart ? startCorner : endCorner], h)}
        />
      </Field>
      <Field label="Right end">
        <LengthInput
          ariaLabel="Height at right end"
          value={leftIsStart ? heights.end : heights.start}
          min={100}
          max={10_000}
          onCommit={(h) => actions.setCornerHeights(room.id, [leftIsStart ? endCorner : startCorner], h)}
        />
      </Field>
      <p className="note">
        Left and right as seen from inside the room. Each end is a corner shared with the next wall, so lowering this wall makes
        the walls beside it slope.
        {ownHeight && (
          <>
            {' '}
            <button className="link" onClick={() => actions.setCornerHeights(room.id, [startCorner, endCorner], null)}>
              Back to room height ({formatLength(room.wallHeight)})
            </button>
          </>
        )}
      </p>
      <dl className="stats">
        <dt>Wall area</dt>
        <dd>{formatArea(wallGrossArea(wall.length, heights))}</dd>
        {paperArea !== null && (
          <>
            <dt>With wallpaper</dt>
            <dd>{formatArea(paperArea)}</dd>
          </>
        )}
      </dl>
      <h3>Wallpaper</h3>
      <Field label="Wallpaper">
        <WallpaperSelect value={wallpaperId} onChange={(id) => actions.setWallpaper(room.id, [wallIndex], id)} />
      </Field>
      {wallpaperId && (
        <div className="actions inline">
          <EditWallpaperButton wallpaperId={wallpaperId} />
          <span className="muted small">roll size, pattern, price…</span>
        </div>
      )}
      {assignment && (
        <>
          <Field label="Starts at">
            <LengthInput
              ariaLabel="Wallpaper starts at"
              value={assignment.startHeight}
              min={0}
              max={10_000}
              onCommit={(h) => actions.setWallpaperStart(room.id, [wallIndex], h)}
            />
          </Field>
          {assignment.startHeight >= Math.max(heights.start, heights.end) - 0.5 ? (
            <p className="error">The wallpaper starts at or above the ceiling, so none is shown on this wall.</p>
          ) : (
            <p className="note">
              Height above the floor, e.g. above tiles or panelling. The wallpaper goes from here up to the ceiling.
            </p>
          )}
        </>
      )}
      {assignment && rollWidth && (
        <StripList
          plan={stripPlan(wall.length, heights, leftIsStart, assignment.startHeight, rollWidth, onWall)}
          openings={onWall}
        />
      )}
      <h3>Doors & windows</h3>
      {onWall.length === 0 ? (
        <p className="muted">None on this wall.</p>
      ) : (
        <ul className="list">
          {onWall.map((o) => {
            const ok = openingProblems(o, wall.length, heights.start, heights.end).length === 0;
            return (
              <li key={o.id}>
                <button className="link" onClick={() => select({ kind: 'opening', openingId: o.id })}>
                  {OPENING_LABELS[o.type]}
                  {!ok && <span className="badge warn">!</span>}
                </button>
                <span className="muted">
                  {formatLength(o.width)} × {formatLength(o.height)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="actions">
        <button onClick={() => actions.addOpening(room.id, wallIndex, 'door')}>+ Door</button>
        <button onClick={() => actions.addOpening(room.id, wallIndex, 'window')}>+ Window</button>
        <button onClick={() => actions.addOpening(room.id, wallIndex, 'cabinet')} title="Cabinet or other fixed furniture: no wallpaper behind it">
          + Cabinet
        </button>
        <button onClick={() => actions.addOpening(room.id, wallIndex, 'other')}>+ Other</button>
      </div>
      {!wallViewOpen && (
        <div className="actions">
          <button onClick={() => useEditor.getState().setWallViewOpen(true)}>Show wall view</button>
        </div>
      )}
      <p className="note">
        Drag the wall on the plan to move it. Drag a door or window to slide it along the wall — or up and down in the wall
        view.
      </p>
    </>
  );
}

function OpeningPanel({ opening, room }: { opening: Opening; room: Room }) {
  const select = useEditor((s) => s.setSelection);
  const wall = getWalls(room)[opening.wallIndex];
  const endHeights = wallEndHeights(room, opening.wallIndex);
  const problems = wall ? openingProblems(opening, wall.length, endHeights.start, endHeights.end) : ['Wall not found.'];
  const update = (patch: Partial<Opening>) => actions.updateOpening(opening.id, patch);
  return (
    <>
      <button className="link back" onClick={() => select({ kind: 'wall', roomId: room.id, wallIndex: opening.wallIndex })}>
        ← {room.name}, wall {opening.wallIndex + 1}
      </button>
      <h2>{OPENING_LABELS[opening.type]}</h2>
      <Field label="Type">
        <select value={opening.type} onChange={(e) => update({ type: e.target.value as OpeningType })}>
          {(Object.keys(OPENING_LABELS) as OpeningType[]).map((t) => (
            <option key={t} value={t}>
              {OPENING_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Width">
        <LengthInput value={opening.width} onCommit={(width) => update({ width })} />
      </Field>
      <Field label="Height">
        <LengthInput value={opening.height} onCommit={(height) => update({ height })} />
      </Field>
      <Field label="Height above floor">
        <LengthInput value={opening.sillHeight} min={0} onCommit={(sillHeight) => update({ sillHeight })} />
      </Field>
      {opening.type === 'cabinet' && wall && (
        <div className="actions inline">
          <button
            onClick={() => {
              const ceiling = Math.min(
                heightAlong(endHeights, wall.length, opening.offset),
                heightAlong(endHeights, wall.length, opening.offset + opening.width),
              );
              update({ height: Math.max(1, ceiling - opening.sillHeight) });
            }}
          >
            Up to ceiling
          </button>
          <span className="muted small">No wallpaper is hung behind a cabinet.</span>
        </div>
      )}
      <Field label="Distance from wall start">
        <LengthInput value={opening.offset} min={0} onCommit={(offset) => update({ offset })} />
      </Field>
      {wall && (
        <Field label="Distance to wall end">
          <LengthInput
            value={wall.length - opening.offset - opening.width}
            min={0}
            onCommit={(rest) => update({ offset: wall.length - opening.width - rest })}
          />
        </Field>
      )}
      {wall && (
        <p className="muted small">
          Wall length {formatLength(wall.length)}, height {formatWallHeights(endHeights)}. The wall's start corner is marked with a
          ring on the plan. You can also drag the opening along the wall.
        </p>
      )}
      {problems.length > 0 && (
        <div className="error">
          <strong>Doesn't fit:</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="actions">
        <button className="danger" onClick={() => actions.deleteOpening(opening.id)}>
          Delete
        </button>
      </div>
    </>
  );
}

/** Each strip of a wall (from the left corner) with the pieces it needs and what's saved behind cabinets etc. */
function StripList({ plan, openings }: { plan: ReturnType<typeof stripPlan>; openings: Opening[] }) {
  /** "cut around window, door" for openings that cover only part of the strip. */
  const cutText = (st: (typeof plan)[number]) => {
    const names = [
      ...new Set(
        st.cutouts
          .filter((c) => !c.full && openings[c.opening].type !== 'cabinet')
          .map((c) => OPENING_LABELS[openings[c.opening].type].toLowerCase()),
      ),
    ];
    return names.length ? `cut around ${names.join(', ')}` : null;
  };
  const total = plan.reduce((sum, st) => sum + rangeLength(st.pieces), 0);
  const saved = plan.reduce((sum, st) => sum + rangeLength(st.saved), 0);
  return (
    <>
      <h3>Strips</h3>
      <ul className="list strips">
        {plan.map((st) => (
          <li key={st.index}>
            <span>
              Strip {st.index + 1}
              {st.right - st.left < plan[0].right - plan[0].left - 0.5 && (
                <span className="muted small"> ({formatLength(st.right - st.left)} wide)</span>
              )}
            </span>
            <span className="strip-pieces">
              {st.pieces.length === 0 ? (
                <span className="muted">none</span>
              ) : (
                st.pieces.map((pc) => formatLength(pc.to - pc.from)).join(' + ')
              )}
              {st.saved.length > 0 && <span className="saved small"> · {formatLength(rangeLength(st.saved))} saved</span>}
              {cutText(st) && <span className="cut small"> · {cutText(st)}</span>}
            </span>
          </li>
        ))}
        <li className="total">
          <strong>Paper</strong>
          <strong>{formatLength(total)}</strong>
        </li>
      </ul>
      <p className="note">
        {saved >= 0.5
          ? `Where a cabinet, door or window covers a strip's whole width, the strip is cut there: ${formatLength(saved)} of paper isn't needed on this wall and can be used elsewhere.`
          : 'Lengths from the bottom of the wallpaper to the ceiling. A strip is only cut short where something covers its whole width.'}
      </p>
    </>
  );
}

/** Total rolls and cost over all wallpapers (Part 3). */
function WallpaperTotal() {
  const { result } = useRolls();
  const currency = useEditor((s) => s.project.currency);
  if (!result || result.wallpapers.length === 0) return null;
  const rolls = result.wallpapers.reduce((sum, w) => sum + w.rolls, 0);
  return (
    <dl className="stats">
      <dt>Rolls in total</dt>
      <dd>{rolls}</dd>
      <dt>Wallpaper cost</dt>
      <dd>
        {formatMoney(result.totalCost, currency)}
        {result.unpriced.length > 0 && <span className="muted small"> + {result.unpriced.length} without price</span>}
      </dd>
    </dl>
  );
}
