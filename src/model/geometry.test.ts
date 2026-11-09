import { describe, expect, it } from 'vitest';
import {
  centroid,
  getWalls,
  isSelfIntersecting,
  offsetWall,
  openingProblems,
  outwardNormal,
  perimeter,
  pointAlong,
  polygonArea,
  roomError,
  setWallLength,
  snapDirection,
  snapToGrid,
  wallDimensionChain,
  wallStartIsOnLeft,
  cornerHeightOf,
  heightAlong,
  wallEndHeights,
  wallGrossArea,
} from './geometry';
import type { Opening, Point, Room } from './types';

// 4 m × 3 m, clockwise on screen (y down)
const rect: Point[] = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 0, y: 3000 },
];
const rectCCW = [...rect].reverse();

// L-shape: 4×4 with a 2×2 corner removed → 12 m²
const lShape: Point[] = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 2000 },
  { x: 2000, y: 2000 },
  { x: 2000, y: 4000 },
  { x: 0, y: 4000 },
];

const room = (points: Point[]): Room => ({ id: 'r', name: 'R', points, wallHeight: 2500, cornerHeights: points.map(() => null) });

describe('area and perimeter', () => {
  it('computes rectangle area regardless of winding', () => {
    expect(polygonArea(rect)).toBe(12_000_000);
    expect(polygonArea(rectCCW)).toBe(12_000_000);
  });

  it('computes L-shape area', () => {
    expect(polygonArea(lShape)).toBe(12_000_000);
  });

  it('computes perimeter', () => {
    expect(perimeter(rect)).toBe(14_000);
    expect(perimeter(lShape)).toBe(16_000);
  });

  it('computes centroid', () => {
    expect(centroid(rect)).toEqual({ x: 2000, y: 1500 });
  });
});

describe('walls', () => {
  it('derives one wall per edge, closing back to the first corner', () => {
    const walls = getWalls(room(rect));
    expect(walls.map((w) => w.length)).toEqual([4000, 3000, 4000, 3000]);
    expect(walls[3].start).toEqual({ x: 0, y: 3000 });
    expect(walls[3].end).toEqual({ x: 0, y: 0 });
  });

  it('outward normal points away from the room for both windings', () => {
    expect(outwardNormal(rect, 0)).toEqual({ x: 0, y: -1 }); // top wall → up
    expect(outwardNormal(rect, 1)).toEqual({ x: 1, y: 0 }); // right wall → right
    // rectCCW[0] → rectCCW[1] is the bottom wall going right → outward is down
    expect(outwardNormal(rectCCW, 0)).toEqual({ x: 0, y: 1 });
    // rectCCW[3] → rectCCW[0] is the left wall going down → outward is left
    expect(outwardNormal(rectCCW, 3)).toEqual({ x: -1, y: 0 });
  });
});

describe('wallStartIsOnLeft', () => {
  it('puts the start corner on the left for clockwise rooms', () => {
    // top wall (0,0)→(4000,0): facing north from inside, west (x=0) is on the left
    expect(wallStartIsOnLeft(rect, 0)).toBe(true);
    // right wall (4000,0)→(4000,3000): facing east, north (y=0) is on the left
    expect(wallStartIsOnLeft(rect, 1)).toBe(true);
  });

  it('puts the start corner on the right for counter-clockwise rooms', () => {
    // bottom wall (0,3000)→(4000,3000): facing south, east (x=4000) is on the left
    expect(wallStartIsOnLeft(rectCCW, 0)).toBe(false);
  });
});

describe('setWallLength', () => {
  it('keeps a rectangle rectangular', () => {
    const result = setWallLength(rect, 0, 5000);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      { x: 5000, y: 3000 },
      { x: 0, y: 3000 },
    ]);
  });

  it('can shorten a wall', () => {
    const result = setWallLength(rect, 1, 2500);
    expect(getWalls(room(result)).map((w) => w.length)).toEqual([4000, 2500, 4000, 2500]);
  });

  it('wraps around for the last wall', () => {
    // wall 3 runs from (0,3000) up to (0,0); lengthening moves (0,0) and (4000,0) upwards
    const result = setWallLength(rect, 3, 3500);
    expect(result[0]).toEqual({ x: 0, y: -500 });
    expect(result[1]).toEqual({ x: 4000, y: -500 });
    expect(result[2]).toEqual(rect[2]);
  });

  it('keeps an L-shape intact', () => {
    const result = setWallLength(lShape, 0, 5000);
    expect(polygonArea(result)).toBe(14_000_000);
    expect(roomError(result)).toBeNull();
  });
});

describe('offsetWall', () => {
  it('moves both corners of the wall', () => {
    const result = offsetWall(rect, 1, { x: 1000, y: 0 });
    expect(polygonArea(result)).toBe(15_000_000);
  });
});

describe('validation', () => {
  it('detects crossing walls', () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 1000, y: 1000 },
      { x: 1000, y: 0 },
      { x: 0, y: 1000 },
    ];
    expect(isSelfIntersecting(bowtie)).toBe(true);
    expect(isSelfIntersecting(rect)).toBe(false);
    expect(isSelfIntersecting(lShape)).toBe(false);
    expect(roomError(bowtie)).toBe('Walls cross each other.');
  });

  it('rejects too few corners, duplicate corners and tiny rooms', () => {
    expect(roomError(rect.slice(0, 2))).toMatch(/at least 3/);
    expect(roomError([rect[0], rect[0], rect[1], rect[2]])).toMatch(/on top of each other/);
    expect(roomError([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }])).toMatch(/too small/);
    expect(roomError(rect)).toBeNull();
  });
});

