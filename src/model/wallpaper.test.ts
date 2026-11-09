import { describe, expect, it } from 'vitest';
import { emptyProject } from './project';
import {
  assignmentArea,
  patternStartHeights,
  rangeLength,
  repeatsPerRoll,
  stripLayout,
  stripPlan,
  wallpaperedArea,
} from './wallpaper';

describe('stripLayout', () => {
  it('divides a 4 m wall into 0.53 m strips with a narrow last strip', () => {
    const layout = stripLayout(4000, 530);
    expect(layout.count).toBe(8); // 7 × 530 = 3710, remainder 290
    expect(layout.seams).toEqual([530, 1060, 1590, 2120, 2650, 3180, 3710]);
    expect(layout.lastWidth).toBe(290);
  });

  it('has no extra sliver when the strips fit exactly', () => {
    expect(stripLayout(1060, 530)).toEqual({ seams: [530], count: 2, lastWidth: 530 });
    expect(stripLayout(1060.3, 530).count).toBe(2);
  });

  it('uses one strip for walls narrower than a roll', () => {
    expect(stripLayout(400, 530)).toEqual({ seams: [], count: 1, lastWidth: 400 });
  });

  it('returns nothing for invalid sizes', () => {
    expect(stripLayout(0, 530).count).toBe(0);
    expect(stripLayout(4000, 0).count).toBe(0);
  });
});

describe('patternStartHeights', () => {
  it('starts the pattern at the floor and repeats upwards (straight match)', () => {
    expect(patternStartHeights(2600, 640, 'straight', 0)).toEqual([0, 640, 1280, 1920, 2560]);
    expect(patternStartHeights(2600, 640, 'straight', 1)).toEqual([0, 640, 1280, 1920, 2560]);
  });

  it('shifts every second strip by half the repeat (offset match)', () => {
    expect(patternStartHeights(2600, 640, 'offset', 0)).toEqual([0, 640, 1280, 1920, 2560]);
    expect(patternStartHeights(2600, 640, 'offset', 1)).toEqual([320, 960, 1600, 2240]);
    expect(patternStartHeights(2600, 640, 'offset', 2)).toEqual([0, 640, 1280, 1920, 2560]);
  });

  it('does not place a repeat exactly at the ceiling', () => {
    expect(patternStartHeights(2560, 640, 'straight', 0)).toEqual([0, 640, 1280, 1920]);
  });

  it('has nothing to show for free match or no repeat', () => {
    expect(patternStartHeights(2600, 640, 'free', 0)).toEqual([]);
    expect(patternStartHeights(2600, 0, 'straight', 0)).toEqual([]);
  });

  it('shows only the floor start when the repeat is taller than the wall', () => {
    expect(patternStartHeights(2500, 3000, 'straight', 0)).toEqual([0]);
  });
});

describe('repeatsPerRoll', () => {
  it('counts whole repeats and the leftover', () => {
    expect(repeatsPerRoll(10_050, 640)).toEqual({ count: 15, leftover: 450 });
    expect(repeatsPerRoll(10_050, 530)).toEqual({ count: 18, leftover: 510 });
  });

  it('treats a remainder under 0.5 mm as an exact fit', () => {
    expect(repeatsPerRoll(10_000, 500)).toEqual({ count: 20, leftover: 0 });
    expect(repeatsPerRoll(9_999.7, 500)).toEqual({ count: 20, leftover: 0 });
  });

  it('handles a repeat longer than the roll', () => {
    expect(repeatsPerRoll(1000, 1500)).toEqual({ count: 0, leftover: 1000 });
  });

  it('returns null without a repeat', () => {
    expect(repeatsPerRoll(10_050, 0)).toBeNull();
  });
});

