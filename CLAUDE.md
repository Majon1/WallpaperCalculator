# WallpaperCalculator

2D floor plan editor that calculates wallpaper and tile quantities. See [SPEC.md](SPEC.md) for the data model and rules.

## Stack
- React 19 + TypeScript, Vite, Zustand (state + undo/redo), plain SVG for the canvas
- Vitest for unit tests

## Commands
- `npm run dev` — start dev server
- `npm test` — run unit tests
- `npm run build` — typecheck + production build

## Structure
- `src/model/` — types, geometry, units, project validation. **Pure functions, no React or store imports.**
- `src/store/` — Zustand store: project, selection, tool, history, and `actions`
- `src/editor/` — UI: `Canvas` (SVG plan), `Toolbar`, `PropertiesPanel`, inputs
- `src/calc/` — wallpaper roll calculation (Part 3). Pure, fully unit tested, no UI imports. The UI reads it through `src/editor/useRolls.ts` (debounced + cached).

## Rules
- Store lengths in millimetres; show centimetres in the UI (areas in m²). Use `parseLength` / `formatLength` from `src/model/units.ts`.
- Any change to `src/model/` or `src/calc/` needs matching tests, and SPEC.md updated if behaviour changes.
- All project edits go through `actions` / `commit` so undo works. Drags: `beginGesture` once, then `updateLive`.
- UI code can be iterated freely; keep the data model stable (bump `Project.version` + migrate if it changes).
