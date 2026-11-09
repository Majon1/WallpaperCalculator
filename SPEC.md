# WallpaperCalculator — Specification

An app for drawing a 2D floor plan and calculating how much wallpaper and how many tiles are needed.

| Part | What | Approach |
|------|------|----------|
| 1 | Floor plan editor | Data model specified here; UI iterated freely |
| 2 | Material library | Fields specified; forms iterated freely |
| 3 | Calculation engine | Fully specified + unit tested |
| 4 | Output (shopping list, previews, export) | Iterated freely |

---

## Part 1 — Floor plan editor

### Units and coordinates
- All lengths are stored in **millimetres** (numbers, may be fractional). Areas in mm².
- The UI shows and accepts **centimetres** (`345`, `345,5`), to the nearest millimetre (`123.5 cm`). Inputs also accept explicit units: `345 cm`, `3450 mm`, `3.45 m`. A number without a unit means centimetres. Areas are shown in m².
- Plan coordinates: x to the right, y **downwards** (same as the screen).
- Room dimensions are **interior surface dimensions** — the surfaces that get wallpaper or tiles. Wall thickness is not modelled.

### Data model (`src/model/types.ts`)

```ts
Point    { x, y }                              // mm
Room     { id, name, points: Point[], wallHeight, cornerHeights: (number | null)[] }
Opening  { id, roomId, wallIndex, type, offset, width, height, sillHeight }
Project  { version: 7, name, currency, rooms, openings, wallpapers, wallpaperAssignments }
```

- **Room** is a closed polygon. `points` are its corners in order; wall *i* runs from `points[i]` to `points[(i + 1) % n]`. Either winding is allowed.
- A room is valid when it has ≥ 3 corners, no zero-length walls, area ≥ 0.01 m² and no walls that cross.
- `wallHeight` is the room's default ceiling height (default 2.50 m).
- `cornerHeights[j]` is the ceiling height at corner *j*, or `null` to use `wallHeight` (`cornerHeightOf`). One entry per corner.
- Wall *i* runs from the height at corner *i* to the height at corner *i + 1* (`wallEndHeights`); in between the ceiling is a straight line (`heightAlong`). If the two differ the wall is **sloped** and its gross area is a trapezoid (`wallGrossArea`). Because neighbouring walls share a corner, lowering one wall makes the walls beside it slope (a lean-to / attic ceiling). Ceilings that rise to a ridge in the middle of a wall are not modelled.
- Editing: the room's wall height sets every corner back to `null` (level room). A wall's "whole wall" height sets both its corners; "left end" / "right end" (as seen from inside) set one corner. A corner set to the room height is stored as `null`.
- Two rooms sharing a wall each have their own copy of it. This is intentional: each side of a wall is a separate surface to cover.
- **Opening** (door / window / cabinet / other) sits on one wall of one room. A **cabinet** is fixed furniture against the wall (kitchen units, wardrobes); like a door or window, no wallpaper goes behind it. On the plan it is drawn as a 0.60 m deep box (drawing only — depth is not stored).
  - `offset` — distance from the wall's start corner to the opening's near edge, measured along the wall.
  - `width`, `height` — size of the opening.
  - `sillHeight` — distance from the floor to the bottom of the opening (0 for doors).
  - Defaults: door 0.90 × 2.10 m, sill 0; window 1.20 × 1.20 m, sill 0.90 m; cabinet 0.60 × 2.10 m, sill 0 ("Up to ceiling" sets its height to reach the ceiling); other 0.60 × 0.60 m, sill 0.
- An opening **fits** when `offset ≥ 0`, `offset + width ≤ wall length`, `sillHeight + height ≤` the ceiling height everywhere across the opening's width (on a sloped wall, the lower of the ceiling heights at its two edges), and width/height > 0. Openings that don't fit are kept but shown in red with a warning; they will be excluded from calculations (Part 3 decides how).

### Derived values (`src/model/geometry.ts`, unit tested)
- Floor area: shoelace formula, absolute value.
- Perimeter: sum of wall lengths.
- Wall gross area: wall length × average of its two end heights.

