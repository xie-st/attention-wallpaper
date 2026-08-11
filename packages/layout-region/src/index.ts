/**
 * @aw/layout-region — computes Text Regions (areas free of desktop icons) per ADR-0022.
 *
 * Pure functions: input (icon rects, screen spec, config) → output (TextRegion[]).
 * No IO, no side effects. Lifted from prototype/text-region/index.ts (validated).
 */

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
  /** Proportional split inside the region; e.g. [3, 2] = 60/40. */
  columnRatio: number[];
  /** Sparse icon cells inside the region (padding targets). */
  strayCells: GridRect[];
}

export interface LayoutRegionConfig {
  minRegionWidthCells: number;
  sparseThreshold: number;
  sparseTolerance: number;
  pageMarginCells: number;
  interRegionGapCells: number;
  strayPaddingCells: number;
  snapRatios: number[][];
  snapTolerance: number;
}

export const DEFAULT_CONFIG: LayoutRegionConfig = {
  minRegionWidthCells: 5,
  sparseThreshold: 0.15,
  sparseTolerance: 0.3,
  pageMarginCells: 2,
  interRegionGapCells: 1,
  strayPaddingCells: 1,
  snapRatios: [[1, 1], [3, 2], [2, 3], [3, 1], [1, 3], [4, 6], [6, 4], [2, 1], [1, 2]],
  snapTolerance: 0.05,
};

type ColumnKind = "free" | "sparse" | "blocked";

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

export function columnOccupancyRate(grid: boolean[][], x: number, rowsN: number): number {
  let occ = 0;
  for (let y = 0; y < rowsN; y++) if (grid[x][y]) occ++;
  return occ / rowsN;
}

export function classifyColumn(rate: number, cfg: LayoutRegionConfig): ColumnKind {
  if (rate === 0) return "free";
  if (rate <= cfg.sparseThreshold) return "sparse";
  return "blocked";
}

export function groupColumns(
  screen: ScreenSpec,
  grid: boolean[][],
  cfg: LayoutRegionConfig
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

/** Find the longest run of sparse columns; returns its relative center [0..1] over the input array. */
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

function snapRatio(ration: number, cfg: LayoutRegionConfig): number[] {
  for (const r of cfg.snapRatios) {
    const value = r[0] / (r[0] + r[1]);
    if (Math.abs(ration - value) <= cfg.snapTolerance) return r;
  }
  const rounded = Math.round(ration * 20) / 20;
  return [rounded, 1 - rounded];
}

function collectStrayCells(
  screen: ScreenSpec,
  grid: boolean[][],
  region: { x: number; y: number; w: number; h: number },
  cfg: LayoutRegionConfig
): GridRect[] {
  const strays: GridRect[] = [];
  for (let x = region.x; x < region.x + region.w; x++) {
    for (let y = region.y; y < region.y + region.h; y++) {
      if (!grid[x][y]) continue;
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
  cfg: LayoutRegionConfig = DEFAULT_CONFIG
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

    const margin = cfg.pageMarginCells;
    const x = run.start + margin;
    const w = width - 2 * margin;
    if (w < cfg.minRegionWidthCells) continue;

    const y = margin;
    const h = screen.rowsN - 2 * margin;

    // Sparse-cluster detection runs on inset columns only (not the full run),
    // so edge icons excluded by the page margin don't poison the split ratio.
    const insetCols = run.cols.slice(margin, margin + w);
    const cluster = findDominantSparseCluster(insetCols);
    let columnRatio: number[];
    if (cluster && cluster.count >= 1) {
      const clamped = Math.max(0.1, Math.min(0.9, cluster.center));
      columnRatio = snapRatio(clamped, cfg);
    } else {
      columnRatio = w >= 10 ? [1, 1] : [1];
    }

    const strays = collectStrayCells(screen, grid, { x, y, w, h }, cfg);
    regions.push({ x, y, w, h, columnRatio, strayCells: strays });
  }

  return regions;
}
