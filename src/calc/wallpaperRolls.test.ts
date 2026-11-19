import { describe, expect, it } from 'vitest';
import { emptyProject } from '../model/project';
import type { Opening, PatternMatch, Project, Wallpaper } from '../model/types';
import {
  bestInsertion,
  gatherLeftover,
  calcProject,
  calcWallpaper,
  collectPieces,
  gapBetween,
  greedyRolls,
  packRolls,
  lengthUsed,
  pieceKey,
  type Piece,
} from './wallpaperRolls';

// SPEC.md Part 3 worked examples: room 400 × 300 cm, wallpaper 53 cm × 1005 cm, trim 5 cm, repeat 64 cm.

const wallpaper = (match: PatternMatch, patternRepeat = 640, pricePerRoll: number | null = null): Wallpaper => ({
  id: 'w',
  name: 'Test',
  color: '#999999',
  rollWidth: 530,
  rollLength: 10_050,
  patternRepeat,
  match,
  rollStartsAtPattern: false,
  manualPlan: null,
  pricePerRoll,
});

function room(height: number, openings: Opening[] = [], wp: Wallpaper = wallpaper('free'), startHeight = 0): Project {
  return {
    ...emptyProject(),
    rooms: [
      {
        id: 'r',
        name: 'Kitchen',
        wallHeight: height,
        cornerHeights: [null, null, null, null],
        // clockwise on screen: wall 0 is the top wall, its start corner is on the left seen from inside
        points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }],
      },
    ],
    openings,
    wallpapers: [wp],
    wallpaperAssignments: [0, 1, 2, 3].map((wallIndex) => ({ roomId: 'r', wallIndex, wallpaperId: wp.id, startHeight, stripExtra: {} })),
  };
}

const rollsFor = (p: Project) => calcWallpaper(p, p.wallpapers[0]);
/** The roll with the most paper used. */
const fullest = (r: ReturnType<typeof rollsFor>) => r.plan.reduce((a, b) => (b.used > a.used ? b : a));

const piece = (cutLength: number, startPhase = 0, endPhase = 0): Piece => ({
  roomId: 'r',
  wallIndex: 0,
  stripIndex: 0,
  from: 0,
  to: cutLength,
  cutLength,
  extra: 0,
  startPhase,
  endPhase,
});

describe('worked examples: height 260 cm (cut 270 cm)', () => {
  it('has 28 strips of 270 cm', () => {
    const { pieces } = collectPieces(room(2600), wallpaper('free'));
    expect(pieces).toHaveLength(28);
    expect(pieces.every((p) => p.cutLength === 2700)).toBe(true);
  });

  it('free match: 3 strips per roll → 10 rolls', () => {
    const r = rollsFor(room(2600));
    expect(r.rolls).toBe(10);
    expect(Math.max(...r.plan.map((roll) => roll.cuts.length))).toBe(3);
    expect(r.usableLength).toBe(10_050);
  });

  it('straight match: phases 0 → 14, gap 50 between strips, 3 per roll → 10 rolls', () => {
    const p = room(2600, [], wallpaper('straight'));
    const { pieces } = collectPieces(p, p.wallpapers[0]);
    expect(pieces[0].startPhase).toBeCloseTo(0); // the pattern starts at the bottom of the cut
    expect(pieces[0].endPhase).toBeCloseTo(140);
    const r = rollsFor(p);
    expect(r.usableLength).toBe(9410);
    expect(r.rolls).toBe(10);
    expect(fullest(r).used).toBeCloseTo(9100); // 270 + 50 + 270 + 50 + 270
    expect(fullest(r).cuts.map((c) => c.gapBefore)).toEqual([0, 500, 500].map((g) => expect.closeTo(g)));
  });

  it('half-drop: odd strips start at phase 32, gaps of 18 → 10 rolls', () => {
    const p = room(2600, [], wallpaper('offset'));
    const { pieces } = collectPieces(p, p.wallpapers[0]);
    expect(pieces[0].startPhase).toBeCloseTo(0);
    expect(pieces[1].startPhase).toBeCloseTo(320);
    const r = rollsFor(p);
    expect(r.rolls).toBe(10);
    expect(fullest(r).cuts.map((c) => c.gapBefore)).toEqual([0, 180, 180].map((g) => expect.closeTo(g)));
  });
});

