/**
 * PROTOTYPE — THROWAWAY
 *
 * Question: Does the ADR-0022 Text Region algorithm produce sensible column
 * partitions across realistic icon-layout scenarios?
 *
 * Specifically validating:
 *  1. Empty desktop → full-screen multi-column with page margins
 *  2. Icons on the left → right-side columns
 *  3. Sparse stray icons inside an otherwise-empty region → padding around them
 *  4. Dense icon cluster → degradation to a narrow single column
 *  5. "40/60 split icon" → does the column ratio actually snap to 40/60?
 *
 * The logic module (computeTextRegions) is the bit that may survive into the
 * real codebase. The TUI shell around it is throwaway.
 *
 * Run: pnpm proto:text-region         (interactive TUI)
 *      pnpm proto:text-region all     (print all 5 scenarios)
 *      pnpm proto:text-region 3       (print scenario 3 only)
 *
 * Exports are exposed for debug scripts to import without triggering the TUI.
 */

// ----- Types -------------------------------------------------------------

export interface GridRect {
  /** Grid cell coordinates (top-left origin). */
  gx: number;
  gy: number;
  gw: number;
  gh: number;
}

export interface ScreenSpec {
  /** Grid dimensions in cells. */
  colsM: number;
  rowsN: number;
}

export interface TextRegion {
  /** In grid-cell units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Proportional split inside the region; e.g. [0.4, 0.6] = two columns 40/60. */
  columnRatio: number[];
  /** Sparse icon cells inside the region (padding targets). */
  strayCells: GridRect[];
}

// ----- Algorithm (the part that may survive) -----------------------------

interface Config {
  minRegionWidthCells: number;   // min width to qualify as a text region
  sparseThreshold: number;       // column occupancy rate ≤ this = "sparse"
  sparseTolerance: number;       // max sparse-column rate inside a candidate region
  pageMarginCells: number;       // inset from screen edges
  interRegionGapCells: number;   // gap between adjacent regions
  strayPaddingCells: number;     // padding above/below a stray icon inside a column
  /** Ratios we snap to when within ±snapTolerance of an icon-implied split. */
  snapRatios: number[][];
  snapTolerance: number;
}

export const DEFAULT_CONFIG: Config = {
  minRegionWidthCells: 5,
  sparseThreshold: 0.15,
  sparseTolerance: 0.3,
  pageMarginCells: 2,
  interRegionGapCells: 1,
  strayPaddingCells: 1,
  snapRatios: [[1, 1], [3, 2], [2, 3], [3, 1], [1, 3], [4, 6], [6, 4], [2, 1], [1, 2]],
  snapTolerance: 0.05,
};

/**
 * Build an M×N occupancy grid from icon rects.
 * Returns `occupied[x][y]` (true = icon present).
 */
export function buildOccupancyGrid(screen: ScreenSpec, icons: GridRect[]): boolean[][] {
  const grid: boolean[][] = Array.from({ length: screen.colsM }, () =>
    Array.from({ length: screen.rowsN }, () => false)
  );
  for (const icon of icons) {
    for (let x = icon.gx; x < icon.gx + icon.gw && x < screen.colsM; x++) {
      for (let y = icon.gy; y < icon.gy + icon.gh && y < screen.rowsN; y++) {
        if (x >= 0 && y >= 0) grid[x][y] = true;
      }
    }
  }
  return grid;
}

/**
 * Per-column occupancy rate.
 */
export function columnOccupancyRate(grid: boolean[][], x: number, rowsN: number): number {
  let occ = 0;
  for (let y = 0; y < rowsN; y++) if (grid[x][y]) occ++;
  return occ / rowsN;
}

type ColumnKind = "free" | "sparse" | "blocked";

export function classifyColumn(rate: number, cfg: Config): ColumnKind {
  if (rate === 0) return "free";
  if (rate <= cfg.sparseThreshold) return "sparse";
  return "blocked";
}

/**
 * Group adjacent free/sparse columns into runs. A run starts at a free column
 * and extends through adjacent free or sparse columns. Blocked columns break.
 */
