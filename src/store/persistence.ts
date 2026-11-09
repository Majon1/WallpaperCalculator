import { migrateProject } from '../model/project';
import type { Project } from '../model/types';

const STORAGE_KEY = 'floorplan:project:v1';

export function loadSavedProject(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return migrateProject(data);
  } catch {
    return null;
  }
}

export function saveProject(project: Project): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // Storage full or unavailable — nothing sensible to do; export still works.
  }
}

export function downloadProject(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.trim().replace(/[^\w\- ]+/g, '') || 'wallpaper-calculator'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readProjectFile(file: File): Promise<Project> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const project = migrateProject(data);
  if (!project) throw new Error('This file is not a WallpaperCalculator project.');
  return project;
}