### Editing rules
- **Draw room**: click corners; direction snaps to 45° steps and length to 10 cm (Shift = free angle, 1 cm). Snaps to existing corners. Type a length + Enter to place the next corner exactly. Finish by clicking the first corner or pressing Enter.
- **Rectangle room**: enter width × length.
- **Set wall length**: moves the wall's end corner *and the next corner* along the wall direction, so the following wall keeps its length and angle (a rectangle stays a rectangle).
- **Drag wall**: moves the wall perpendicular to itself; neighbouring walls stretch.
- **Drag corner / room / opening**: grid snap 10 cm (Shift: 1 cm). Openings slide along their wall.
- **Measurements**: when a wall or an opening is selected, a measurement chain is drawn along the inside of that wall: corner → opening → gap → opening → … → corner (`wallDimensionChain`). Openings are clamped to the wall and overlaps never produce negative gaps; zero gaps are omitted. The distances to the neighbours of the selected opening are highlighted.
- **Wall view** (elevation): clicking a wall opens a pane below the plan showing that wall head-on **as seen from inside the room** (`wallStartIsOnLeft` decides which corner is on the left). It shows the wall (length × height, with a sloped top if the ends differ), its openings to scale, the horizontal measurement chain, total length, wall height, and for each opening the vertical chain floor → bottom → top → ceiling (ceiling measured on the side the chain is drawn). A sloped wall shows both end heights. Openings can be dragged sideways (offset) and, except doors, up/down (sill height), in 1 cm steps, clamped to the wall. ‹ › step to the neighbouring walls.
- An opening's position can be entered either as distance from the wall start (`offset`) or distance to the wall end (`wall length − offset − width`).
- Edits that would make a room invalid are rejected.
- Undo/redo for every change; the project autosaves to the browser and can be exported/imported as JSON.

### Not in part 1 (later)
Adding/removing corners on an existing room, sloped ceilings (height changing along a wall), importing a background image.

---

## Part 2 — Material library

### Wallpaper (`Wallpaper` in `src/model/types.ts`)

| Field | Meaning | Default | Valid |
|---|---|---|---|
| `name` | Shown in lists | "Wallpaper N" | non-empty |
| `color` | Display colour on plan / wall view | from palette | hex |
| `rollWidth` | Width of one strip | 530 mm | > 0 (UI: 0.1–5 m) |
| `rollLength` | Length of paper on one roll | 10 050 mm | > 0 (UI: 1–100 m) |
| `patternRepeat` | Vertical distance before the pattern repeats | 0 | ≥ 0 |
| `match` | `free` / `straight` / `offset` (see below) | `free` | |
| `pricePerRoll` | In project currency; `null` = unknown | `null` | ≥ 0 |

Presets for roll size: 53 cm × 10.05 m (standard), 70 cm × 10.05 m, 106 cm × 10.05 m.

**Match types**
- `free` — no pattern to line up (plain, textured, random). `patternRepeat` is ignored.
- `straight` — the pattern continues at the same height on the next strip.
- `offset` — half-drop: every other strip is shifted down by half the repeat.

**Repeats per roll** (`repeatsPerRoll` in `src/model/wallpaper.ts`): shown in the wallpaper panel when the match isn't free and the repeat > 0 — the number of whole repeats on one roll, `floor(rollLength / patternRepeat)`, and the length left over. A remainder under 0.5 mm counts as an exact fit. E.g. 10.05 m roll, 64 cm repeat → 15 repeats, 45 cm left over.

**Wallpapered area** (`wallpaperedArea` / `assignmentArea` in `src/model/wallpaper.ts`): the wall area from `startHeight` up to the ceiling (a trapezoid, or a triangle where a sloped ceiling drops below the start height), minus every opening on that wall (doors, windows, cabinets, other). Each opening is clamped to the wall, to the part above `startHeight` and below the ceiling (the lower ceiling height across its width); overlapping openings are only taken off once. Shown in the wall view header, the wall panel ("With wallpaper"), the room panel (sum of its papered walls) and the wallpaper panel ("Used on": per room and total). It is a net area for information; the number of rolls (Part 3) also depends on strips, pattern and waste.