describe('worked examples: height 300 cm (cut 310 cm)', () => {
  it('straight match: 2 strips per roll → 14 rolls with 311 cm left on each', () => {
    const r = rollsFor(room(3000, [], wallpaper('straight')));
    expect(r.rolls).toBe(14);
    expect(fullest(r).used).toBeCloseTo(6300);
    expect(r.usableLength - fullest(r).used).toBeCloseTo(3110);
  });

  it('a door over a whole strip: its 100 cm piece (phase 18) fits a leftover → still 14 rolls', () => {
    const door: Opening = { id: 'd', roomId: 'r', wallIndex: 0, type: 'door', offset: 400, width: 900, height: 2100, sillHeight: 0 };
    const p = room(3000, [door], wallpaper('straight'));
    const { pieces } = collectPieces(p, p.wallpapers[0]);
    expect(pieces).toHaveLength(28);
    const above = pieces.find((x) => x.wallIndex === 0 && x.stripIndex === 1)!;
    expect([above.from, above.to, above.cutLength]).toEqual([2100, 3000, 1000]);
    expect(above.startPhase).toBeCloseTo(180); // cut starts at 205 cm = 210 cm above the pattern origin at −5 cm
    const r = rollsFor(p);
    expect(r.rolls).toBe(14);
    const withDoorPiece = r.plan.find((roll) =>
      roll.cuts.some((c) => r.pieces[c.piece].wallIndex === 0 && r.pieces[c.piece].stripIndex === 1),
    )!;
    // the short piece fills a leftover; it never needs a 15th roll
    expect(withDoorPiece.used).toBeLessThanOrEqual(r.usableLength);
  });
});

describe('mixing long and short strips (sloped ceiling)', () => {
  const pieces = [4000, 4000, 3000, 3000, 3000, 3000].map((c) => piece(c));

  it('greedy alone needs 3 rolls', () => {
    expect(greedyRolls([0, 1, 2, 3, 4, 5], pieces, 10_050, 0)).toHaveLength(3);
  });

  it('filling one roll at a time already finds 2 rolls, without the search', () => {
    expect(packRolls(pieces, 10_050, 0, 0)).toHaveLength(2);
  });

  it('the search finds 400 + 300 + 300 twice → 2 rolls', () => {
    const rolls = packRolls(pieces, 10_050, 0);
    expect(rolls).toHaveLength(2);
    expect(rolls.map((r) => r.map((i) => pieces[i].cutLength).sort())).toEqual([
      [3000, 3000, 4000],
      [3000, 3000, 4000],
    ]);
  });

  it('works with a real sloped wall in the project', () => {
    // Lean-to: wall 0 low (2.0 m), wall 2 high (3.5 m); walls 1 and 3 slope.
    const p = room(3500);
    p.rooms[0].cornerHeights = [2000, 2000, null, null];
    const r = rollsFor(p);
    const total = r.pieces.reduce((s, x) => s + x.cutLength, 0);
    expect(r.rolls).toBeGreaterThanOrEqual(Math.ceil(total / 10_050));
    expect(r.plan.every((roll) => roll.used <= 10_050)).toBe(true);
    expect(r.plan.flatMap((roll) => roll.cuts.map((c) => c.piece)).sort((a, b) => a - b)).toEqual(r.pieces.map((_, i) => i));
  });
});

describe('matching halves', () => {
  it('a piece continuing the pattern of the last cut has no gap', () => {
    // Below a window 0–90 cm: cut −5–95 → phases 0 → 36 (the pattern starts at the bottom of the cut, −5 cm).
    const p = room(2600, [
      { id: 'w1', roomId: 'r', wallIndex: 0, type: 'window', offset: 0, width: 1060, height: 1000, sillHeight: 900 },
    ], wallpaper('straight'));
    const below = collectPieces(p, p.wallpapers[0]).pieces.find((x) => x.wallIndex === 0 && x.stripIndex === 0 && x.from === 0)!;
    expect(below.cutLength).toBe(1000);
    expect(below.startPhase).toBeCloseTo(0);
    expect(below.endPhase).toBeCloseTo(360);
    // Above an opening 228 cm high: cut starts at 223 → phase 36 → no gap. Above a 210 cm door: phase 18 → 46 cm gap.
    expect(gapBetween(below.endPhase, 2280 % 640, 640)).toBeCloseTo(0);
    expect(gapBetween(below.endPhase, 2100 % 640, 640)).toBeCloseTo(460);
  });

  it('bestInsertion puts a piece where the pattern continues', () => {
    const pieces = [piece(1000, 590, 310), piece(2000, 0, 0), piece(500, 310, 170)];
    // Roll has [0, 1]; inserting piece 2 right after piece 0 costs no gap.
    const fit = bestInsertion([0, 1], 2, pieces, 640);
    expect(fit.order).toEqual([0, 2, 1]);
  });
});

