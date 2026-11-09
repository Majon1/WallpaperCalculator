import { PATTERN_MATCH_LABELS, WALLPAPER_COLORS, WALLPAPER_PRESETS } from '../model/project';
import type { Id, PatternMatch, Wallpaper } from '../model/types';
import { formatArea, formatLength } from '../model/units';
import { assignmentArea, repeatsPerRoll } from '../model/wallpaper';
import { formatMoney, rollColor } from './format';
import { useWallpaperRolls } from './useRolls';
import { actions, contextSelection, useEditor, type Selection } from '../store/editorStore';
import { Field, LengthInput, PriceInput, TextInput } from './inputs';

const NEW = '__new__';
const NONE = '';
const MIXED = '__mixed__';

/** Dropdown to choose wallpaper for one or more walls. "mixed" = the walls currently differ. */
export function WallpaperSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: Id | null | 'mixed';
  onChange: (wallpaperId: Id | null) => void;
  ariaLabel?: string;
}) {
  const wallpapers = useEditor((s) => s.project.wallpapers);
  return (
    <select
      aria-label={ariaLabel}
      value={value === 'mixed' ? MIXED : (value ?? NONE)}
      onChange={(e) => {
        const v = e.target.value;
        if (v === MIXED) return;
        if (v === NEW) {
          // Create, assign, then open it for editing (keeping the wall / room in view).
          const back = contextSelection(useEditor.getState().selection);
          const id = actions.addWallpaper();
          onChange(id);
          openWallpaper(id, back);
        } else {
          onChange(v === NONE ? null : v);
        }
      }}
    >
      {value === 'mixed' && <option value={MIXED}>Mixed</option>}
      <option value={NONE}>No wallpaper</option>
      {wallpapers.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
      <option value={NEW}>+ New wallpaper…</option>
    </select>
  );
}

/** Open a wallpaper for editing, remembering the current room / wall / opening so it stays in view. */
function openWallpaper(wallpaperId: Id, back: Selection = contextSelection(useEditor.getState().selection)) {
  useEditor.getState().setSelection({ kind: 'wallpaper', wallpaperId, back: back ?? undefined });
}

/** "Edit" button next to a wallpaper choice: opens its settings (roll size, pattern, price…). */
export function EditWallpaperButton({ wallpaperId }: { wallpaperId: Id }) {
  const editing = useEditor((s) => s.selection?.kind === 'wallpaper' && s.selection.wallpaperId === wallpaperId);
  return (
    <button
      className={`edit-wallpaper${editing ? ' active' : ''}`}
      onClick={() => openWallpaper(wallpaperId)}
      title="Edit this wallpaper: roll size, pattern, price…"
      disabled={editing}
    >
      Edit
    </button>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} />;
}

/** The wallpaper list shown in the project panel. */
export function WallpaperLibrary() {
  const wallpapers = useEditor((s) => s.project.wallpapers);
  const assignments = useEditor((s) => s.project.wallpaperAssignments);
  const select = useEditor((s) => s.setSelection);
  return (
    <>
      {wallpapers.length === 0 ? (
        <p className="muted">No wallpapers yet. Add one, then choose it for walls.</p>
      ) : (
        <ul className="list">
          {wallpapers.map((w) => {
            const used = assignments.filter((a) => a.wallpaperId === w.id).length;
            return (
              <li key={w.id}>
                <button className="link" onClick={() => select({ kind: 'wallpaper', wallpaperId: w.id })}>
                  <Swatch color={w.color} />
                  {w.name}
                </button>
                <span className="muted small">
                  {used === 0 ? (
                    'not used'
                  ) : (
                    <RollsSummary wallpaperId={w.id} />
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="actions">
        <button onClick={() => actions.addWallpaper()}>+ Add wallpaper</button>
      </div>
    </>
  );
}

export function WallpaperPanel({ wallpaper }: { wallpaper: Wallpaper }) {
  const select = useEditor((s) => s.setSelection);
  const back = useEditor((s) => (s.selection?.kind === 'wallpaper' ? (s.selection.back ?? null) : null));
  const backLabel = useEditor((s) => {
    if (!back) return 'Project';
    const roomOf = (id: Id) => s.project.rooms.find((r) => r.id === id)?.name ?? 'Room';
    if (back.kind === 'room') return roomOf(back.roomId);
    if (back.kind === 'wall') return `${roomOf(back.roomId)}, wall ${back.wallIndex + 1}`;
    if (back.kind === 'opening') {
      const o = s.project.openings.find((x) => x.id === back.openingId);
      return o ? `${roomOf(o.roomId)}, wall ${o.wallIndex + 1}` : 'Back';
    }
    return 'Back';
  });
  const currency = useEditor((s) => s.project.currency);
  const project = useEditor((s) => s.project);
  const update = (patch: Partial<Wallpaper>) => actions.updateWallpaper(wallpaper.id, patch);
  const uses = project.wallpaperAssignments.filter((a) => a.wallpaperId === wallpaper.id);
  const usedRooms = project.rooms
    .map((r) => {
      const here = uses.filter((a) => a.roomId === r.id);
      return {
        room: r,
        walls: here.map((a) => a.wallIndex + 1),
        area: here.reduce((sum, a) => sum + assignmentArea(project, a), 0),
      };
    })
    .filter((x) => x.walls.length > 0);
  const presetIndex = WALLPAPER_PRESETS.findIndex(
    (p) => p.rollWidth === wallpaper.rollWidth && p.rollLength === wallpaper.rollLength,
  );

  return (
    <>
      <button className="link back" onClick={() => select(back)}>
        ← {backLabel}
      </button>
      <h2>
        <Swatch color={wallpaper.color} /> Wallpaper
      </h2>
      <Field label="Name">
        <TextInput value={wallpaper.name} onCommit={(name) => update({ name })} />
      </Field>
      <div className="field">
        <span className="field-label">Colour on plan</span>
        <div className="swatches">
          {WALLPAPER_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch-button${c === wallpaper.color ? ' active' : ''}`}
              style={{ background: c }}
              onClick={() => update({ color: c })}
              aria-label={`Colour ${c}`}
            />
          ))}
        </div>
      </div>

      <h3>Roll</h3>
      <Field label="Roll size">
        <select
          value={presetIndex}
          onChange={(e) => {
            const p = WALLPAPER_PRESETS[Number(e.target.value)];
            if (p) update({ rollWidth: p.rollWidth, rollLength: p.rollLength });
          }}
        >
          {presetIndex === -1 && <option value={-1}>Custom</option>}
          {WALLPAPER_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Roll width">
        <LengthInput value={wallpaper.rollWidth} min={100} max={5000} onCommit={(rollWidth) => update({ rollWidth })} />
      </Field>
      <Field label="Roll length">
        <LengthInput value={wallpaper.rollLength} min={1000} max={100_000} onCommit={(rollLength) => update({ rollLength })} />
      </Field>

      <h3>Pattern</h3>
      <Field label="Match">
        <select value={wallpaper.match} onChange={(e) => update({ match: e.target.value as PatternMatch })}>
          {(Object.keys(PATTERN_MATCH_LABELS) as PatternMatch[]).map((m) => (
            <option key={m} value={m}>
              {PATTERN_MATCH_LABELS[m]}
            </option>
          ))}
        </select>
      </Field>
      {wallpaper.match !== 'free' && (
        <Field label="Pattern repeat">
          <LengthInput value={wallpaper.patternRepeat} min={0} max={5000} onCommit={(patternRepeat) => update({ patternRepeat })} />
        </Field>
      )}
      {wallpaper.match !== 'free' && wallpaper.patternRepeat > 0 && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={wallpaper.rollStartsAtPattern}
            onChange={(e) => update({ rollStartsAtPattern: e.target.checked })}
          />
          Rolls start at the start of the pattern
        </label>
      )}
      {wallpaper.match !== 'free' &&
        (() => {
          const fit = repeatsPerRoll(wallpaper.rollLength, wallpaper.patternRepeat);
          if (!fit) return null;
          return (
            <p className="repeats-per-roll">
              <strong>
                {fit.count} {fit.count === 1 ? 'repeat' : 'repeats'} per roll
              </strong>{' '}
              <span className="muted">
                ({formatLength(wallpaper.rollLength)} ÷ {formatLength(wallpaper.patternRepeat)}
                {fit.leftover > 0.5 ? `, ${formatLength(fit.leftover)} left over` : ', no leftover'})
              </span>
            </p>
          );
        })()}
      <p className="note">
        {wallpaper.match === 'free'
          ? 'Plain or random patterns: strips can be hung at any height, so no extra is needed for matching.'
          : wallpaper.match === 'straight'
            ? 'The pattern continues at the same height on the next strip. Shown on the label as a straight arrow, e.g. "64 cm →".'
            : 'Every other strip is shifted by half the repeat. Shown on the label as offset arrows, e.g. "64/32 cm".'}{' '}
        Type the repeat in cm, e.g. "64".
      </p>

      <h3>Price</h3>
      <Field label="Price per roll">
        <PriceInput value={wallpaper.pricePerRoll} currency={currency} onCommit={(pricePerRoll) => update({ pricePerRoll })} />
      </Field>

      <RollsNeeded wallpaper={wallpaper} />

      <h3>Used on</h3>
      {usedRooms.length === 0 ? (
        <p className="muted">Not used yet. Select a wall or a room and choose this wallpaper.</p>
      ) : (
        <ul className="list">
          {usedRooms.map(({ room, walls, area }) => (
            <li key={room.id}>
              <button className="link" onClick={() => select({ kind: 'room', roomId: room.id })}>
                {room.name}
              </button>
              <span className="muted small">
                {walls.length === room.points.length ? 'all walls' : `wall ${walls.sort((a, b) => a - b).join(', ')}`} ·{' '}
                {formatArea(area)}
              </span>
            </li>
          ))}
          {usedRooms.length > 1 && (
            <li className="total">
              <strong>Total</strong>
              <strong>{formatArea(usedRooms.reduce((sum, x) => sum + x.area, 0))}</strong>
            </li>
          )}
        </ul>
      )}
      {usedRooms.length > 0 && (
        <p className="note">Wall area with this wallpaper, without doors, windows and cabinets.</p>
      )}

      <div className="actions">
        <button
          className="danger"
          onClick={() => {
            if (uses.length === 0 || confirm(`Remove "${wallpaper.name}"? It is used on ${uses.length} wall(s).`)) {
              actions.deleteWallpaper(wallpaper.id);
            }
          }}
        >
          Delete wallpaper
        </button>
      </div>
    </>
  );
}

/** Part 3 result for one wallpaper: rolls, cost, and the cutting plan. */
function RollsNeeded({ wallpaper }: { wallpaper: Wallpaper }) {
  const { result, pending } = useWallpaperRolls(wallpaper.id);
  const project = useEditor((s) => s.project);
  if (!result) {
    return pending ? <p className="muted">Calculating rolls…</p> : null;
  }
  const roomName = (id: Id) => project.rooms.find((r) => r.id === id)?.name ?? 'Room';
  return (
    <>
      <h3>Rolls needed</h3>
      <div className={`rolls-needed${pending ? ' pending' : ''}`}>
        <span className="rolls-count">
          {result.rolls} {result.rolls === 1 ? 'roll' : 'rolls'}
        </span>
        {result.cost !== null && <span className="rolls-cost">{formatMoney(result.cost, project.currency)}</span>}
      </div>
      <dl className="stats">
        <dt>Pieces to cut</dt>
        <dd>{result.pieces.length}</dd>
        <dt>Paper used</dt>
        <dd>{formatLength(result.paperUsed)}</dd>
        <dt>Left over</dt>
        <dd>{formatLength(result.leftover)}</dd>
        <dt>Area covered</dt>
        <dd>{formatArea(result.area)}</dd>
      </dl>
      {result.problems.length > 0 && (
        <div className="error">
          <ul>
            {result.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="note">
        Includes {formatLength(project.trimPerEnd)} trim at each cut end
        {wallpaper.match !== 'free' && wallpaper.patternRepeat > 0
          ? wallpaper.rollStartsAtPattern
            ? ', the pattern match, and lining up the first cut from the start of each roll'
            : ', the pattern match, and one repeat per roll to line up the first cut (tick "Rolls start at the start of the pattern" if yours do)'
          : ''}.
        Pieces from all walls are combined on the rolls to use as few as possible. No spare roll included.
      </p>
      {result.plan.length > 0 && <RollBars wallpaper={wallpaper} />}
      {result.plan.length > 0 && (
        <details className="cutting-plan">
          <summary>Cutting plan as a list</summary>
          <ol>
            {result.plan.map((roll, r) => (
              <li key={r}>
                <strong style={{ color: rollColor(r) }}>Roll {r + 1}</strong>{' '}
                <span className="muted small">
                  {formatLength(roll.used)} used, {formatLength(result.usableLength - roll.used)} left
                </span>
                <ul>
                  {roll.cuts.map((c) => {
                    const pc = result.pieces[c.piece];
                    return (
                      <li key={c.piece}>
                        {c.gapBefore >= 0.5 && <span className="muted small">cut off {formatLength(c.gapBefore)} · </span>}
                        {formatLength(pc.cutLength)}{' '}
                        <span className="muted small">
                          {roomName(pc.roomId)}, wall {pc.wallIndex + 1}, strip {pc.stripIndex + 1}
                          {` (${formatLength(pc.from).replace(' cm', '')}–${formatLength(pc.to)})`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

/** "3 rolls · 74.70 €" for the wallpaper list. */
function RollsSummary({ wallpaperId }: { wallpaperId: Id }) {
  const { result } = useWallpaperRolls(wallpaperId);
  const currency = useEditor((s) => s.project.currency);
  if (!result) return <>…</>;
  return (
    <>
      {result.rolls} {result.rolls === 1 ? 'roll' : 'rolls'}
      {result.cost !== null && <> · {formatMoney(result.cost, currency)}</>}
    </>
  );
}

/**
 * The cutting plan drawn as rolls: each bar is one roll, left to right in cutting order. Pieces are coloured by roll
 * (the same colour as the R-badges in the wall view); hatched = cut off to match the pattern; grey = left over.
 */
function RollBars({ wallpaper }: { wallpaper: Wallpaper }) {
  const { result } = useWallpaperRolls(wallpaper.id);
  const project = useEditor((s) => s.project);
  const highlight = useEditor((s) => (s.highlightRoll?.wallpaperId === wallpaper.id ? s.highlightRoll.roll : null));
  const setHighlight = useEditor((s) => s.setHighlightRoll);
  if (!result) return null;
  const L = wallpaper.rollLength;
  const align = L - result.usableLength; // set aside to line up the pattern on a new roll
  const pct = (len: number) => `${(Math.max(0, len) / L) * 100}%`;
  const roomName = (id: Id) => project.rooms.find((r) => r.id === id)?.name ?? 'Room';
  const manyRooms = new Set(result.pieces.map((p) => p.roomId)).size > 1;
  return (
    <div className="roll-bars">
      {result.plan.map((roll, r) => (
        <div
          key={r}
          className={`roll-bar-row${highlight === r ? ' on' : ''}${highlight !== null && highlight !== r ? ' dim' : ''}`}
          onPointerEnter={() => setHighlight({ wallpaperId: wallpaper.id, roll: r })}
          onPointerLeave={() => setHighlight(null)}
        >
          <span className="roll-bar-label" style={{ color: rollColor(r) }}>
            R{r + 1}
          </span>
          <div className="roll-bar">
            {align > 0.5 && <div className="seg align" style={{ width: pct(align) }} title={`Up to ${formatLength(align)} to line up the pattern`} />}
            {roll.cuts.map((c) => {
              const pc = result.pieces[c.piece];
              const where = `${manyRooms ? `${roomName(pc.roomId)} ` : ''}W${pc.wallIndex + 1} S${pc.stripIndex + 1}`;
              return [
                c.gapBefore >= 0.5 && (
                  <div key={`g${c.piece}`} className="seg gap" style={{ width: pct(c.gapBefore) }} title={`Cut off ${formatLength(c.gapBefore)}`} />
                ),
                <div
                  key={`p${c.piece}`}
                  className="seg piece"
                  style={{ width: pct(pc.cutLength), background: rollColor(r) }}
                  title={`${roomName(pc.roomId)}, wall ${pc.wallIndex + 1}, strip ${pc.stripIndex + 1}: ${formatLength(pc.from)}–${formatLength(pc.to)}, cut ${formatLength(pc.cutLength)}`}
                >
                  <span>{where}</span>
                </div>,
              ];
            })}
            <div className="seg rest" style={{ width: pct(result.usableLength - roll.used) }} title={`${formatLength(result.usableLength - roll.used)} left over`} />
          </div>
        </div>
      ))}
      <p className="roll-bars-legend muted small">
        Each bar is one roll ({formatLength(L)}), cut from left to right. <span className="key piece" /> piece (W = wall, S = strip)
        {align > 0.5 && (
          <>
            {' '}
            <span className="key align" /> lining up the pattern
          </>
        )}{' '}
        <span className="key gap" /> cut off <span className="key rest" /> left over. Point at a roll to see its pieces in the wall view.
      </p>
    </div>
  );
}
