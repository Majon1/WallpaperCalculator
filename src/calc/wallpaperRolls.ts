/**
 * Part 3 — how many rolls of each wallpaper are needed. See SPEC.md, Part 3.
 * Pure functions: no UI or store imports. All lengths in mm.
 */
import { getWalls, openingProblems, wallEndHeights, wallStartIsOnLeft } from '../model/geometry';
import type { Id, Project, Wallpaper } from '../model/types';
import { assignmentArea, stripPlan } from '../model/wallpaper';

/** One piece of paper to cut from a roll. */
export interface Piece {
  roomId: Id;
  wallIndex: number;
  /** Strip number on the wall, 0 = first from the left corner (as seen from inside the room). */
  stripIndex: number;
  /** Height range on the wall that the piece covers (without trim). */
  from: number;
  to: number;
  /** Piece length + 2 × trim (+ the strip's length change by hand, on its top piece). */
  cutLength: number;
  /** Length added by hand (`WallpaperAssignment.stripExtra`); 0 when as calculated. */
  extra: number;
  /** Where in the pattern repeat the cut starts / ends, in [0, repeat). Always 0 for free match. */
  startPhase: number;
  endPhase: number;
}

export interface RollCut {
  /** Index into `WallpaperResult.pieces`. */
  piece: number;
  /** Paper cut off and thrown away before this piece, to reach its place in the pattern. */
  gapBefore: number;
}

export interface Roll {
  /** Pieces in cutting order. */
  cuts: RollCut[];
  /** Sum of cut lengths and gaps. */
  used: number;
  /** used > usable length: only possible in an arrangement made by hand. */
  tooLong: boolean;
}

export interface WallpaperResult {
  wallpaperId: Id;
  /** The plan follows an arrangement made by hand (`Wallpaper.manualPlan`). */
  manual: boolean;
  /**
   * Differences between the hand-made arrangement and the current pieces: pieces it lists that no longer exist
   * (dropped), and new pieces it doesn't list (placed automatically). `outdated`: nothing matched any more, so the
   * plan was calculated automatically.
   */
  manualChanges: { dropped: number; added: number; outdated: boolean };
  rolls: number;
  /** rolls × price per roll; null when the price is unknown. */
  cost: number | null;
  pieces: Piece[];
  /** The cutting plan: which pieces come from which roll, in which order. */
  plan: Roll[];
  /** Length of each roll that can be used (roll length, minus one repeat for patterned paper unless rolls start at the pattern). */
  usableLength: number;
  /** Sum of cut lengths and gaps. */
  paperUsed: number;
  /** rolls × usable length − paperUsed. */
  leftover: number;
  /** Net wallpapered area (mm²), for reference. */
  area: number;
  problems: string[];
}

export interface ProjectResult {
  wallpapers: WallpaperResult[];
  /** Sum of the costs that are known. */
  totalCost: number;
  /** Wallpapers with a price unknown (left out of totalCost). */
  unpriced: Id[];
}

/** Search budget for the roll packing (SPEC: 200 000 steps). */
export const SEARCH_STEPS = 200_000;

const EPS = 1e-6;

/** Shortest piece that can be cut, also when a strip is shortened by hand. */
export const MIN_CUT = 10;

/** x mod r in [0, r), with values within EPS of r snapped to 0. */
function mod(x: number, r: number): number {
  const m = ((x % r) + r) % r;
  return m > r - EPS ? 0 : m;
}

export const isPatterned = (w: Pick<Wallpaper, 'match' | 'patternRepeat'>): boolean =>
  w.match !== 'free' && w.patternRepeat > 0;