describe('wallpaperedArea', () => {
  const level = { start: 2500, end: 2500 };
  const box = (offset: number, width: number, sillHeight: number, height: number) => ({ offset, width, sillHeight, height });

  it('is the whole wall without openings', () => {
    expect(wallpaperedArea(4000, level, 0, [])).toBe(10_000_000);
  });

  it('takes off openings', () => {
    // 4 x 2.5 m wall, door 0.9 x 2.1 m, window 1.2 x 1.2 m
    expect(wallpaperedArea(4000, level, 0, [box(300, 900, 0, 2100), box(2000, 1200, 900, 1200)])).toBe(
      10_000_000 - 1_890_000 - 1_440_000,
    );
  });

  it('starts at the start height and only takes off the part of an opening above it', () => {
    // Paper from 1.0 m: 4 x 1.5 m. A 2.1 m door reaches 1.1 m into the paper.
    expect(wallpaperedArea(4000, level, 1000, [])).toBe(6_000_000);
    expect(wallpaperedArea(4000, level, 1000, [box(300, 900, 0, 2100)])).toBe(6_000_000 - 900 * 1100);
    expect(wallpaperedArea(4000, level, 1000, [box(300, 900, 0, 800)])).toBe(6_000_000); // fully below the paper
  });

  it('counts overlapping openings once', () => {
    const a = box(0, 1000, 0, 1000);
    expect(wallpaperedArea(4000, level, 0, [a, a])).toBe(10_000_000 - 1_000_000);
    // two 1 x 1 m boxes overlapping by 0.5 x 0.5 m
    expect(wallpaperedArea(4000, level, 0, [a, box(500, 1000, 500, 1000)])).toBe(10_000_000 - 1_750_000);
  });

  it('clamps openings to the wall and the ceiling', () => {
    expect(wallpaperedArea(4000, level, 0, [box(3500, 1000, 2000, 1000)])).toBe(10_000_000 - 500 * 500);
  });

  it('handles a sloped ceiling, also when it drops below the start height', () => {
    const sloped = { start: 2000, end: 3000 };
    expect(wallpaperedArea(4000, sloped, 0, [])).toBe(10_000_000);
    expect(wallpaperedArea(4000, sloped, 1000, [])).toBe(6_000_000);
    // Paper from 2.5 m: only where the ceiling is above 2.5 m, a triangle 2 m long and 0.5 m high.
    expect(wallpaperedArea(4000, sloped, 2500, [])).toBe(500_000);
    expect(wallpaperedArea(4000, sloped, 3000, [])).toBe(0);
  });

  it('is 0 for a zero-length wall', () => {
    expect(wallpaperedArea(0, level, 0, [])).toBe(0);
  });
});

describe('assignmentArea', () => {
  it('uses the wall, its heights and its openings', () => {
    const project = {
      ...emptyProject(),
      rooms: [
        {
          id: 'r',
          name: 'R',
          wallHeight: 2500,
          cornerHeights: [null, null, null, null],
          points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }],
        },
      ],
      openings: [
        { id: 'd', roomId: 'r', wallIndex: 0, type: 'door' as const, offset: 0, width: 1000, height: 2000, sillHeight: 0 },
        { id: 'x', roomId: 'r', wallIndex: 1, type: 'window' as const, offset: 0, width: 1000, height: 1000, sillHeight: 1000 },
      ],
    };
    expect(assignmentArea(project, { roomId: 'r', wallIndex: 0, wallpaperId: 'w', startHeight: 0 })).toBe(8_000_000);
    // wall 1 is 3 m: paper from 0.5 m = 3 x 2 m, minus the 1 x 1 m window
    expect(assignmentArea(project, { roomId: 'r', wallIndex: 1, wallpaperId: 'w', startHeight: 500 })).toBe(5_000_000);
    expect(assignmentArea(project, { roomId: 'r', wallIndex: 9, wallpaperId: 'w', startHeight: 0 })).toBe(0);
  });
});