**Strip pieces** (`stripPlan` in `src/model/wallpaper.ts`): each strip of a papered wall (laid out from the left corner, as in the strip preview) runs from `startHeight` up to the ceiling at its higher edge. Where an opening or cabinet covers the strip's **whole width** (within 0.5 mm), that height range needs no paper: the strip is cut into a piece below and a piece above, and the length in between is *saved* (paper that can be used elsewhere). Covers that touch or overlap are merged; pieces and gaps under 0.5 mm are dropped. An object that covers only part of a strip's width saves nothing — the strip is hung full length and trimmed around it. Shown in the wall view (saved parts hatched with dashed cut lines; header "paper X, Y saved") and as a strip list in the wall panel. Each strip also lists its **cut-outs**: every opening or cabinet overlapping it, clipped to the strip and to `startHeight`…top (`full` when it covers the whole width). In the wall view, cut-outs of doors, windows and other openings that cover only part of a strip are drawn as dashed cut lines on that strip (only the edges inside the strip; strip edges and the paper's top/bottom aren't cuts), and the wall panel's strip list says "cut around door, window …". Whether a saved length can really be reused depends on pattern matching and on where it's needed; that is decided in Part 3.

How repeat and match affect quantities is defined in Part 3.

### Assigning wallpaper (`WallpaperAssignment`)
- `{ roomId, wallIndex, wallpaperId, startHeight }` — the wallpaper covers that wall from `startHeight` above the floor (default 0 = the floor; e.g. 1.20 m above tiles or panelling) **up to the ceiling**. At most one wallpaper per wall. A wall without an assignment gets no wallpaper.
- `startHeight` ≥ 0. It may be at or above the ceiling (e.g. after lowering a wall); then nothing is papered on that wall and the wall panel warns. Changing which wallpaper a wall has keeps its `startHeight`.
- The start height can be set per wall (wall panel, wall view header) or for all papered walls of a room (room panel; shown as "mixed" when they differ).
- Wallpaper can be set per wall (wall panel, wall view) or for all walls of a room at once (room panel).
- Deleting a wallpaper removes its assignments; deleting a room removes its assignments.
- **Strip preview** (wall view): a papered wall is divided into vertical strips of `rollWidth`, starting from the **left corner as seen from inside the room** (`stripLayout` in `src/model/wallpaper.ts`). Strips run from `startHeight` up to the ceiling; the start is drawn as a line with a height dimension on the left. Seams are drawn as dashed lines, strips are numbered, and a narrower last strip shows its width. The header shows the strip count. A remainder under 0.5 mm counts as an exact fit. (Which corner to start from may become a setting in Part 3.)
- **Pattern preview** (wall view): for `straight` and `offset` match with a repeat > 0, each strip shows where a pattern repeat starts (`patternStartHeights`). The pattern of strip 1 starts **at the bottom of the wallpaper** (`startHeight`; the floor by default) and repeats upwards every `patternRepeat`. Straight match: every strip the same. Offset (half-drop): every second strip (2, 4, …) is shifted up by half the repeat. Repeat starts at the ceiling (within 0.5 mm) are not shown. Under a sloped ceiling each strip runs up to its higher edge and the lines are clipped to the wall outline. Free match shows nothing. A "repeat" dimension is drawn on the right of the wall, from the bottom of the wallpaper.
- Not yet: wallpaper that stops below the ceiling (e.g. under a border or dado rail), feature walls with different wallpaper per section.

### Project changes (version 2)
- `Project` gains `currency` (default "€"), `wallpapers`, `wallpaperAssignments`.
- Version 1 projects (from localStorage or files) are migrated automatically: empty wallpaper lists and currency "€".
- Validation: assignments must reference an existing room, wall and wallpaper, and a wall can't be assigned twice.

### Project changes (version 4)
- `Room` gains `cornerHeights`. Version 2 projects are migrated with every entry `null` (level room); version 1 is migrated through version 2.
- Version 3 (short-lived: `wallHeights`, one flat height per wall) is migrated by giving both corners of each wall with its own height that height; where two such walls meet, the higher wins.
- Validation: `cornerHeights` has the same length as `points`; each entry is `null` or > 0.

