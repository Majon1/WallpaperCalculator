import { useEffect, useState } from 'react';
import { calcProject, type ProjectResult, type WallpaperResult } from '../calc/wallpaperRolls';
import type { Id, Project } from '../model/types';
import { useEditor } from '../store/editorStore';

/** One calculation per project version (projects are immutable, so the object identifies the version). */
const cache = new WeakMap<Project, ProjectResult>();

function calc(project: Project): ProjectResult {
  let result = cache.get(project);
  if (!result) {
    result = calcProject(project);
    cache.set(project, result);
  }
  return result;
}

/** Wait this long after the last edit before calculating (the roll search can take a moment). */
const DELAY_MS = 250;

/**
 * Rolls and costs for the project (SPEC Part 3). Recalculated shortly after editing stops, so dragging
 * stays smooth; `pending` is true while the shown result is out of date.
 */
export function useRolls(): { result: ProjectResult | null; pending: boolean } {
  const project = useEditor((s) => s.project);
  const [shown, setShown] = useState<{ project: Project; result: ProjectResult } | null>(() =>
    cache.has(project) ? { project, result: cache.get(project)! } : null,
  );
  useEffect(() => {
    if (cache.has(project)) {
      setShown({ project, result: cache.get(project)! });
      return;
    }
    const timer = setTimeout(() => setShown({ project, result: calc(project) }), DELAY_MS);
    return () => clearTimeout(timer);
  }, [project]);
  return { result: shown?.result ?? null, pending: shown?.project !== project };
}

export function useWallpaperRolls(wallpaperId: Id): { result: WallpaperResult | null; pending: boolean } {
  const { result, pending } = useRolls();
  return { result: result?.wallpapers.find((w) => w.wallpaperId === wallpaperId) ?? null, pending };
}