export function groupColumns(
  screen: ScreenSpec,
  grid: boolean[][],
  cfg: Config
): { start: number; end: number; cols: ColumnKind[] }[] {
  const runs: { start: number; end: number; cols: ColumnKind[] }[] = [];
  let i = 0;
  while (i < screen.colsM) {
    const rate = columnOccupancyRate(grid, i, screen.rowsN);
    const kind = classifyColumn(rate, cfg);
    if (kind === "blocked") {
      i++;
      continue;
    }
    // Start a run
    const start = i;
    const cols: ColumnKind[] = [];
    while (i < screen.colsM) {
      const r = columnOccupancyRate(grid, i, screen.rowsN);
      const k = classifyColumn(r, cfg);
      if (k === "blocked") break;
      cols.push(k);
      i++;
    }
    runs.push({ start, end: i - 1, cols });
  }
  return runs;
}

/** Find the longest run of sparse columns inside a region; returns its relative center [0..1]. */
export function findDominantSparseCluster(
  cols: ColumnKind[]
): { center: number; count: number } | null {
  let bestStart = -1;
  let bestLen = 0;
  let i = 0;
  while (i < cols.length) {
    if (cols[i] !== "sparse") {
      i++;
      continue;
    }
    const start = i;
    while (i < cols.length && cols[i] === "sparse") i++;
    const len = i - start;
    if (len > bestLen) {
      bestLen = len;
      bestStart = start;
    }
  }
  if (bestStart === -1) return null;
  return { center: (bestStart + bestLen / 2) / cols.length, count: bestLen };
}

function snapRatio(ration: number, cfg: Config): number[] {
  for (const r of cfg.snapRatios) {
    const value = r[0] / (r[0] + r[1]);
    if (Math.abs(ration - value) <= cfg.snapTolerance) return r;
  }
  // Default: round to nearest 5% and produce a 2-element ratio
  const rounded = Math.round(ration * 20) / 20;
  return [rounded, 1 - rounded];
}

/**
 * Collect sparse icon cells that fall inside a region's x-range (in grid coords).
 */
function collectStrayCells(
  screen: ScreenSpec,
  grid: boolean[][],
  region: { x: number; y: number; w: number; h: number },
  cfg: Config
): GridRect[] {
  const strays: GridRect[] = [];
  for (let x = region.x; x < region.x + region.w; x++) {
    for (let y = region.y; y < region.y + region.h; y++) {
      if (!grid[x][y]) continue;
      // Check if this cell is "stray" — i.e. its column is classified sparse
      const rate = columnOccupancyRate(grid, x, screen.rowsN);
      if (classifyColumn(rate, cfg) === "sparse") {
        strays.push({ gx: x, gy: y, gw: 1, gh: 1 });
      }
    }
  }
  return strays;
}

export function computeTextRegions(
  screen: ScreenSpec,
  icons: GridRect[],
  cfg: Config = DEFAULT_CONFIG
): TextRegion[] {
  const grid = buildOccupancyGrid(screen, icons);
  const runs = groupColumns(screen, grid, cfg);
  const regions: TextRegion[] = [];

  for (const run of runs) {
    const width = run.end - run.start + 1;
    if (width < cfg.minRegionWidthCells) continue;

    const sparseCount = run.cols.filter((c) => c === "sparse").length;
    const sparseRate = sparseCount / run.cols.length;
    if (sparseRate > cfg.sparseTolerance) continue;

    // Apply page margin inset (X axis only — Y span is full work area)
    const margin = cfg.pageMarginCells;
    let x = run.start + margin;
    let w = width - 2 * margin;
    if (w < cfg.minRegionWidthCells) continue;

    const y = margin;
    const h = screen.rowsN - 2 * margin;

    // Find dominant sparse cluster INSIDE the inset region (not the full run).
    // Margin columns are excluded so edge icons (e.g. a few icons in col 0-1
    // when the page margin already excludes those) don't poison the split ratio.
    const insetCols = run.cols.slice(margin, margin + w);
    const cluster = findDominantSparseCluster(insetCols);
    let columnRatio: number[];
    if (cluster && cluster.count >= 1) {
      // cluster.center is in [0..1] over the inset region — that IS the split ratio
      const clamped = Math.max(0.1, Math.min(0.9, cluster.center));
      columnRatio = snapRatio(clamped, cfg);
    } else {
      // Default: 2 equal columns when region is wide enough
      columnRatio = w >= 10 ? [1, 1] : [1];
    }

    const strays = collectStrayCells(screen, grid, { x, y, w, h }, cfg);

    regions.push({ x, y, w, h, columnRatio, strayCells: strays });
  }

  // Inter-region gap enforcement: regions already separated by blocked columns
  // are naturally gapped; adjacent regions (rare) shrink by interRegionGapCells.
  // (For simplicity in the prototype we trust the natural separation.)
  return regions;
}

