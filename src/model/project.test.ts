import { describe, expect, it } from 'vitest';
import { emptyProject, isProject, migrateProject, newWallpaper } from './project';
import type { Project } from './types';

const roomV2 = { id: 'r', name: 'R', wallHeight: 2500, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }] };
const room = { ...roomV2, cornerHeights: [null, 2000, 2000] };
const opening = { id: 'o', roomId: 'r', wallIndex: 0, type: 'door', offset: 0, width: 1, height: 1, sillHeight: 0 };
const wallpaper = newWallpaper('w', []);

const project = (patch: Partial<Record<keyof Project, unknown>> = {}) => ({
  ...emptyProject(),
  rooms: [room],
  openings: [opening],
  wallpapers: [wallpaper],
  wallpaperAssignments: [{ roomId: 'r', wallIndex: 1, wallpaperId: 'w', startHeight: 0 }],
  ...patch,
});

describe('isProject', () => {
  it('accepts valid projects', () => {
    expect(isProject(emptyProject())).toBe(true);
    expect(isProject(project())).toBe(true);
  });

  it('rejects junk and wrong versions', () => {
    expect(isProject(null)).toBe(false);
    expect(isProject({ ...emptyProject(), version: 1 })).toBe(false);
    expect(isProject({ ...emptyProject(), version: 2 })).toBe(false);
    expect(isProject(project({ rooms: [{ id: 'a' }] }))).toBe(false);
  });

  it('checks corner heights', () => {
    expect(isProject(project({ rooms: [roomV2] }))).toBe(false); // missing
    expect(isProject(project({ rooms: [{ ...room, cornerHeights: [null, null] }] }))).toBe(false); // wrong length
    expect(isProject(project({ rooms: [{ ...room, cornerHeights: [null, 0, null] }] }))).toBe(false);
    expect(isProject(project({ rooms: [{ ...room, cornerHeights: [null, 'x', null] }] }))).toBe(false);
    expect(isProject(project({ rooms: [{ ...room, cornerHeights: [null, null, null] }] }))).toBe(true);
  });

  it('checks whether rolls start at the pattern', () => {
    expect(isProject(project({ wallpapers: [{ ...wallpaper, rollStartsAtPattern: true }] }))).toBe(true);
    const { rollStartsAtPattern: _r, ...old } = wallpaper;
    expect(isProject(project({ wallpapers: [old] }))).toBe(false);
  });

  it('checks the trim allowance', () => {
    expect(isProject(project({ trimPerEnd: 0 }))).toBe(true);
    expect(isProject(project({ trimPerEnd: -1 }))).toBe(false);
    const { trimPerEnd: _t, ...noTrim } = project();
    expect(isProject(noTrim)).toBe(false);
  });

  it('accepts cabinets', () => {
    expect(isProject(project({ openings: [{ ...opening, type: 'cabinet' }] }))).toBe(true);
    expect(isProject(project({ openings: [{ ...opening, type: 'sofa' }] }))).toBe(false);
  });

  it('rejects openings that reference a missing room or wall', () => {
    expect(isProject(project({ openings: [{ ...opening, wallIndex: 3 }] }))).toBe(false);
    expect(isProject(project({ openings: [{ ...opening, roomId: 'x' }] }))).toBe(false);
  });

  it('rejects invalid wallpapers', () => {
    expect(isProject(project({ wallpapers: [{ ...wallpaper, rollWidth: 0 }] }))).toBe(false);
    expect(isProject(project({ wallpapers: [{ ...wallpaper, match: 'diagonal' }] }))).toBe(false);
    expect(isProject(project({ wallpapers: [{ ...wallpaper, pricePerRoll: -5 }] }))).toBe(false);
    expect(isProject(project({ wallpapers: [{ ...wallpaper, pricePerRoll: 24.9 }] }))).toBe(true);
  });

  it('rejects assignments to missing walls or wallpapers, and two wallpapers on one wall', () => {
    expect(isProject(project({ wallpaperAssignments: [{ roomId: 'r', wallIndex: 5, wallpaperId: 'w', startHeight: 0 }] }))).toBe(false);
    expect(isProject(project({ wallpaperAssignments: [{ roomId: 'r', wallIndex: 0, wallpaperId: 'x', startHeight: 0 }] }))).toBe(false);
    const twice = [
      { roomId: 'r', wallIndex: 0, wallpaperId: 'w', startHeight: 0 },
      { roomId: 'r', wallIndex: 0, wallpaperId: 'w', startHeight: 0 },
    ];
    expect(isProject(project({ wallpaperAssignments: twice }))).toBe(false);
  });

  it('checks where the wallpaper starts', () => {
    const a = { roomId: 'r', wallIndex: 0, wallpaperId: 'w', startHeight: 0 };
    expect(isProject(project({ wallpaperAssignments: [{ ...a, startHeight: 900 }] }))).toBe(true);
    expect(isProject(project({ wallpaperAssignments: [{ ...a, startHeight: -1 }] }))).toBe(false);
    const { startHeight: _h, ...noStart } = a;
    expect(isProject(project({ wallpaperAssignments: [noStart] }))).toBe(false);
  });

});