describe('stripPlan', () => {
  const level = { start: 2500, end: 2500 };
  const box = (offset: number, width: number, sillHeight: number, height: number) => ({ offset, width, sillHeight, height });

  it('gives every strip one piece from the start height to the ceiling', () => {
    const plan = stripPlan(1500, level, true, 0, 530, []);
    expect(plan.map((s) => [s.left, s.right])).toEqual([
      [0, 530],
      [530, 1060],
      [1060, 1500],
    ]);
    expect(plan.every((s) => s.pieces.length === 1 && s.pieces[0].from === 0 && s.pieces[0].to === 2500)).toBe(true);
    expect(plan.every((s) => s.saved.length === 0)).toBe(true);
  });

  it('cuts a strip that is fully covered in the middle into a piece below and a piece above', () => {
    // Window 0.9–2.1 m high covering strip 2 (530–1060) completely, and strip 1 only partly.
    const plan = stripPlan(2000, level, true, 0, 530, [box(400, 800, 900, 1200)]);
    expect(plan[1].pieces).toEqual([
      { from: 0, to: 900 },
      { from: 2100, to: 2500 },
    ]);
    expect(plan[1].saved).toEqual([{ from: 900, to: 2100 }]);
    expect(plan[0].saved).toEqual([]); // only partly covered: full length needed
    expect(plan[2].saved).toEqual([]); // 1060–2000, window ends at 1200
  });

  it('saves the part behind a counter or cabinet', () => {
    // Floor cabinet 0–0.9 m along the whole 1.06 m wall: both strips only need the part above it.
    const plan = stripPlan(1060, level, true, 0, 530, [box(0, 1060, 0, 900)]);
    expect(plan.map((s) => s.pieces)).toEqual([[{ from: 900, to: 2500 }], [{ from: 900, to: 2500 }]]);
    expect(rangeLength(plan[0].saved)).toBe(900);
  });

  it('merges touching or overlapping covers and respects the start height', () => {
    const plan = stripPlan(530, level, true, 1000, 530, [box(0, 530, 0, 1500), box(0, 530, 1500, 300)]);
    expect(plan[0].saved).toEqual([{ from: 1000, to: 1800 }]);
    expect(plan[0].pieces).toEqual([{ from: 1800, to: 2500 }]);
  });

  it('measures from the left corner: openings are mirrored when the wall start is on the right', () => {
    // Opening at the wall start (offset 0) is at the right end when the start is on the right.
    const plan = stripPlan(1060, level, false, 0, 530, [box(0, 530, 0, 2500)]);
    expect(plan[0].pieces).toHaveLength(1);
    expect(plan[1].pieces).toEqual([]);
    expect(plan[1].saved).toEqual([{ from: 0, to: 2500 }]);
  });

  it('runs each strip up to the ceiling at its higher edge', () => {
    const plan = stripPlan(1000, { start: 2000, end: 3000 }, true, 0, 500, []);
    expect(plan.map((s) => s.top)).toEqual([2500, 3000]);
  });
});

describe('stripPlan cut-outs', () => {
  const level = { start: 2500, end: 2500 };
  const box = (offset: number, width: number, sillHeight: number, height: number) => ({ offset, width, sillHeight, height });

  it('lists the part of each opening on each strip, clipped to the strip', () => {
    // Window 40–120 cm across, 90–210 cm high. Strips 0–53, 53–106, 106–150.
    const plan = stripPlan(1500, level, true, 0, 530, [box(400, 800, 900, 1200)]);
    expect(plan[0].cutouts).toEqual([{ opening: 0, left: 400, right: 530, from: 900, to: 2100, full: false }]);
    expect(plan[1].cutouts).toEqual([{ opening: 0, left: 530, right: 1060, from: 900, to: 2100, full: true }]);
    expect(plan[2].cutouts).toEqual([{ opening: 0, left: 1060, right: 1200, from: 900, to: 2100, full: false }]);
  });

  it('clips cut-outs to the start height and leaves out openings below the paper', () => {
    const plan = stripPlan(530, level, true, 1000, 530, [box(100, 200, 0, 2100), box(100, 200, 0, 800)]);
    expect(plan[0].cutouts).toEqual([{ opening: 0, left: 100, right: 300, from: 1000, to: 2100, full: false }]);
  });

  it('mirrors openings when the wall start is on the right', () => {
    const plan = stripPlan(1060, level, false, 0, 530, [box(100, 200, 0, 2000)]);
    // offset 10–30 cm from the start = 76–96 cm from the left corner, on strip 2
    expect(plan[0].cutouts).toEqual([]);
    expect(plan[1].cutouts).toEqual([{ opening: 0, left: 760, right: 960, from: 0, to: 2000, full: false }]);
  });
});