/** Step 1 + 2: the pieces of one wallpaper, in room order → wall index → strip → height. */
export function collectPieces(project: Project, wallpaper: Wallpaper): { pieces: Piece[]; problems: string[] } {
  const R = isPatterned(wallpaper) ? wallpaper.patternRepeat : 0;
  const t = project.trimPerEnd;
  const pieces: Piece[] = [];
  const problems: string[] = [];
  for (const room of project.rooms) {
    const walls = getWalls(room);
    const assignments = project.wallpaperAssignments
      .filter((a) => a.roomId === room.id && a.wallpaperId === wallpaper.id)
      .sort((a, b) => a.wallIndex - b.wallIndex);
    for (const a of assignments) {
      const wall = walls[a.wallIndex];
      if (!wall || wall.length <= 0) continue;
      const heights = wallEndHeights(room, wall.index);
      // Openings that don't fit their wall are ignored (paper is counted as if they weren't there).
      const openings = project.openings.filter(
        (o) =>
          o.roomId === room.id &&
          o.wallIndex === wall.index &&
          openingProblems(o, wall.length, heights.start, heights.end).length === 0,
      );
      const plan = stripPlan(wall.length, heights, wallStartIsOnLeft(room.points, wall.index), a.startHeight, wallpaper.rollWidth, openings);
      if (plan.every((st) => st.pieces.length === 0 && st.saved.length === 0)) {
        problems.push(`${room.name}, wall ${wall.index + 1}: the wallpaper starts at or above the ceiling.`);
        continue;
      }
      for (const st of plan) {
        // The pattern starts at the bottom of the cut: one trim below where the paper starts on the wall
        // (so a floor strip starts right at a pattern start on the roll), half a repeat higher on odd half-drop strips.
        const origin = a.startHeight - t + (wallpaper.match === 'offset' && st.index % 2 === 1 ? R / 2 : 0);
        // A strip removed by hand gets no paper; a length changed by hand goes on its top piece (at the ceiling).
        const edit = a.stripExtra[String(st.index)];
        if (edit === null) continue;
        const extra = edit ?? 0;
        for (const [k, pc] of st.pieces.entries()) {
          const own = k === st.pieces.length - 1 ? extra : 0;
          const cutLength = Math.max(MIN_CUT, pc.to - pc.from + 2 * t + own);
          const startPhase = R > 0 ? mod(pc.from - t - origin, R) : 0;
          pieces.push({
            roomId: room.id,
            wallIndex: wall.index,
            stripIndex: st.index,
            from: pc.from,
            to: pc.to,
            cutLength,
            extra: own,
            startPhase,
            endPhase: R > 0 ? mod(startPhase + cutLength, R) : 0,
          });
        }
      }
    }
  }
  return { pieces, problems };
}

/** Identifies a piece across recalculations: room, wall, strip and the bottom of the piece (to the mm). */
export const pieceKey = (p: Pick<Piece, 'roomId' | 'wallIndex' | 'stripIndex' | 'from'>): string =>
  `${p.roomId}:${p.wallIndex}:${p.stripIndex}:${Math.round(p.from)}`;

/** Waste between a cut ending at phase `end` and the next one starting at phase `start`. */
export function gapBetween(end: number, start: number, repeat: number): number {
  return repeat > 0 ? mod(start - end, repeat) : 0;
}

/**
 * Where the pattern is at the very start of a roll: a phase (0 = the roll starts at the start of the pattern),
 * or null when it isn't known — then one repeat is set aside and the first cut can start anywhere (no gap).
 */
export type RollStart = number | null;

/** Paper cut off at the start of a roll before its first piece. */
export const firstGap = (piece: Piece, repeat: number, rollStart: RollStart): number =>
  rollStart === null ? 0 : gapBetween(rollStart, piece.startPhase, repeat);

/** Length used by pieces cut in this order, including the gaps (and the start of the roll if it is known). */
export function lengthUsed(order: number[], pieces: Piece[], repeat: number, rollStart: RollStart = null): number {
  let used = 0;
  for (let k = 0; k < order.length; k++) {
    const p = pieces[order[k]];
    used += k > 0 ? gapBetween(pieces[order[k - 1]].endPhase, p.startPhase, repeat) : firstGap(p, repeat, rollStart);
    used += p.cutLength;
  }
  return used;
}

/**
 * Where to insert `piece` into a roll's cutting order: every position is tried and the one with the smallest
 * length used wins (the latest on a tie, so pieces keep their order). `used` is the roll's current length used. O(number of pieces on the roll).
 */