describe('migrateProject', () => {
  it('upgrades a version 1 project', () => {
    const v1 = { version: 1, name: 'Old', rooms: [roomV2], openings: [opening] };
    expect(migrateProject(v1)).toEqual({
      version: 9,
      name: 'Old',
      currency: '€',
      trimPerEnd: 50,
      rooms: [{ ...roomV2, cornerHeights: [null, null, null] }],
      openings: [opening],
      wallpapers: [],
      wallpaperAssignments: [],
    });
  });

  it('upgrades a version 2 project: every wall uses the room height', () => {
    const v2 = { ...project({ rooms: [roomV2] }), version: 2 };
    const p = migrateProject(v2);
    expect(p?.version).toBe(9);
    expect(p?.rooms[0].cornerHeights).toEqual([null, null, null]);
    expect(p?.wallpapers).toEqual([wallpaper]);
  });

  it('upgrades a version 3 project: a wall’s own height moves to both its corners', () => {
    const square = { ...roomV2, points: [...roomV2.points, { x: 0, y: 1000 }] };
    const v3 = { ...project({ rooms: [{ ...square, wallHeights: [null, 1800, null, 2000] }], wallpaperAssignments: [] }), version: 3 };
    const p = migrateProject(v3);
    expect(p?.version).toBe(9);
    // wall 1 = corners 1–2, wall 3 = corners 3–0
    expect(p?.rooms[0].cornerHeights).toEqual([2000, 1800, 1800, 2000]);
    expect(p?.rooms[0]).not.toHaveProperty('wallHeights');
  });

  it('upgrades a version 4 project: wallpaper starts at the floor', () => {
    const v4 = { ...project({ wallpaperAssignments: [{ roomId: 'r', wallIndex: 1, wallpaperId: 'w' }] }), version: 4 };
    const p = migrateProject(v4);
    expect(p?.version).toBe(9);
    expect(p?.wallpaperAssignments).toEqual([{ roomId: 'r', wallIndex: 1, wallpaperId: 'w', startHeight: 0 }]);
    expect(p?.rooms).toEqual([room]);
  });

  it('upgrades a version 8 project: rolls not known to start at the pattern', () => {
    const { rollStartsAtPattern: _r, ...old } = wallpaper;
    const p = migrateProject({ ...project({ wallpapers: [old] }), version: 8 });
    expect(p?.version).toBe(9);
    expect(p?.wallpapers).toEqual([{ ...old, rollStartsAtPattern: false }]);
  });

  it('upgrades a version 7 project: trim allowance 5 cm per end', () => {
    const { trimPerEnd: _t, ...v7 } = { ...project(), version: 7 };
    const p = migrateProject(v7);
    expect(p?.version).toBe(9);
    expect(p?.trimPerEnd).toBe(50);
    expect(p?.rooms).toEqual([room]);
  });

  it('upgrades a version 6 project: gaps at the wall ends become cabinets', () => {
    const square = { ...roomV2, points: [...roomV2.points, { x: 0, y: 1000 }], cornerHeights: [null, 2000, null, null] };
    const v6 = {
      ...project({
        rooms: [square],
        wallpaperAssignments: [
          { roomId: 'r', wallIndex: 0, wallpaperId: 'w', startHeight: 0, startInset: 200, endInset: 300 },
          { roomId: 'r', wallIndex: 2, wallpaperId: 'w', startHeight: 0, startInset: 0, endInset: 0 },
        ],
      }),
      version: 6,
    };
    const p = migrateProject(v6);
    expect(p?.version).toBe(9);
    expect(p?.wallpaperAssignments).toEqual([
      { roomId: 'r', wallIndex: 0, wallpaperId: 'w', startHeight: 0 },
      { roomId: 'r', wallIndex: 2, wallpaperId: 'w', startHeight: 0 },
    ]);
    // wall 0 is 1 m long and slopes from 2.5 m to 2.0 m; each cabinet reaches the ceiling at its lower edge
    const cabinets = p!.openings.filter((o) => o.type === 'cabinet');
    expect(cabinets).toEqual([
      { id: expect.any(String), roomId: 'r', wallIndex: 0, type: 'cabinet', offset: 0, width: 200, height: 2400, sillHeight: 0 },
      { id: expect.any(String), roomId: 'r', wallIndex: 0, type: 'cabinet', offset: 700, width: 300, height: 2000, sillHeight: 0 },
    ]);
    expect(p!.openings).toContainEqual(opening);
  });

  it('upgrades a version 5 project: wallpaper covers the full width', () => {
    const v5 = { ...project({ wallpaperAssignments: [{ roomId: 'r', wallIndex: 1, wallpaperId: 'w', startHeight: 900 }] }), version: 5 };
    const p = migrateProject(v5);
    expect(p?.version).toBe(9);
    expect(p?.wallpaperAssignments).toEqual([{ roomId: 'r', wallIndex: 1, wallpaperId: 'w', startHeight: 900 }]);
    expect(p?.openings).toEqual([opening]);
  });

  it('passes current projects through and rejects junk', () => {
    const p = project();
    expect(migrateProject(p)).toEqual(p);
    expect(migrateProject({ version: 1, name: 'x' })).toBeNull();
    expect(migrateProject('nope')).toBeNull();
  });
});