describe('openingProblems', () => {
  const door: Opening = {
    id: 'o',
    roomId: 'r',
    wallIndex: 0,
    type: 'door',
    offset: 500,
    width: 900,
    height: 2100,
    sillHeight: 0,
  };

  it('accepts an opening that fits', () => {
    expect(openingProblems(door, 4000, 2500)).toEqual([]);
  });

  it('flags openings past the wall end or above the ceiling', () => {
    expect(openingProblems({ ...door, offset: 3500 }, 4000, 2500)).toEqual(['Extends past the end of the wall.']);
    expect(openingProblems({ ...door, sillHeight: 500 }, 4000, 2500)).toEqual(['Reaches above the ceiling.']);
  });

  it('checks against a sloped ceiling across the whole opening width', () => {
    // Ceiling 2.0 m at the start rising to 3.0 m at the end of a 4 m wall; door spans 0.5–1.4 m → ceiling 2.125–2.35 m.
    expect(openingProblems(door, 4000, 2000, 3000)).toEqual([]);
    expect(openingProblems({ ...door, height: 2200 }, 4000, 2000, 3000)).toEqual(['Reaches above the ceiling.']);
    expect(openingProblems({ ...door, height: 2200, offset: 3000 }, 4000, 2000, 3000)).toEqual([]);
  });
});

describe('wallDimensionChain', () => {
  it('measures a wall without openings as one gap', () => {
    expect(wallDimensionChain(4000, [])).toEqual([{ from: 0, to: 4000, kind: 'gap' }]);
  });

  it('measures corner → opening → gap → opening → corner, sorted by position', () => {
    const chain = wallDimensionChain(5000, [
      { id: 'b', offset: 3000, width: 1200 },
      { id: 'a', offset: 500, width: 900 },
    ]);
    expect(chain).toEqual([
      { from: 0, to: 500, kind: 'gap' },
      { from: 500, to: 1400, kind: 'opening', openingId: 'a' },
      { from: 1400, to: 3000, kind: 'gap' },
      { from: 3000, to: 4200, kind: 'opening', openingId: 'b' },
      { from: 4200, to: 5000, kind: 'gap' },
    ]);
  });

  it('omits zero gaps when an opening touches a corner', () => {
    expect(wallDimensionChain(2000, [{ id: 'a', offset: 0, width: 900 }])).toEqual([
      { from: 0, to: 900, kind: 'opening', openingId: 'a' },
      { from: 900, to: 2000, kind: 'gap' },
    ]);
  });

  it('clamps openings past the wall end and handles overlaps', () => {
    expect(
      wallDimensionChain(3000, [
        { id: 'a', offset: 1000, width: 1000 },
        { id: 'b', offset: 1500, width: 2000 },
      ]),
    ).toEqual([
      { from: 0, to: 1000, kind: 'gap' },
      { from: 1000, to: 2000, kind: 'opening', openingId: 'a' },
      { from: 2000, to: 3000, kind: 'opening', openingId: 'b' },
    ]);
  });
});

describe('snapping', () => {
  it('snaps to grid', () => {
    expect(snapToGrid({ x: 149, y: -151 }, 100)).toEqual({ x: 100, y: -200 });
  });

  it('snaps direction to 45° steps and length to the step', () => {
    expect(snapDirection({ x: 0, y: 0 }, { x: 1020, y: 80 }, 45, 100)).toEqual({ x: 1000, y: 0 });
    expect(snapDirection({ x: 0, y: 0 }, { x: 30, y: -2480 }, 45, 100)).toEqual({ x: 0, y: -2500 });
    const diag = snapDirection({ x: 0, y: 0 }, { x: 980, y: 1020 }, 45, 100);
    expect(diag.x).toBeCloseTo(989.95, 2);
    expect(diag.y).toBeCloseTo(989.95, 2);
  });

  it('places a point at an exact distance', () => {
    expect(pointAlong({ x: 100, y: 100 }, { x: 100, y: 5000 }, 3450)).toEqual({ x: 100, y: 3550 });
  });
});

describe('heights', () => {
  const r = { ...room([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }]), cornerHeights: [null, 1800, 1800, null] };

  it('uses the room height unless the corner has its own', () => {
    expect(cornerHeightOf(r, 0)).toBe(2500);
    expect(cornerHeightOf(r, 1)).toBe(1800);
  });

  it('gives each wall the heights of its two corners — neighbours of a low wall slope', () => {
    expect(wallEndHeights(r, 0)).toEqual({ start: 2500, end: 1800 }); // slopes down
    expect(wallEndHeights(r, 1)).toEqual({ start: 1800, end: 1800 }); // the low wall
    expect(wallEndHeights(r, 2)).toEqual({ start: 1800, end: 2500 }); // slopes up
    expect(wallEndHeights(r, 3)).toEqual({ start: 2500, end: 2500 }); // wraps to corner 0
  });

  it('interpolates along the wall and clamps to its ends', () => {
    const h = { start: 2000, end: 3000 };
    expect(heightAlong(h, 4000, 0)).toBe(2000);
    expect(heightAlong(h, 4000, 1000)).toBe(2250);
    expect(heightAlong(h, 4000, 5000)).toBe(3000);
    expect(heightAlong(h, 4000, -10)).toBe(2000);
    expect(heightAlong(h, 0, 0)).toBe(2000);
  });

  it('computes trapezoid area', () => {
    expect(wallGrossArea(4000, { start: 2000, end: 3000 })).toBe(10_000_000);
    expect(wallGrossArea(4000, { start: 2500, end: 2500 })).toBe(10_000_000);
  });
});