### Project changes (version 5)
- `WallpaperAssignment` gains `startHeight`. Version 4 projects are migrated with `startHeight: 0` (wallpaper from the floor, as before); older versions migrate through version 4.
- Validation: `startHeight` is a number ≥ 0.

### Project changes (version 6)
- `WallpaperAssignment` gains `startInset` and `endInset`. Version 5 projects are migrated with both 0 (full width, as before); older versions migrate through version 5.
- Validation: both are numbers ≥ 0.

### Project changes (version 7)
- Opening type `cabinet` added.
- `startInset` / `endInset` are removed from `WallpaperAssignment` (they were an earlier way to leave a gap for cabinets). Version 6 projects are migrated by turning each gap ≥ 0.5 mm into a cabinet on that wall: at the wall's start / end, from the floor up to the ceiling (the lower ceiling height across its width on a sloped wall).

### Tiles
_To be specified._

## Part 3 — Calculation engine

Implemented in `src/calc/wallpaperRolls.ts` (pure, no UI imports), tests in `wallpaperRolls.test.ts`.

Goal: for every wallpaper in the project, how many rolls to buy and what they cost.

### Inputs
- The project: rooms, openings, wallpapers, wallpaper assignments.
- New project setting **`trimPerEnd`** — extra length added at *each* cut end of a piece, for trimming at the ceiling, floor, start height or an opening edge. Default **50 mm** (5 cm top + 5 cm bottom). Valid: 0–200 mm. Set in the project panel.
  - Data model change: `Project.trimPerEnd: number`, project **version 8**. Version 7 projects are migrated with `trimPerEnd: 50`.

### Step 1 — pieces
For each wallpaper assignment, `stripPlan` (Part 2) gives the strips of that wall, laid out from the left corner, and the **pieces** each strip needs: from the start height to the ceiling at the strip's higher edge, minus the parts that an opening or cabinet covers across the whole strip width.
- Openings that don't fit their wall (`openingProblems` not empty) are **ignored**, so paper is counted as if they weren't there. This errs on the side of buying enough.
- A narrower last strip still uses a full-width piece of the roll. The leftover width is not reused.
- A piece's **cut length** = piece length + 2 × `trimPerEnd`.

### Step 2 — where each piece sits in the pattern
Let R = `patternRepeat`. For **free match** (or R = 0) there is no pattern: skip to step 3, every gap is 0.

For **straight / offset match** every piece must show the pattern at the right height:
- The pattern of strip *i* has its origin at `startHeight`, or `startHeight + R/2` for odd *i* (0-based) with offset (half-drop) match, as in the pattern preview.
- A piece's **cut** runs from (piece bottom − trim) to (piece top + trim).
- Its **start phase** s = (cut bottom − origin) mod R and its **end phase** e = (s + cut length) mod R, both in [0, R). These say where in the repeat the cut starts and ends.

### Step 3 — cutting pieces from rolls
A roll is cut piece after piece, and the pattern runs on continuously along the roll. After a cut that ends at phase e, the next cut must start at its own phase s. The paper in between is waste: **gap** = (s − e) mod R. It is 0 when the next piece starts exactly where the last one ended in the pattern. For example, the top of another strip can start where the piece cut for below a window stopped.
- **Start of a roll**, for patterned paper. This depends on the wallpaper setting **`rollStartsAtPattern`** ("Rolls start at the start of the pattern", default off):
  - **Off** (not known where the pattern starts on a roll): one repeat is set aside to line up the first cut. Usable length = `rollLength − R`, and the first cut on a roll has no gap.
  - **On**: the pattern starts exactly at the roll start, which is phase 0. Usable length = `rollLength`, and the first cut has a gap of (s − 0) mod R, the paper up to its own start phase. Inserting a piece at the front of a roll changes that first gap, and this is included.
  - Free match: usable length = `rollLength`, no gaps.
