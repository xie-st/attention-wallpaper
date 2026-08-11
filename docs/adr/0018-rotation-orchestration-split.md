# Rotation-orchestration split: planRotationSet in content-model, composeSet in src/lib/rotation.ts

The rotation-orchestration tier (deepened per `docs/architecture-refactor.md` Candidates 1+3) splits into two modules at two seams:

- **`planRotationSet(articles, passages, now, monitorCount): { articleId, placements: (Passage|null)[] }`** lives in `packages/content-model/`. It is pure selection logic — no IO, no rendering, no Tauri. It replaces the current `selectForRotation` whose interface was nearly as wide as its body and whose `alreadyChosenIds`/`slotsRemaining` plumbing expressed a constraint ADR-0016 makes irrelevant. Content-model already owns selection; this is a shape fix, not a relocation.
- **`composeSet(monitors, articles, passages, now): Promise<(CompositeOutput|null)[]>`** lives in a new file `src/lib/rotation.ts`, sibling to `src/lib/compositor.ts`. It is the cross-package orchestrator: calls `planRotationSet`, then for each non-null placement runs `analyze` (attention) → `proposeLayout` (attention) → `composite` (compositor.ts) → `canvasToPng`. Returns `null` for surplus monitors (ADR-0016 under-fill clause).

`src/lib/compositor.ts` keeps its per-monitor `composite()` — it's earning its keep there — but drops its inline `selectForRotation` call and its inline `.filter(enabled)` eligibility pre-filter. Selection and eligibility both move behind content-model's interface.

## Why

Candidates 1+3 are coupled: the selection Interface (#1) and the multi-monitor orchestration (#3) are the same seam viewed from two sides. The current code has `composite()` doing both per-monitor render *and* (degenerately) selection — interface too wide, seam one level too low. Splitting selection to content-model (its existing domain) and orchestration to a new sibling file keeps each module deep: content-model owns "which Article + which Passages" as a pure function with a tiny test surface; `rotation.ts` owns "render the chosen set across N monitors" as an orchestrator that doesn't reimplement selection.

## Considered options

- **planRotationSet in content-model + composeSet in new src/lib/rotation.ts** (accepted) — selection in its domain home, orchestration as a sibling; both modules deep.
- **Both in compositor.ts** (A, rejected) — makes `composite()` interface wider on both axes; contradicts the deepening goal.
- **Both in new src/lib/rotation.ts** (C, rejected) — selection logic脱离s content-model's domain; future Rust-side selection (if needed) can't align.

## Consequences

- New file `src/lib/rotation.ts` with `composeSet` + its helpers.
- `packages/content-model/src/index.ts` exports `planRotationSet` (replacing `selectForRotation`/`selectForMonitor`/`scoreItem` with a two-stage Article→Passage picker, per ADR-0016).
- `planRotationSet` returns `{articleId, placements: Passage[]}` — array length ≤ monitorCount (only filled slots). Selection layer answers "which Article + which Passages", not "which monitor is empty". `composeSet` consumes `placements` index-aligned to monitors; surplus monitors (index ≥ `placements.length`) get `null` output → keep previous wallpaper per ADR-0016 under-fill clause.
- `src/lib/compositor.ts` `composite()` loses its `selectForRotation` call + inline `.filter(enabled)` (Candidate 8 resolves here too); it now receives already-chosen Passages.
- `CONTEXT.md` gains the `Rotation Set` term.
- WallpaperSection / tray 下一组 / launch-flush all call `composeSet`, not `composite` × N.