describe('problems and costs', () => {
  it('reports strips longer than a roll and leaves them out', () => {
    const p = room(2600);
    p.wallpapers[0] = { ...p.wallpapers[0], rollLength: 2000 };
    const r = rollsFor(p);
    expect(r.rolls).toBe(0);
    expect(r.problems).toHaveLength(28);
    expect(r.problems[0]).toContain('longer than a roll');
  });

  it('reports walls where the paper starts above the ceiling', () => {
    const r = rollsFor(room(2600, [], wallpaper('free'), 3000));
    expect(r.problems).toHaveLength(4);
    expect(r.problems[0]).toContain('above the ceiling');
  });

  it('ignores openings that do not fit their wall', () => {
    const tooTall: Opening = { id: 'x', roomId: 'r', wallIndex: 0, type: 'window', offset: 0, width: 4000, height: 3000, sillHeight: 0 };
    expect(collectPieces(room(2600, [tooTall]), wallpaper('free')).pieces).toHaveLength(28);
  });

  it('uses the trim setting', () => {
    const p = { ...room(2600), trimPerEnd: 0 };
    expect(collectPieces(p, p.wallpapers[0]).pieces[0].cutLength).toBe(2600);
  });

  it('computes cost, leftover and project totals', () => {
    const p = room(2600, [], wallpaper('free', 0, 24.9));
    const unpriced = { ...wallpaper('free'), id: 'u' };
    p.wallpapers.push(unpriced, { ...wallpaper('free'), id: 'unused' });
    p.wallpaperAssignments[3] = { ...p.wallpaperAssignments[3], wallpaperId: 'u' };
    const result = calcProject(p);
    expect(result.wallpapers.map((w) => w.wallpaperId)).toEqual(['w', 'u']);
    const w = result.wallpapers[0];
    expect(w.rolls).toBe(8); // 22 strips → 3 per roll
    expect(w.cost).toBeCloseTo(8 * 24.9);
    expect(w.leftover).toBeCloseTo(8 * 10_050 - 22 * 2700);
    expect(w.area).toBe(3 * 0 + (4000 + 3000 + 4000) * 2600);
    expect(result.totalCost).toBeCloseTo(8 * 24.9);
    expect(result.unpriced).toEqual(['u']);
  });
});

describe('search', () => {
  it('never does worse than the starting answers and stays within the roll', () => {
    // Pattern pieces of mixed lengths and phases.
    const pieces = [3100, 2900, 2700, 2500, 2300, 2100, 1900, 1000, 900, 600].map((c, k) => piece(c, (k * 170) % 640, (k * 170 + c) % 640));
    const sorted = pieces.map((_, i) => i).sort((a, b) => pieces[b].cutLength - pieces[a].cutLength || a - b);
    const greedy = greedyRolls(sorted, pieces, 9410, 640);
    const rolls = packRolls(pieces, 9410, 640);
    expect(rolls.length).toBeLessThanOrEqual(greedy.length);
    expect(rolls.flat().sort((a, b) => a - b)).toEqual(pieces.map((_, i) => i));
  });

  it('is deterministic', () => {
    const p = room(3000, [], wallpaper('offset'));
    p.rooms[0].cornerHeights = [2000, 2000, null, null];
    expect(calcWallpaper(p, p.wallpapers[0]).plan).toEqual(calcWallpaper(p, p.wallpapers[0]).plan);
  });
});

describe('rolls that start at the start of the pattern', () => {
  it('height 292 cm, straight: 2 strips per roll normally, 3 when the roll starts at the pattern', () => {
    // cut 302 cm, s = 0, e = 46, gap 18 between strips: three strips = 302 + 320 + 320 = 942 cm.
    const unknown = room(2920, [], wallpaper('straight'));
    expect(rollsFor(unknown).usableLength).toBe(9410);
    expect(rollsFor(unknown).rolls).toBe(14); // 942 > 941
    const known = room(2920, [], { ...wallpaper('straight'), rollStartsAtPattern: true });
    const r = rollsFor(known);
    expect(r.usableLength).toBe(10_050);
    expect(r.rolls).toBe(10); // a floor strip starts right at the roll start: 942 <= 1005
    expect(r.plan.every((roll) => roll.cuts[0].gapBefore < 0.5)).toBe(true); // nothing cut off before the first strip
    expect(fullest(r).used).toBeCloseTo(9420);
  });

  it('has no effect on free match', () => {
    const p = room(2600, [], { ...wallpaper('free'), rollStartsAtPattern: true });
    expect(rollsFor(p).rolls).toBe(10);
    expect(rollsFor(p).plan[0].cuts[0].gapBefore).toBe(0);
  });

  it('puts the piece that needs the least lining up first on the roll', () => {
    // From the roll start (phase 0): piece A starts at phase 300, piece B at phase 0 and ends at 300.
    const pieces = [piece(1000, 300, 0), piece(2220, 0, 300)];
    const fit = bestInsertion([0], 1, pieces, 640, 0);
    expect(fit.order).toEqual([1, 0]);
    expect(fit.used).toBeCloseTo(3220);
  });
});