// ----- Scenarios ----------------------------------------------------------

function makeEmpty(screen: ScreenSpec): { icons: GridRect[]; label: string } {
  return { icons: [], label: "Empty desktop (full-screen columns)" };
}

function makeIconsLeft(screen: ScreenSpec): { icons: GridRect[]; label: string } {
  const icons: GridRect[] = [];
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 12; y++) {
      icons.push({ gx: x, gy: y, gw: 1, gh: 1 });
    }
  }
  return { icons, label: "Icons densely on the left half (right-side columns)" };
}

function makeSparseStray(screen: ScreenSpec): { icons: GridRect[]; label: string } {
  // Some icons on the left + 2 strays in the right area
  const icons: GridRect[] = [
    { gx: 0, gy: 0, gw: 1, gh: 1 },
    { gx: 0, gy: 1, gw: 1, gh: 1 },
    { gx: 1, gy: 0, gw: 1, gh: 1 },
    { gx: 1, gy: 1, gw: 1, gh: 1 },
    { gx: 10, gy: 6, gw: 1, gh: 1 }, // stray
    { gx: 18, gy: 12, gw: 1, gh: 1 }, // stray
  ];
  return { icons, label: "Some icons left + 2 strays in the right area (padding test)" };
}

function makeDenseCluster(screen: ScreenSpec): { icons: GridRect[]; label: string } {
  const icons: GridRect[] = [];
  // Fill cols 0..20 with ~half the rows occupied randomly (deterministic)
  for (let x = 0; x < 20; x++) {
    for (let y = 0; y < screen.rowsN; y++) {
      if ((x * 7 + y * 3) % 3 !== 0) icons.push({ gx: x, gy: y, gw: 1, gh: 1 });
    }
  }
  return { icons, label: "Dense icon cluster on the left 2/3 (degradation test)" };
}

function makeFourSixSplit(screen: ScreenSpec): { icons: GridRect[]; label: string } {
  // Right-side area is empty EXCEPT one icon column at ~40% of the right area
  // Right area is cols 6..24 (width 19). 40% of 19 ≈ col 14. Put a single-icon
  // column at gx=14, gy=5..6.
  const icons: GridRect[] = [
    { gx: 0, gy: 0, gw: 1, gh: 1 },
    { gx: 0, gy: 1, gw: 1, gh: 1 },
    { gx: 1, gy: 0, gw: 1, gh: 1 },
    { gx: 1, gy: 1, gw: 1, gh: 1 },
    { gx: 14, gy: 5, gw: 1, gh: 1 },
    { gx: 14, gy: 6,gw: 1, gh: 1 },
  ];
  return { icons, label: "Right area with one icon column at ~40% (四六开 split test)" };
}

const SCENARIOS = [makeEmpty, makeIconsLeft, makeSparseStray, makeDenseCluster, makeFourSixSplit];

// ----- TUI ----------------------------------------------------------------

const screen: ScreenSpec = { colsM: 25, rowsN: 16 };

let currentScenario = 0;
let currentIcons: GridRect[] = [];
let currentRegions: TextRegion[] = [];
let label = "";

function recompute(): void {
  const s = SCENARIOS[currentScenario](screen);
  currentIcons = s.icons;
  label = s.label;
  currentRegions = computeTextRegions(screen, currentIcons);
}