export function insertionCost(
  order: number[],
  used: number,
  piece: number,
  pieces: Piece[],
  repeat: number,
  rollStart: RollStart = null,
): { pos: number; used: number } {
  const p = pieces[piece];
  const gap = (a: number, b: number) => gapBetween(pieces[a].endPhase, pieces[b].startPhase, repeat);
  const first = (i: number) => firstGap(pieces[i], repeat, rollStart);
  const k = order.length;
  let bestPos = 0;
  let bestUsed = Infinity;
  for (let pos = 0; pos <= k; pos++) {
    let u = used + p.cutLength;
    if (k === 0) u += first(piece);
    else if (pos === 0) u += first(piece) + gap(piece, order[0]) - first(order[0]);
    else if (pos === k) u += gap(order[k - 1], piece);
    else u += gap(order[pos - 1], piece) + gap(piece, order[pos]) - gap(order[pos - 1], order[pos]);
    if (u <= bestUsed + EPS) {
      // on a tie the later position wins, so pieces stay in strip order
      bestUsed = Math.min(u, bestUsed);
      bestPos = pos;
    }
  }
  return { pos: bestPos, used: bestUsed };
}

/** Try `piece` at every position in `order`; the best (smallest used, latest on a tie). */
export function bestInsertion(
  order: number[],
  piece: number,
  pieces: Piece[],
  repeat: number,
  rollStart: RollStart = null,
): { order: number[]; used: number } {
  const { pos, used } = insertionCost(order, lengthUsed(order, pieces, repeat, rollStart), piece, pieces, repeat, rollStart);
  return { order: [...order.slice(0, pos), piece, ...order.slice(pos)], used };
}

interface RollState {
  order: number[];
  used: number;
}

const insertInto = (roll: RollState, pos: number, piece: number, used: number): RollState => ({
  order: [...roll.order.slice(0, pos), piece, ...roll.order.slice(pos)],
  used,
});

/**
 * Greedy packing: each piece (in `sorted` order) goes on the roll where it adds the least waste; on a tie the
 * fullest roll, then the earliest. A new roll is opened when it fits nowhere.
 */
export function greedyRolls(sorted: number[], pieces: Piece[], usable: number, repeat: number, rollStart: RollStart = null): number[][] {
  const greedy: RollState[] = [];
  for (const i of sorted) {
    let bestRoll = -1;
    let bestPos = 0;
    let bestUsed = 0;
    let bestWaste = Infinity;
    greedy.forEach((roll, r) => {
      const fit = insertionCost(roll.order, roll.used, i, pieces, repeat, rollStart);
      if (fit.used > usable + EPS) return;
      const waste = fit.used - roll.used - pieces[i].cutLength;
      if (waste < bestWaste - EPS || (Math.abs(waste - bestWaste) <= EPS && fit.used > bestUsed + EPS)) {
        bestWaste = waste;
        bestRoll = r;
        bestPos = fit.pos;
        bestUsed = fit.used;
      }
    });
    if (bestRoll >= 0) greedy[bestRoll] = insertInto(greedy[bestRoll], bestPos, i, bestUsed);
    else greedy.push({ order: [i], used: pieces[i].cutLength + firstGap(pieces[i], repeat, rollStart) });
  }
  return greedy.map((r) => r.order);
}

/** Steps allowed per roll when filling rolls one at a time. */
const FILL_STEPS_PER_ROLL = 5_000;

/**
 * Fill rolls one at a time: each new roll starts with the longest piece left, then a small search picks the
 * combination of remaining pieces that leaves the least unused length on that roll. `sorted` = longest first.
 */
function fillRolls(sorted: number[], pieces: Piece[], usable: number, repeat: number, rollStart: RollStart): number[][] {
  const left = [...sorted];
  const result: number[][] = [];
  while (left.length > 0) {
    const first = left.shift()!;
    let bestRoll: RollState = { order: [first], used: pieces[first].cutLength + firstGap(pieces[first], repeat, rollStart) };
    let steps = 0;
    const grow = (roll: RollState, from: number) => {
      if (roll.used > bestRoll.used + EPS) bestRoll = roll;
      if (usable - bestRoll.used < EPS || ++steps > FILL_STEPS_PER_ROLL) return;
      const seen = new Set<string>();
      for (let j = from; j < left.length; j++) {
        const i = left[j];
        const p = pieces[i];
        if (roll.used + p.cutLength > usable + EPS) continue;
        const key = `${p.cutLength}|${p.startPhase.toFixed(1)}|${p.endPhase.toFixed(1)}`;
        if (seen.has(key)) continue; // an identical piece was already tried here
        seen.add(key);
        const fit = insertionCost(roll.order, roll.used, i, pieces, repeat, rollStart);
        if (fit.used > usable + EPS) continue;
        grow(insertInto(roll, fit.pos, i, fit.used), j + 1);
        if (usable - bestRoll.used < EPS || steps > FILL_STEPS_PER_ROLL) return;
      }
    };
    grow(bestRoll, 0);
    for (const i of bestRoll.order) {
      const at = left.indexOf(i);
      if (at >= 0) left.splice(at, 1);
    }
    result.push(bestRoll.order);
  }
  return result;
}

