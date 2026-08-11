# Text Region computation: icon-grid topology + pretext-driven adaptive layout

Text Regions are computed from the desktop's icon grid topology in two passes: (1) a **topology pass** that derives a stable candidate partition from icon cells (treating icon placement as a hint for column proportions, not just an obstacle to avoid), and (2) an **adaptive pass** where `@chenglou/pretext` lays out article text into the candidate regions and the layout is iterated until both readability and aesthetic constraints are satisfied. When icons move, the pipeline re-runs end-to-end — there is no special-case "icon drag" handler, only a recompute.

## Why

The user's directive: "make it maximally adaptive AND visually pleasing; if an icon sits at the 40/60 split of an empty area, the columns probably should split 40/60; when icons move, reflow using pretext's method." This elevates icons from "obstacles to avoid" to "topological hints that suggest column proportions". The result is layouts that feel organically aligned with the user's desktop rather than fighting it.

Three forces the algorithm must balance:
1. **Adaptivity** — handle dense, sparse, scattered, clustered icon layouts uniformly.
2. **Aesthetics** — page margins, column proportions, whitespace ratio must read as intentional, not "whatever was left over".
3. **Pretext reuse** — `@chenglou/pretext`'s core skill is measuring text and laying it out around image regions; we feed icon cells as the "image" and let pretext place text, rather than reimplementing a custom packer.

## Algorithm (two-pass)

### Pass 1 — Topology → Candidate Regions

1. **Acquire icon grid cell size** via `SystemParametersInfoW(SPI_GETICONMETRICS)` (cellW × cellH, DPI-scaled). Fallback: infer from the bounding-box deltas of detected icon rects.
2. **Build occupancy grid** M×N over the work area (screen minus taskbar): each cell `occupied` (≥1 icon rect intersects) or `empty`.
3. **Vertical column projection** — for each column x, compute `occupancyRate(x) = occupiedCells / M`. A column is `free` if `occupancyRate == 0` (fully empty top-to-bottom); `sparse` if `< sparseThreshold` (e.g. 0.15, 1-2 stray icons); `blocked` otherwise.
4. **Group adjacent free/sparse columns** into runs. A run becomes a Candidate Region if:
   - width ≥ `minRegionWidth` (e.g. `5 × cellW`, configurable), AND
   - the run's `sparseRate` (sparse columns / total) ≤ `sparseTolerance` (e.g. 0.3) — i.e. the run is mostly free.
5. **Proportional splitting inside a Candidate Region**:
   - If the region contains a single dominant sparse-column cluster (e.g. an icon column at 40% of the region's width), split the region at that cluster's position — the icon **becomes** the divider, producing two sub-columns whose proportions match the icon's relative position.
   - If multiple sparse clusters exist, split at each → multi-column region.
   - If no sparse clusters, the region is a single column.
   - This realizes the user's "四六开 icon → 四六开 columns" rule: the icon's x-position within the region determines the split ratio.
6. **Stray-icon padding inside a column** — for each sparse column inside a region, pad text with `paddingY` (e.g. `0.5 × cellH`) above and below the icon cell, so text appears to "wrap" around it.
7. **Page-margin enforcement** — every Candidate Region's outer edges are inset by `pageMargin` (e.g. `2 × cellW` from screen edges; `1 × cellW` between adjacent regions). The inset is applied after splitting, so margins don't distort proportions.
8. **Y-extent** — each region spans top-margin to bottom-margin of the work area by default; sparse-padding carves holes, not truncations.

Output: a list of `CandidateRegion { rects: Rect[], columnRatio: number[] }` where `rects` are the padded text-placement areas and `columnRatio` describes the proportional split for pretext.

### Pass 2 — Pretext adaptive layout

9. **Feed candidate regions to `@chenglou/pretext`** as the available bounds, plus the article's plain text segmented into paragraphs. Pretext measures text and proposes line breaks per region.
10. **Iterate until constraints satisfied**:
    - Per-line contrast against the solid background ≥ WCAG 4.5:1 (always satisfiable on solid color, but checked).
    - No line crosses an icon-padding boundary.
    - Column-fill balance: if region A fills 3 lines and region B fills 8, re-balance by widening B's column ratio ±10% and retry (max 3 iterations).
    - Whitespace ratio: total text area / total region area ∈ [0.35, 0.65]; if outside, adjust font size ±1px or column proportions and retry.
11. **Article scroll length** — the laid-out text has a total height; the visible viewport (Y-extent of current Text Regions) shows a window. Pet vertical position drives the viewport's Y offset. Text overflowing the viewport is rendered off-screen and revealed by scroll.
12. **Recompute on icon movement** — when `get_desktop_icon_rects` returns a different snapshot, Pass 1 + Pass 2 re-run; the scroll offset is preserved relative to the article (text content doesn't jump, only its visible window shifts).

## Degradation ladder

- **No icons detected / non-Windows**: single Text Region = full work area minus page margins; default 2-column split per pretext.
- **Heavy icon load (≤1 region ≥ `minRegionWidth`)**: single-column mode, narrowest acceptable region.
- **No region ≥ `minRegionWidth`**: zero Text Regions. Solid background only; pet still walks; article scroll paused (no visible text to advance). Tray/editor surfaces a notice.

## Aesthetics rules (non-negotiable, baked into constants)

- `pageMargin` ≥ 2× cellW from work-area edges; never less than 96px at 100% DPI.
- Inter-region gap ≥ 1× cellW.
- Column ratio splits preserve user-icon-suggested proportions but round to "aesthetically stable" ratios (1:1, 3:2, 2:3, 3:1, 1:3, 4:6, 6:4) when within ±5% of the icon-implied ratio. Prevents ugly 47:53 splits.
- Minimum column width ≥ `12 × fontSize`, so text doesn't narrow into a column of one character per line.
- Font size range [18px, 36px], auto-selected by Pass 2's whitespace-ratio loop.

## Considered options

- **Pixel-column scan** (A, original proposal) — too granular, icons shatter channels.
- **Arbitrary 100px horizontal bands** (D, original proposal) — bands and icons don't align, alignment heuristics fragile.
- **Maximal-inscribed-rectangle (OpenCV-style)** — finds one rect, can't express multi-column or proportional split.
- **Icon-grid topology + pretext adaptive** (accepted) — icons become topological hints; pretext owns text measurement; aesthetics enforced via constants + iteration.

## Consequences

- New module (working name `packages/layout-region/`) owns Pass 1: input `(iconRects[], workArea)` → output `CandidateRegion[]`. Pure function, fully testable with synthetic icon layouts.
- `packages/pretext-layout/` retains and extends its role: Pass 2 lives here, calling `@chenglou/pretext` with `CandidateRegion[]` bounds and receiving laid-out lines.
- `CONTEXT.md` `Text Region` definition refined to match this algorithm; new term `Candidate Region` (pre-padding-and-split intermediate) added if useful — but try to keep the language flat (single `Text Region` concept with sub-rects).
- The pet's Y position no longer maps 1:1 to scroll pixels; it maps to scroll progress (0..1 of total laid-out article height). The mapping is linear within the article; rewind (double-click) decreases progress.
- ADR-0021 stays in force (UI Automation feeds icon rects to this algorithm).
- `packages/attention` still deleted (ADR-0019) — this is unrelated to saliency.
- Aesthetic constants (`pageMargin`, `minRegionWidth`, `sparseThreshold`, `sparseTolerance`, ratio snapping set, font range) live in one config file for tuning.