function render(): void {
  console.clear();
  console.log("\x1b[1m=== Text Region Prototype ===\x1b[0m");
  console.log(`\x1b[2mScreen: ${screen.colsM}×${screen.rowsN} cells\x1b[0m`);
  console.log(`\x1b[1mScenario ${currentScenario + 1}/5\x1b[0m: ${label}`);
  console.log(`\x1b[2mIcons: ${currentIcons.length}  Regions: ${currentRegions.length}\x1b[0m`);
  console.log("");

  // ASCII grid: 25 cols × 16 rows (each cell = 2 chars wide)
  const CELL_W = 2;
  const lines: string[] = Array.from({ length: screen.rowsN }, () =>
    " ".repeat(screen.colsM * CELL_W)
  );

  // Draw regions (background fill '·')
  for (const r of currentRegions) {
    for (let x = r.x; x < r.x + r.w; x++) {
      for (let y = r.y; y < r.y + r.h; y++) {
        if (x < 0 || x >= screen.colsM || y < 0 || y >= screen.rowsN) continue;
        const idx = y;
        const arr = lines[idx].split("");
        arr[x * CELL_W] = "·";
        arr[x * CELL_W + 1] = "·";
        lines[idx] = arr.join("");
      }
    }
  }

  // Draw stray icon cells (different marker)
  for (const r of currentRegions) {
    for (const s of r.strayCells) {
      for (let x = s.gx; x < s.gx + s.gw; x++) {
        for (let y = s.gy; y < s.gy + s.gh; y++) {
          if (y < 0 || y >= screen.rowsN) continue;
          const arr = lines[y].split("");
          arr[x * CELL_W] = "▒";
          arr[x * CELL_W + 1] = "▒";
          lines[y] = arr.join("");
        }
      }
    }
  }

  // Draw icons (foreground '█')
  for (const icon of currentIcons) {
    for (let x = icon.gx; x < icon.gx + icon.gw; x++) {
      for (let y = icon.gy; y < icon.gy + icon.gh; y++) {
        if (x < 0 || x >= screen.colsM || y < 0 || y >= screen.rowsN) continue;
        const arr = lines[y].split("");
        arr[x * CELL_W] = "█";
        arr[x * CELL_W + 1] = "█";
        lines[y] = arr.join("");
      }
    }
  }

  // Print grid
  for (let y = 0; y < screen.rowsN; y++) {
    const rowStr = lines[y];
    // color regions green, strays yellow, icons red
    let colored = "";
    for (let x = 0; x < screen.colsM; x++) {
      const c = rowStr.substring(x * CELL_W, x * CELL_W + CELL_W);
      if (c === "██") colored += "\x1b[31m██\x1b[0m";
      else if (c === "▒▒") colored += "\x1b[33m▒▒\x1b[0m";
      else if (c === "··") colored += "\x1b[32m··\x1b[0m";
      else colored += "  ";
    }
    console.log(colored);
  }

  console.log("");
  console.log("\x1b[1mLegend:\x1b[0m  \x1b[31m██\x1b[0m icon  \x1b[33m▒▒\x1b[0m stray (inside region, padded)  \x1b[32m··\x1b[0m text region  (empty) margin");
  console.log("");
  console.log("\x1b[1mRegions:\x1b[0m");
  if (currentRegions.length === 0) {
    console.log("  \x1b[2m(none — solid background only)\x1b[0m");
  } else {
    currentRegions.forEach((r, i) => {
      const ratioStr = r.columnRatio.join(":");
      console.log(
        `  [${i}] x=${r.x} y=${r.y} w=${r.w} h=${r.h}  ratio=${ratioStr}  strays=${r.strayCells.length}`
      );
    });
  }
  console.log("");
  console.log("\x1b[2m[1]-[5] load scenario  [r] recompute  [q] quit\x1b[0m");
}

// ----- main loop ----------------------------------------------------------

import * as readline from "node:readline";

// Export only — main() is invoked at the bottom, guarded by an argv check so
// debug imports don't trigger the TUI.

export function _main(): void {
  // Non-interactive mode: `tsx index.ts all` prints every scenario once and exits.
  if (process.argv[2] === "all") {
    for (let i = 0; i < SCENARIOS.length; i++) {
      currentScenario = i;
      recompute();
      render();
      console.log("\n");
    }
    return;
  }

  // Single-scenario mode: `tsx index.ts <n>`
  if (process.argv[2] && /^\d+$/.test(process.argv[2])) {
    currentScenario = Math.max(0, Math.min(SCENARIOS.length - 1, parseInt(process.argv[2], 10) - 1));
    recompute();
    render();
    return;
  }

  // Interactive TUI mode (requires a real TTY)
  recompute();
  render();

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.stdin.on("keypress", (_str, key) => {
    if (!key) return;
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      process.exit(0);
    }
    if (key.name >= "1" && key.name <= "5") {
      currentScenario = parseInt(key.name, 10) - 1;
      recompute();
      render();
    } else if (key.name === "r") {
      recompute();
      render();
    }
  });
}

// Only run main when this file is the entry point (not when imported).
// tsx sets `import.meta.url` to the file path being executed.
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  _main();
}