- All pieces of the **same wallpaper**, across all walls and rooms, are cut from the same rolls. This is how leftovers and the paper saved behind doors, windows and cabinets get reused.
- **Goal: the fewest rolls** for each wallpaper, which is the lowest cost. Within one roll the pieces may be cut in any order. A roll's **length used** = sum of cut lengths + sum of gaps for its cutting order, and it must be ≤ the usable length.
- **Adding a piece to a roll:** try it at every position in the roll's current cutting order: before the first piece, between two pieces, or after the last. Keep the position with the smallest length used; on a tie, take the latest position, so pieces stay in strip order. The piece fits if that length is ≤ the usable length. Inserting can change the gaps of the pieces around it, and that is included.
- **Search**: pieces from different walls (e.g. a long strip from the high wall and short ones from under the slope) are combined so that as few rolls as possible are needed.
  1. Sort pieces by cut length, longest first. Ties go in room order → wall index → strip index → bottom height.
  2. **Starting answers.** Two quick answers are made, and the one with fewer rolls is kept (the greedy one on a tie):
     - **Greedy:** for each piece in that order, put it on the roll opened so far where it adds the least waste. On a tie, take the fullest roll, then the earliest. If it fits nowhere, open a new roll.
     - **Fill rolls one at a time:** start a roll with the longest piece left, then search (up to 5 000 steps per roll) for the combination of remaining pieces that leaves the least unused length on it. Identical pieces (same cut length and phases) are only tried once at each step.
  3. **Improve:** a depth-first search over the same order tries each piece on every opened roll where it fits, then on a new roll.
     - Rolls that look the same to the next piece are only tried once: same length used, same first start phase, same last end phase and same number of pieces.
     - A branch is dropped as soon as it can't beat the best answer so far. It needs at least *rolls opened so far* rolls, and at least ceil(total cut length of all pieces / usable length) rolls.
     - The search stops when it reaches that lower bound, or after 200 000 steps, and keeps the best answer found.
  4. Among answers with the same number of rolls, the first one found is kept, so the result is deterministic.
  5. **Balance** (`balanceRolls`): with the number of rolls fixed, spread the spare paper so that no roll is cut to the last centimetre. This leaves room for a mistake on every roll.
     - Repeatedly take the fullest roll, i.e. the one with the most length used.
     - Try moving one of its pieces to another roll, or swapping one of its pieces with one from another roll. The pieces on a changed roll are put back in order longest first, each at its best position.
     - Keep the change that makes the fullest roll least full, provided every roll still fits. When that stays the same, keep the one that makes the rolls more even: a smaller sum of the squared lengths used.
     - Stop when nothing improves, or after 500 rounds.
  - For free match all gaps are 0, so this is a bin-packing search.
- A piece whose cut length (plus its first gap, if the roll start is known) is greater than the usable roll length can't be cut. It is reported as a problem ("strip longer than a roll") and left out of the count.
- **No spare roll** is added.

### Output (per wallpaper)
- `rolls`: number of rolls needed.
- `cost`: rolls × `pricePerRoll`, or `null` if the price is unknown. Also a project total over wallpapers with a known price.
- `pieces`: count, and each piece with its wall, strip, height range and cut length, plus the **cutting plan**: for each roll, its pieces in cutting order with the gap cut off before each.
- `paperUsed`: sum of cut lengths and gaps. `leftover`: rolls × usable length − paperUsed.
- `area`: net wallpapered area (Part 2, `assignmentArea`), for reference.
- `problems`: pieces longer than a roll, and walls whose paper starts above the ceiling.
- **Shown in the UI:**
  - Wallpaper panel: "Rolls needed" with the count and cost, pieces, paper used, leftover, area, problems and a foldable cutting plan.
  - Wallpaper list: "N rolls · cost" per wallpaper.
  - Project panel: total rolls and cost, plus the `trimPerEnd` setting.
  - Wall view: each piece has a badge for the roll it is cut from (R1, R2, …), coloured per roll. Highlighting a roll (pointing at a badge, or at a roll bar in the wallpaper panel) outlines its pieces and lists them in cutting order: wall, strip, height range and cut length, the gaps cut off in between, and the length used and left over.
  - Wallpaper panel: the cutting plan is drawn as one bar per roll.
  - Bottom pane, **Rolls** view (switch "Wall / Rolls" when the wall has wallpaper): every roll of that wallpaper drawn unrolled, to scale lengthwise, **bottom = start of the roll** (the same way up as the strips on the wall). From the bottom up it shows the length set aside to line up the pattern, then each piece in cutting order (wall, strip, cut length; pieces of the selected wall in bold), the paper cut off in between, pattern repeat lines continuing along the roll, and what's left over. The drawing always puts a pattern start at the bottom of the roll. When the roll start isn't known, the first piece is drawn at its own pattern position above it, and the rest of the set-aside repeat at the top. **Cuts** are marked with a dashed line. Two pieces with nothing cut off between them share one cut; where paper is cut off there are two cuts, one on each side of it. Next to each piece of waste, "✂ length" says how much to cut off before the next piece starts, and a grey length at the bottom says how far up the roll the first piece starts.
  - The calculation runs 250 ms after editing stops, and results are cached per project version (`src/editor/useRolls.ts`).

