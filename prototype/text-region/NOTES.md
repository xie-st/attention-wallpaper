# Text Region prototype — NOTES

## Question

Does the ADR-0022 Text Region algorithm produce sensible column partitions across realistic icon-layout scenarios (empty, icons-left, sparse strays, dense cluster, 40/60 split)?

## Answer

**Yes — with one critical fix found and applied.**

### Original bug

`findDominantSparseCluster` was scanning the **full run** (including page-margin columns) for sparse clusters. In scenario 5 (icons at col 0-1 + col 14), the leftmost sparse pair (col 0-1) won as the "dominant cluster" because length-2 > length-1, producing a wrong 10/90 split instead of the expected 60/40.

### Fix

`findDominantSparseCluster` is now called with `insetCols = run.cols.slice(margin, margin + w)` — so edge columns excluded by the page margin don't poison the split ratio. The cluster center is computed over the inset region directly, becoming the split ratio (clamped to [0.1, 0.9], snapped to aesthetic ratios).

### Validated behaviors

| Scenario | Result | Expected? |
|----------|--------|-----------|
| Empty (full-screen) | 1 region 21×12, ratio 1:1 | ✅ default 2-col |
| Icons-left dense | 1 region x=8 w=15, ratio 1:1 | ✅ right-side 2-col |
| Sparse strays (left + 2 right-area strays) | 1 region, ratio 2:3, strayCells=2 | ✅ strays detected + split follows stray position |
| Very dense cluster | 0 regions | ✅ degradation to no-text mode |
| 40/60 split (icon at 40% of right area) | 1 region, ratio 3:2 (=60/40) | ✅ icon position becomes split ratio |

### What the prototype taught us

1. **Edge columns matter** — without the inset fix, sparse-edge icons contaminate the dominant cluster. Margin-aware cluster detection is essential.
2. **Ratio snapping is meaningful** — snapping to [1:1, 3:2, 2:3, 3:1, 1:3, 4:6, 6:4, ...] within ±5% tolerance produces aesthetic ratios; raw 0.595 → 0.6 looks intentional, raw 0.47 → 1:1 looks deliberate.
3. **Degradation is honest** — scenario 4 (208 icons in 25×16 grid) cleanly returns 0 regions rather than a token narrow strip. Solid-background-only mode is the right fallback.
4. **Stray detection fires correctly** — scenario 3 and 5 both surface strayCells so Pass 2 (pretext) knows where to pad.

### What to lift into the real codebase

The pure functions in `prototype/text-region/index.ts`:
- `buildOccupancyGrid`
- `columnOccupancyRate` + `classifyColumn`
- `groupColumns`
- `findDominantSparseCluster` (with the inset fix)
- `snapRatio`
- `computeTextRegions` (orchestrator)
- `DEFAULT_CONFIG` (tuning constants)

These can move into a future `packages/layout-region/` module unchanged. The TUI shell (`render`, `_main`, scenarios) is throwaway.

## Run

```bash
pnpm proto:text-region           # interactive TUI
pnpm proto:text-region all       # print all 5 scenarios
pnpm proto:text-region 3         # print scenario 3
```