/**
 * Step 3: pack pieces into as few rolls as possible (greedy first answer, then a bounded depth-first search).
 * Returns the rolls as orders of piece indexes. Pieces longer than `usable` must be filtered out beforehand.
 */
export function packRolls(
  pieces: Piece[],
  usable: number,
  repeat: number,
  maxSteps = SEARCH_STEPS,
  rollStart: RollStart = null,
): number[][] {
  if (pieces.length === 0) return [];
  // Longest first; ties keep the collection order (room → wall → strip → height).
  const sorted = pieces.map((_, i) => i).sort((a, b) => pieces[b].cutLength - pieces[a].cutLength || a - b);
  const total = pieces.reduce((sum, p) => sum + p.cutLength, 0);
  const lowerBound = Math.ceil(total / usable - EPS);

  let best = greedyRolls(sorted, pieces, usable, repeat, rollStart);
  if (best.length <= lowerBound) return best;

  // Second first answer: fill one roll at a time as fully as possible (least slack), starting from the longest piece.
  const filled = fillRolls(sorted, pieces, usable, repeat, rollStart);
  if (filled.length < best.length) best = filled;
  if (best.length <= lowerBound) return best;

  // Depth-first search for fewer rolls.
  let steps = 0;
  const rolls: RollState[] = [];
  /** Rolls that look the same to the next piece (length used, first and last phase) are only tried once. */
  const signature = (roll: RollState) =>
    `${Math.round(roll.used)}|${pieces[roll.order[0]].startPhase.toFixed(1)}|${pieces[roll.order[roll.order.length - 1]].endPhase.toFixed(1)}|${roll.order.length}`;
  const search = (k: number): boolean => {
    if (++steps > maxSteps) return true; // out of budget: stop, keep the best so far
    if (Math.max(rolls.length, lowerBound) >= best.length) return false; // can't beat the best
    if (k === sorted.length) {
      best = rolls.map((r) => [...r.order]);
      return best.length <= lowerBound; // optimal: stop
    }
    const i = sorted[k];
    const tried = new Set<string>();
    for (let r = 0; r < rolls.length; r++) {
      const fit = insertionCost(rolls[r].order, rolls[r].used, i, pieces, repeat, rollStart);
      if (fit.used > usable + EPS) continue;
      const sig = signature(rolls[r]);
      if (tried.has(sig)) continue;
      tried.add(sig);
      const saved = rolls[r];
      rolls[r] = insertInto(saved, fit.pos, i, fit.used);
      const stop = search(k + 1);
      rolls[r] = saved;
      if (stop) return true;
    }
    rolls.push({ order: [i], used: pieces[i].cutLength + firstGap(pieces[i], repeat, rollStart) });
    const stop = search(k + 1);
    rolls.pop();
    return stop;
  };
  search(0);
  return best;
}

/** Rounds of moving / swapping pieces when gathering the spare paper (each round makes one improvement). */
const GATHER_ROUNDS = 500;

/** Rebuild a cutting order for a set of pieces by inserting them one by one (longest first) at the best position. */
function orderFor(set: number[], pieces: Piece[], repeat: number, rollStart: RollStart): RollState {
  const sorted = [...set].sort((a, b) => pieces[b].cutLength - pieces[a].cutLength || a - b);
  let roll: RollState = { order: [], used: 0 };
  for (const i of sorted) {
    const fit = insertionCost(roll.order, roll.used, i, pieces, repeat, rollStart);
    roll = insertInto(roll, fit.pos, i, fit.used);
  }
  return roll;
}

/**
 * Step 4: with the number of rolls fixed, gather the spare paper on one roll, so that what's left over is one long
 * piece (useful for an extra strip) rather than short ends on every roll.
 * Repeatedly takes the roll with the most spare paper and tries moving one of its pieces to another roll, or
 * swapping one of its pieces with one from another roll (each changed roll is re-ordered for the least waste). The change that makes the **largest leftover** biggest is kept, provided every
 * roll still fits; on a tie, the one that uses the least paper in total. Stops when nothing improves.
 */