describe('gathering the spare paper on one roll', () => {
  const used = (orders: number[][], pieces: Piece[]) => orders.map((r) => r.reduce((sum, i) => sum + pieces[i].cutLength, 0));

  it('moves a piece so that one roll keeps a long leftover', () => {
    // [500 + 400] (105 left) and [600 + 100] (305 left): moving the 100 gives [500 + 400 + 100] and [600] → 405 left.
    const pieces = [5000, 4000, 6000, 1000].map((c) => piece(c));
    const gathered = gatherLeftover([[0, 1], [2, 3]], pieces, 10_050, 0);
    expect(used(gathered, pieces).sort()).toEqual([10_000, 6000]);
  });

  it('swaps pieces when that makes the largest leftover bigger', () => {
    // [700 + 200] (105 left) and [400 + 300] (305 left): swapping 200 ↔ 300 gives [700 + 300] and [400 + 200] → 405 left.
    const pieces = [7000, 2000, 4000, 3000].map((c) => piece(c));
    const gathered = gatherLeftover([[0, 1], [2, 3]], pieces, 10_050, 0);
    expect(Math.max(...used(gathered, pieces).map((u) => 10_050 - u))).toBe(4050);
  });

  it('includes the pattern waste: a better phase fit frees length', () => {
    // Pattern 640: A and C continue each other's pattern (no gap), B does not.
    const pieces = [piece(4000, 0, 160), piece(4000, 500, 20), piece(4000, 160, 0), piece(1000, 20, 0)];
    const before = [[0, 1], [2, 3]];
    const gathered = gatherLeftover(before, pieces, 9410, 640);
    const largest = (o: number[][]) => Math.max(...o.map((r) => 9410 - lengthUsed(r, pieces, 640)));
    expect(largest(gathered)).toBeGreaterThan(largest(before));
    expect(gathered.every((r) => lengthUsed(r, pieces, 640) <= 9410)).toBe(true);
  });

  it('never changes the number of rolls and keeps every piece', () => {
    const p = room(2600, [], wallpaper('straight'));
    const r = rollsFor(p);
    expect(r.rolls).toBe(10);
    expect(r.plan.flatMap((roll) => roll.cuts.map((c) => c.piece)).sort((a, b) => a - b)).toEqual(r.pieces.map((_, i) => i));
    expect(r.plan.every((roll) => roll.used <= r.usableLength + 1e-6)).toBe(true);
  });
});

describe('strip lengths changed by hand', () => {
  it('adds the change to the strip, and the rolls follow', () => {
    const p = room(2600);
    p.wallpaperAssignments[0] = { ...p.wallpaperAssignments[0], stripExtra: { 1: 600, 2: -300 } };
    const { pieces } = collectPieces(p, p.wallpapers[0]);
    const wall0 = pieces.filter((x) => x.wallIndex === 0);
    expect(wall0[0].cutLength).toBe(2700);
    expect([wall0[1].cutLength, wall0[1].extra]).toEqual([3300, 600]);
    expect([wall0[2].cutLength, wall0[2].extra]).toEqual([2400, -300]);
    const r = rollsFor(p);
    expect(r.pieces.reduce((s, x) => s + x.cutLength, 0)).toBe(28 * 2700 + 300);
  });

  it('changes the top piece of a strip that is cut in two', () => {
    const window = { id: 'w', roomId: 'r', wallIndex: 0, type: 'window' as const, offset: 0, width: 1060, height: 1000, sillHeight: 900 };
    const p = room(2600, [window]);
    p.wallpaperAssignments[0] = { ...p.wallpaperAssignments[0], stripExtra: { 0: 200 } };
    const strip0 = collectPieces(p, p.wallpapers[0]).pieces.filter((x) => x.wallIndex === 0 && x.stripIndex === 0);
    expect(strip0.map((x) => [x.from, x.cutLength, x.extra])).toEqual([
      [0, 1000, 0],
      [1900, 800 + 200, 200],
    ]);
  });

  it('moves the pattern end with the new length', () => {
    const p = room(2600, [], wallpaper('straight'));
    p.wallpaperAssignments[0] = { ...p.wallpaperAssignments[0], stripExtra: { 0: 100 } };
    const first = collectPieces(p, p.wallpapers[0]).pieces[0];
    expect(first.startPhase).toBeCloseTo(0);
    expect(first.endPhase).toBeCloseTo(2800 % 640);
  });

  it('never makes a piece shorter than 1 cm', () => {
    const p = room(2600);
    p.wallpaperAssignments[0] = { ...p.wallpaperAssignments[0], stripExtra: { 0: -5000 } };
    expect(collectPieces(p, p.wallpapers[0]).pieces[0].cutLength).toBe(10);
  });
});

