import { describe, expect, it } from 'vitest';
import { emptyProject } from '../model/project';
import type { Opening, PatternMatch, Project, Wallpaper } from '../model/types';
import {
  balanceRolls,
  bestInsertion,
  calcProject,
  calcWallpaper,
  collectPieces,
  gapBetween,
  greedyRolls,
  packRolls,
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
    wallpaperAssignments: [0, 1, 2, 3].map((wallIndex) => ({ roomId: 'r', wallIndex, wallpaperId: wp.id, startHeight })),
  };
}

const rollsFor = (p: Project) => calcWallpaper(p, p.wallpapers[0]);
/** The roll with the most paper used (balancing moves pieces around, so look at the fullest one). */
const fullest = (r: ReturnType<typeof rollsFor>) => r.plan.reduce((a, b) => (b.used > a.used ? b : a));

const piece = (cutLength: number, startPhase = 0, endPhase = 0): Piece => ({
  roomId: 'r',
  wallIndex: 0,
  stripIndex: 0,
  from: 0,
  to: cutLength,
  cutLength,
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

  it('straight match: phases 59 → 9, gap 50 between strips, 3 per roll → 10 rolls', () => {
    const p = room(2600, [], wallpaper('straight'));
    const { pieces } = collectPieces(p, p.wallpapers[0]);
    expect(pieces[0].startPhase).toBeCloseTo(590);
    expect(pieces[0].endPhase).toBeCloseTo(90);
    const r = rollsFor(p);
    expect(r.usableLength).toBe(9410);
    expect(r.rolls).toBe(10);
    expect(fullest(r).used).toBeCloseTo(9100); // 270 + 50 + 270 + 50 + 270
    expect(fullest(r).cuts.map((c) => c.gapBefore)).toEqual([0, 500, 500].map((g) => expect.closeTo(g)));
  });

  it('half-drop: odd strips start at phase 27, gaps of 18 → 10 rolls', () => {
    const p = room(2600, [], wallpaper('offset'));
    const { pieces } = collectPieces(p, p.wallpapers[0]);
    expect(pieces[0].startPhase).toBeCloseTo(590);
    expect(pieces[1].startPhase).toBeCloseTo(270);
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

  it('a door over a whole strip: its 100 cm piece (phase 13) fits a leftover → still 14 rolls', () => {
    const door: Opening = { id: 'd', roomId: 'r', wallIndex: 0, type: 'door', offset: 400, width: 900, height: 2100, sillHeight: 0 };
    const p = room(3000, [door], wallpaper('straight'));
    const { pieces } = collectPieces(p, p.wallpapers[0]);
    expect(pieces).toHaveLength(28);
    const above = pieces.find((x) => x.wallIndex === 0 && x.stripIndex === 1)!;
    expect([above.from, above.to, above.cutLength]).toEqual([2100, 3000, 1000]);
    expect(above.startPhase).toBeCloseTo(130);
    const r = rollsFor(p);
    expect(r.rolls).toBe(14);
    const withDoorPiece = r.plan.find((roll) =>
      roll.cuts.some((c) => r.pieces[c.piece].wallIndex === 0 && r.pieces[c.piece].stripIndex === 1),
    )!;
    // balancing puts the short piece on a roll of its own strips' count; it never needs a 15th roll
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
    // Below a window 0–90 cm: cut −5–95 → phases 59 → 31.
    const p = room(2600, [
      { id: 'w1', roomId: 'r', wallIndex: 0, type: 'window', offset: 0, width: 1060, height: 1000, sillHeight: 900 },
    ], wallpaper('straight'));
    const below = collectPieces(p, p.wallpapers[0]).pieces.find((x) => x.wallIndex === 0 && x.stripIndex === 0 && x.from === 0)!;
    expect(below.cutLength).toBe(1000);
    expect(below.startPhase).toBeCloseTo(590);
    expect(below.endPhase).toBeCloseTo(310);
    // Above an opening 228 cm high: cut starts at 223 → phase 31 → no gap. Above a 210 cm door: phase 13 → 46 cm gap.
    expect(gapBetween(below.endPhase, (2280 - 50) % 640, 640)).toBeCloseTo(0);
    expect(gapBetween(below.endPhase, (2100 - 50) % 640, 640)).toBeCloseTo(460);
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
    // cut 302 cm, s = 59, e = 41, gap 18 between strips: three strips = 302 + 320 + 320 = 942 cm.
    const unknown = room(2920, [], wallpaper('straight'));
    expect(rollsFor(unknown).usableLength).toBe(9410);
    expect(rollsFor(unknown).rolls).toBe(14); // 942 > 941
    const known = room(2920, [], { ...wallpaper('straight'), rollStartsAtPattern: true });
    const r = rollsFor(known);
    expect(r.usableLength).toBe(10_050);
    expect(r.rolls).toBe(10); // 59 (to the first strip's phase) + 942 = 1001 <= 1005
    expect(r.plan.every((roll) => roll.cuts[0].gapBefore > 0)).toBe(true); // lined up from the roll start
    expect(fullest(r).cuts[0].gapBefore).toBeCloseTo(590);
    expect(fullest(r).used).toBeCloseTo(10_010);
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

describe('balancing the spare paper', () => {
  it('spreads the leftover over the rolls without adding a roll', () => {
    // 400 + 300 + 300 = 1000 on one roll (5 cm left) and 200 on the other: move the 400 → 600 and 600.
    const pieces = [4000, 3000, 3000, 2000].map((c) => piece(c));
    const balanced = balanceRolls([[0, 1, 2], [3]], pieces, 10_050, 0);
    expect(balanced).toHaveLength(2);
    const used = balanced.map((r) => r.reduce((sum, i) => sum + pieces[i].cutLength, 0)).sort();
    expect(used).toEqual([6000, 6000]);
  });

  it('swaps pieces when a move alone would not fit', () => {
    // [500, 450] = 950 and [400, 100] = 500: swapping 450 ↔ 100 gives 600 / 850 → fullest 850 instead of 950.
    const pieces = [5000, 4500, 4000, 1000].map((c) => piece(c));
    const balanced = balanceRolls([[0, 1], [2, 3]], pieces, 10_050, 0);
    const used = balanced.map((r) => r.reduce((sum, i) => sum + pieces[i].cutLength, 0));
    expect(Math.max(...used)).toBeLessThan(9500);
    expect(balanced.flat().sort()).toEqual([0, 1, 2, 3]);
  });

  it('keeps every roll within its usable length, also with a pattern', () => {
    const p = room(2600, [], wallpaper('straight'));
    const r = rollsFor(p);
    expect(r.rolls).toBe(10);
    expect(r.plan.every((roll) => roll.used <= r.usableLength + 1e-6)).toBe(true);
  });

  it('makes the 28-strip free-match room even: 9 rolls of 3 and one of 1 becomes no roll nearly empty', () => {
    const r = rollsFor(room(2600));
    expect(r.rolls).toBe(10);
    const left = r.plan.map((roll) => r.usableLength - roll.used);
    // before balancing the last roll held 1 strip (735 cm left) and the others 3 (195 cm left);
    // a free-match roll can't do better than 3 strips, so the fullest roll still has 195 cm left.
    expect(Math.min(...left)).toBeCloseTo(1950);
  });
});