export function gatherLeftover(
  orders: number[][],
  pieces: Piece[],
  usable: number,
  repeat: number,
  rollStart: RollStart = null,
): number[][] {
  if (orders.length < 2) return orders;
  let rolls: RollState[] = orders.map((o) => ({ order: [...o], used: lengthUsed(o, pieces, repeat, rollStart) }));
  const score = (rs: RollState[]) => ({
    largest: Math.max(...rs.map((r) => usable - r.used)),
    total: rs.reduce((sum, r) => sum + r.used, 0),
  });
  const better = (a: ReturnType<typeof score>, b: ReturnType<typeof score>) =>
    a.largest > b.largest + EPS || (Math.abs(a.largest - b.largest) <= EPS && a.total < b.total - EPS);

  for (let round = 0; round < GATHER_ROUNDS; round++) {
    let bestRolls: RollState[] | null = null;
    let bestScore = score(rolls);
    const consider = (a: number, newA: RollState, b: number, newB: RollState) => {
      if (newA.used > usable + EPS || newB.used > usable + EPS) return;
      if (newA.order.length === 0 || newB.order.length === 0) return; // never empty a roll here (that's packing's job)
      const next = rolls.map((r, i) => (i === a ? newA : i === b ? newB : r));
      const sc = score(next);
      if (better(sc, bestScore)) {
        bestScore = sc;
        bestRolls = next;
      }
    };
    // Only changes involving the roll with the most spare paper (the one being emptied) can make it bigger.
    const a = rolls.reduce((best, r, i) => (r.used < rolls[best].used - EPS ? i : best), 0);
    {
      for (let b = 0; b < rolls.length; b++) {
        if (a === b) continue;
        for (const p of rolls[a].order) {
          const restA = rolls[a].order.filter((x) => x !== p);
          // move p from the emptiest roll to roll b
          const fit = insertionCost(rolls[b].order, rolls[b].used, p, pieces, repeat, rollStart);
          consider(a, orderFor(restA, pieces, repeat, rollStart), b, insertInto(rolls[b], fit.pos, p, fit.used));
          // swap p (emptiest roll) with q (roll b)
          for (const q of rolls[b].order) {
            consider(
              a,
              orderFor([...restA, q], pieces, repeat, rollStart),
              b,
              orderFor([...rolls[b].order.filter((x) => x !== q), p], pieces, repeat, rollStart),
            );
          }
        }
      }
    }
    if (!bestRolls) break;
    rolls = bestRolls;
  }
  return rolls.map((r) => r.order);
}

/**
 * Follow an arrangement made by hand (rolls of piece keys) as closely as the current pieces allow:
 * - keys of pieces that no longer exist (or listed twice) are dropped;
 * - pieces the arrangement doesn't list (new, e.g. after changing a wall) are added where they add the least
 *   waste and still fit, else on a new roll;
 * - empty rolls are dropped.
 * Returns null when not a single key matches (then the plan is calculated automatically).
 */
export function applyManualPlan(
  plan: string[][],
  pieces: Piece[],
  usable: number,
  repeat: number,
  rollStart: RollStart = null,
): { orders: number[][]; dropped: number; added: number } | null {
  const index = new Map<string, number>();
  pieces.forEach((p, i) => {
    if (!index.has(pieceKey(p))) index.set(pieceKey(p), i);
  });
  const placed = new Set<number>();
  let dropped = 0;
  const rolls: RollState[] = [];
  for (const roll of plan) {
    const order: number[] = [];
    for (const key of roll) {
      const i = index.get(key);
      if (i === undefined || placed.has(i)) {
        dropped++;
        continue;
      }
      placed.add(i);
      order.push(i);
    }
    if (order.length > 0) rolls.push({ order, used: lengthUsed(order, pieces, repeat, rollStart) });
  }
  if (placed.size === 0) return null;
  const missing = pieces.map((_, i) => i).filter((i) => !placed.has(i));
  missing.sort((a, b) => pieces[b].cutLength - pieces[a].cutLength || a - b);
  for (const i of missing) {
    let best = -1;
    let bestFit = { pos: 0, used: 0 };
    let bestWaste = Infinity;
    rolls.forEach((roll, r) => {
      const fit = insertionCost(roll.order, roll.used, i, pieces, repeat, rollStart);
      if (fit.used > usable + EPS) return;
      const waste = fit.used - roll.used - pieces[i].cutLength;
      if (waste < bestWaste - EPS) {
        bestWaste = waste;
        best = r;
        bestFit = fit;
      }
    });
    if (best >= 0) rolls[best] = insertInto(rolls[best], bestFit.pos, i, bestFit.used);
    else rolls.push({ order: [i], used: pieces[i].cutLength + firstGap(pieces[i], repeat, rollStart) });
  }
  return { orders: rolls.map((r) => r.order), dropped, added: missing.length };
}