describe('strips removed by hand', () => {
  it('cuts no paper for them', () => {
    const p = room(2600);
    p.wallpaperAssignments[0] = { ...p.wallpaperAssignments[0], stripExtra: { 7: null } };
    const { pieces } = collectPieces(p, p.wallpapers[0]);
    expect(pieces).toHaveLength(27);
    expect(pieces.some((x) => x.wallIndex === 0 && x.stripIndex === 7)).toBe(false);
    expect(rollsFor(p).rolls).toBe(9); // 27 strips, 3 per roll
  });
});

describe('a cutting plan arranged by hand', () => {
  const base = room(2600);
  const auto = rollsFor(base);
  const keys = auto.plan.map((roll) => roll.cuts.map((c) => pieceKey(auto.pieces[c.piece])));
  const withPlan = (manualPlan: string[][], p: Project = base) => ({ ...p, wallpapers: [{ ...p.wallpapers[0], manualPlan }] });
  const keysOf = (r: ReturnType<typeof rollsFor>) => r.plan.map((roll) => roll.cuts.map((c) => pieceKey(r.pieces[c.piece])));

  it('is followed as it is', () => {
    const manualPlan = [keys[0].slice(1), ...keys.slice(1), [keys[0][0]]]; // first piece on a roll of its own
    const r = rollsFor(withPlan(manualPlan));
    expect(r.manual).toBe(true);
    expect(r.manualChanges).toEqual({ dropped: 0, added: 0, outdated: false });
    expect(r.rolls).toBe(auto.rolls + 1);
    expect(keysOf(r)).toEqual(manualPlan);
  });

  it('marks rolls that are too short instead of fixing them', () => {
    const r = rollsFor(withPlan([[...keys[0], ...keys[1]], ...keys.slice(2)])); // 6 × 270 cm on one roll
    expect(r.plan[0].tooLong).toBe(true);
    expect(r.problems[0]).toBe('Roll 1 is 615 cm too short for its pieces.');
  });

  it('drops pieces that no longer exist and empty rolls', () => {
    const r = rollsFor(withPlan([[], ...keys, ['gone:0:0:0']]));
    expect(r.manualChanges).toEqual({ dropped: 1, added: 0, outdated: false });
    expect(r.rolls).toBe(auto.rolls);
  });

  it('adds new pieces where they fit, keeping the rest of the arrangement', () => {
    // leave one piece out of the arrangement: it is added back automatically
    const missing = keys[0][0];
    const plan = [keys[0].slice(1), ...keys.slice(1)];
    const r = rollsFor(withPlan(plan));
    expect(r.manualChanges).toEqual({ dropped: 0, added: 1, outdated: false });
    expect(keysOf(r).flat()).toContain(missing);
    expect(keysOf(r)[1]).toEqual(keys[1]); // other rolls untouched
  });

  it('keeps the arrangement when a strip is removed', () => {
    const p = withPlan(keys);
    p.wallpaperAssignments = p.wallpaperAssignments.map((a, i) => (i === 0 ? { ...a, stripExtra: { 0: null } } : a));
    const r = rollsFor(p);
    expect(r.manual).toBe(true);
    expect(r.manualChanges.dropped).toBe(1);
    expect(r.pieces).toHaveLength(27);
  });

  it('falls back to automatic when nothing matches any more', () => {
    const r = rollsFor(withPlan([['a:0:0:0'], ['b:0:0:0']]));
    expect(r.manual).toBe(false);
    expect(r.manualChanges.outdated).toBe(true);
    expect(r.rolls).toBe(auto.rolls);
  });
});