### Worked examples (become unit tests)
Wallpaper 53 cm × 1005 cm, trim 5 cm per end, repeat R = 64 cm where patterned. Room 400 × 300 cm with all four walls papered and no openings: 28 strips (8 + 6 + 8 + 6).
- **Height 260 cm** (cut 270 cm):
  - Free match: 3 strips per roll (810 ≤ 1005) → **10 rolls**.
  - Straight: s = (−5) mod 64 = 59 and e = (59 + 270) mod 64 = 9, so the gap between strips is 50. One roll holds 270 + 320 + 320 = 910 ≤ 941 → 3 strips per roll → **10 rolls**. Rounding every strip up to whole repeats would have given 14.
  - Half-drop: even strips s = 59, odd strips s = 27. Alternating them gives gaps of 18 → still 3 per roll → **10 rolls**.
- **Height 300 cm** (cut 310 cm), straight: e = 49, so the gap between strips is 10. One roll holds 310 + 320 = 630, and a third strip doesn't fit (950 > 941) → 2 per roll → **14 rolls**, with 311 cm left over on each.
  - Add a **door** 90 × 210 cm covering strip 2 of wall 1 fully. That strip becomes one piece, 210–300, cut 205–305 = 100 cm, s = 205 mod 64 = 13. On a roll holding 2 strips (e = 49) its gap is (13 − 49) mod 64 = 28, and 630 + 28 + 100 = 758 ≤ 941. It fits a leftover, and the total drops to 27 full strips → **14 rolls** (13 rolls of 2, plus 1 roll with 1 strip and the door piece).
- **Mixing long and short strips** (a sloped ceiling), free match: cut lengths 400, 400, 300, 300, 300, 300 cm. Greedy puts 400 + 400 on one roll; the 300s fill a second roll with three, and the last one needs a third roll. Filling rolls one at a time (or the search) finds 400 + 300 + 300 = 1000 ≤ 1005 twice → **2 rolls**.
- **Rolls starting at the pattern**, height 292 cm, straight (cut 302 cm, s = 59, e = 41, gap 18 between strips). Three strips need 302 + 320 + 320 = 942 cm.
  - Setting off: usable 941 → 2 per roll → **14 rolls**.
  - Setting on: 59 to reach the first strip's phase + 942 = 1001 ≤ 1005 → 3 per roll → **10 rolls**.
- **Balancing:** free match, pieces 400, 300, 300 and 200 cm packed as [400 + 300 + 300 = 1000] and [200]. That leaves 5 cm on one roll and 805 cm on the other. Moving the 400 gives 600 and 600, so 405 cm is left on each, still with **2 rolls**.
- **Matching halves:** a piece below a window from 0–90 cm is cut −5–95 = 100 cm, from s = 59 to e = 31. A piece whose cut starts at phase 31, such as above an opening 228 cm high, follows it with **no gap**. A piece above a 210 cm door starts at 13, so 46 cm is lost between them.

### Project changes (version 9)
- `Wallpaper` gains `rollStartsAtPattern: boolean`. Version 8 projects are migrated with `false`, so the calculation is the same as before. New wallpapers default to `false`. The checkbox is shown when the match isn't free and the repeat > 0.

### Not in Part 3 (later)
Where the first strip starts (left / right / centred on a feature), tiles, reusing narrow leftover widths, joining two pieces to make one strip.

## Part 4 — Output
_To be specified._