/** The full calculation for one wallpaper. */
export function calcWallpaper(project: Project, wallpaper: Wallpaper, maxSteps = SEARCH_STEPS): WallpaperResult {
  const repeat = isPatterned(wallpaper) ? wallpaper.patternRepeat : 0;
  // Known pattern start at the roll start: the whole roll is usable, the first cut lines up from phase 0.
  // Unknown: one repeat is set aside to line up the first cut.
  const rollStart: RollStart = repeat > 0 && wallpaper.rollStartsAtPattern ? 0 : null;
  const usableLength = Math.max(0, wallpaper.rollLength - (rollStart === null ? repeat : 0));
  const { pieces, problems } = collectPieces(project, wallpaper);

  const fits: number[] = [];
  pieces.forEach((p, i) => {
    if (p.cutLength + firstGap(p, repeat, rollStart) > usableLength + EPS) {
      const room = project.rooms.find((r) => r.id === p.roomId);
      problems.push(`${room?.name ?? 'Room'}, wall ${p.wallIndex + 1}, strip ${p.stripIndex + 1}: strip longer than a roll.`);
    } else {
      fits.push(i);
    }
  });
  const fitting = fits.map((i) => pieces[i]);
  // An arrangement made by hand is followed (as far as it still matches the pieces).
  const manualResult = wallpaper.manualPlan
    ? applyManualPlan(wallpaper.manualPlan, fitting, usableLength, repeat, rollStart)
    : null;
  // Otherwise: fewest rolls first, then gather the spare paper on one roll (one long leftover beats short ends).
  const orders =
    manualResult?.orders ??
    gatherLeftover(packRolls(fitting, usableLength, repeat, maxSteps, rollStart), fitting, usableLength, repeat, rollStart);
  const plan: Roll[] = orders.map((order) => ({
    cuts: order.map((j, k) => ({
      piece: fits[j],
      gapBefore: k === 0 ? firstGap(fitting[j], repeat, rollStart) : gapBetween(fitting[order[k - 1]].endPhase, fitting[j].startPhase, repeat),
    })),
    used: lengthUsed(order, fitting, repeat, rollStart),
    tooLong: lengthUsed(order, fitting, repeat, rollStart) > usableLength + EPS,
  }));
  plan.forEach((roll, r) => {
    if (roll.tooLong) problems.push(`Roll ${r + 1} is ${Math.round(roll.used - usableLength) / 10} cm too short for its pieces.`);
  });
  const paperUsed = plan.reduce((sum, r) => sum + r.used, 0);
  const area = project.wallpaperAssignments
    .filter((a) => a.wallpaperId === wallpaper.id)
    .reduce((sum, a) => sum + assignmentArea(project, a), 0);
  return {
    wallpaperId: wallpaper.id,
    manual: manualResult !== null,
    manualChanges: {
      dropped: manualResult?.dropped ?? 0,
      added: manualResult?.added ?? 0,
      outdated: wallpaper.manualPlan !== null && manualResult === null,
    },
    rolls: plan.length,
    cost: wallpaper.pricePerRoll === null ? null : plan.length * wallpaper.pricePerRoll,
    pieces,
    plan,
    usableLength,
    paperUsed,
    leftover: plan.length * usableLength - paperUsed,
    area,
    problems,
  };
}

/** Every wallpaper that is used on at least one wall. */
export function calcProject(project: Project, maxSteps = SEARCH_STEPS): ProjectResult {
  const used = project.wallpapers.filter((w) => project.wallpaperAssignments.some((a) => a.wallpaperId === w.id));
  const wallpapers = used.map((w) => calcWallpaper(project, w, maxSteps));
  return {
    wallpapers,
    totalCost: wallpapers.reduce((sum, r) => sum + (r.cost ?? 0), 0),
    unpriced: wallpapers.filter((r) => r.cost === null).map((r) => r.wallpaperId),
  };
}
