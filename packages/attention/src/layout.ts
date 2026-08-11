import type { AttentionMap, CandidateRect, LayoutResult, PlacedItem, Rect } from "./types";
import { clamp } from "./image";

const MIN_CONTRAST = 4.5;
/** Absolute local busyness above which text is unreadable regardless of colour. */
const MAX_LUMA_STD = 0.12;

/**
 * Effective readability = WCAG contrast between the best of {black, white}
 * text and the candidate's mean luminance, driven to zero where the background
 * is locally busy (high raw luminance stddev). This drives the contrast gate
 * of the fallback ladder.
 */
function effectiveContrast(meanLuma: number, meanLumaStd: number): number {
  const base = achievableContrast(meanLuma);
  if (meanLumaStd <= MAX_LUMA_STD) return base;
  // Linearly degrade to 0 as stddev rises to 0.30 (near full-range flicker).
  const factor = Math.max(0, 1 - (meanLumaStd - MAX_LUMA_STD) / 0.18);
  return base * factor;
}

/** WCAG-style contrast using approximate linear luminance in [0,1]. */
export function contrastRatio(fgLuma: number, bgLuma: number): number {
  const l1 = Math.max(fgLuma, bgLuma);
  const l2 = Math.min(fgLuma, bgLuma);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Achievable contrast for either white (1.0) or black (0.0) text on bg. */
export function achievableContrast(bgLuma: number): number {
  return Math.max(contrastRatio(1, bgLuma), contrastRatio(0, bgLuma));
}

export interface LayoutOptions {
  /** Maximum items to place on one monitor. */
  maxItems: number;
  /** Candidate width as a fraction of image width. */
  widthFraction: number;
  /** Candidate height as a fraction of image height. */
  heightFraction: number;
  /** Margin from image edge, in pixels. */
  edgeMarginPx: number;
  /** Whether ONNX was active (controls conservative fallback). */
  onnxActive: boolean;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  maxItems: 3,
  widthFraction: 0.32,
  heightFraction: 0.12,
  edgeMarginPx: 48,
  onnxActive: false
};

interface ItemInput {
  index: number;
  body: string;
  priority: number;
}

/**
 * Generate multi-scale candidate rectangles, score each, and return sorted.
 */
export function generateCandidates(
  map: AttentionMap,
  opts: LayoutOptions,
  distField: Float32Array
): CandidateRect[] {
  const { gridW, gridH } = map;
  const out: CandidateRect[] = [];
  const scales = [1.0, 0.85, 0.7];
  const widthFracs = [opts.widthFraction, opts.widthFraction * 1.15, opts.widthFraction * 0.8];
  const heightFracs = [opts.heightFraction, opts.heightFraction * 1.1, opts.heightFraction * 0.85];

  for (let s = 0; s < scales.length; s++) {
    const wCells = Math.max(4, Math.round(widthFracs[s] * gridW));
    const hCells = Math.max(2, Math.round(heightFracs[s] * gridH));
    const strideX = Math.max(1, Math.round(wCells / 3));
    const strideY = Math.max(1, Math.round(hCells / 2));
    for (let y = 0; y + hCells <= gridH; y += strideY) {
      for (let x = 0; x + wCells <= gridW; x += strideX) {
        const c = scoreCellRect(map, x, y, wCells, hCells, distField);
        if (c.hardOverlap > 0) continue;
        out.push(c);
      }
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function scoreCellRect(
  map: AttentionMap,
  gx: number,
  gy: number,
  gw: number,
  gh: number,
  distField: Float32Array
): CandidateRect {
  const { gridW, cost, meanLuma, lumaStdRaw } = map;
  let sum = 0;
  let max = 0;
  let lumaSum = 0;
  let stdSum = 0;
  let distMin = Infinity;
  const cells = gw * gh;
  for (let y = gy; y < gy + gh; y++) {
    for (let x = gx; x < gx + gw; x++) {
      const i = y * gridW + x;
      const c = cost[i];
      sum += c;
      if (c > max) max = c;
      lumaSum += meanLuma[i];
      stdSum += lumaStdRaw[i];
      const d = distField[i];
      if (d < distMin) distMin = d;
    }
  }
  const meanCost = sum / cells;
  const meanLumaCell = lumaSum / cells;
  const meanLumaStd = stdSum / cells;
  const contrast = effectiveContrast(meanLumaCell, meanLumaStd);
  const edgeDistance = distMin;
  const area = gw * gh;

  // Score: prefer low mean cost, low max hotspot, decent area, far from
  // obstacles, and high effective contrast. Lower-bounded so a perfect rect
  // scores near 1.
  const score =
    0.45 * (1 - meanCost) +
    0.2 * (1 - max) +
    0.1 * clamp(area / (gridW * map.gridH), 0, 1) +
    0.1 * clamp(edgeDistance / 6, 0, 1) +
    0.15 * clamp((contrast - 1) / 4, 0, 1);

  return {
    x: Math.round((gx / gridW) * map.width),
    y: Math.round((gy / map.gridH) * map.height),
    w: Math.round((gw / gridW) * map.width),
    h: Math.round((gh / map.gridH) * map.height),
    meanCost,
    maxCost: max,
    edgeDistance,
    hardOverlap: 0,
    meanLuma: meanLumaCell,
    meanLumaStd,
    score
  };
}

function rectsOverlap(a: Rect, b: Rect, pad = 8): boolean {
  return !(
    a.x + a.w + pad < b.x ||
    b.x + b.w + pad < a.x ||
    a.y + a.h + pad < b.y ||
    b.y + b.h + pad < a.y
  );
}

function safeRailRect(map: AttentionMap, opts: LayoutOptions, side: "right" | "bottom"): Rect {
  const margin = opts.edgeMarginPx;
  if (side === "right") {
    const w = Math.round(map.width * 0.22);
    return {
      x: map.width - w - margin,
      y: margin,
      w,
      h: map.height - margin * 2
    };
  }
  const h = Math.round(map.height * 0.16);
  return { x: margin, y: map.height - h - margin, w: map.width - margin * 2, h };
}

/**
 * Produce a layout for up to `maxItems` items by greedily choosing the best
 * non-overlapping candidate per item, applying the brief's fallback ladder
 * when contrast < 4.5:1.
 *
 * Ladder: reduce_count -> reflow -> translucent -> safe_rail.
 */
export function proposeLayout(
  map: AttentionMap,
  bodies: { body: string; priority: number }[],
  options: Partial<LayoutOptions> = {}
): LayoutResult {
  const opts: LayoutOptions = { ...DEFAULT_LAYOUT, ...options };
  const items: ItemInput[] = bodies
    .map((b, i) => ({ index: i, body: b.body, priority: b.priority }))
    .sort((a, b) => b.priority - a.priority);
  const capped = items.slice(0, opts.maxItems);
  const diagnostics: import("./types").Diagnostic[] = [];

  const distField = (map as unknown as { __dist?: Float32Array }).__dist ??
    new Float32Array(map.gridW * map.gridH).fill(10);
  const candidates = generateCandidates(map, opts, distField);

  const used: CandidateRect[] = [];
  const placements: PlacedItem[] = [];
  let usedFallback: PlacedItem["fallback"] | "none" = "none";

  const place = (item: ItemInput, allowFallback: boolean): PlacedItem | null => {
    for (const cand of candidates) {
      if (used.some((u) => rectsOverlap(u, cand))) continue;
      const contrast = effectiveContrast(cand.meanLuma, cand.meanLumaStd);
      if (contrast >= MIN_CONTRAST) {
        used.push(cand);
        return {
          itemIndex: item.index,
          body: item.body,
          rect: { ...cand },
          fallback: "none",
          contrast,
          meanLumaStd: cand.meanLumaStd
        };
      }
    }
    if (!allowFallback) return null;

    // Step 1: reflow — narrow rect and retry.
    for (const cand of candidates) {
      if (used.some((u) => rectsOverlap(u, cand))) continue;
      const narrowW = Math.round(cand.w * 0.75);
      const narrowX = cand.x + Math.round((cand.w - narrowW) / 2);
      const contrast = effectiveContrast(cand.meanLuma, cand.meanLumaStd);
      if (contrast >= 3) {
        used.push(cand);
        usedFallback = "reflow";
        diagnostics.push({ level: "warn", code: "layout.reflow", message: `Reflowed "${item.body.slice(0, 8)}" to a narrower rect for contrast.` });
        return {
          itemIndex: item.index,
          body: item.body,
          rect: { x: narrowX, y: cand.y, w: narrowW, h: cand.h },
          fallback: "reflow",
          contrast,
          meanLumaStd: cand.meanLumaStd
        };
      }
    }

    // Step 2: translucent card — overlay a translucent dark card behind text
    // to guarantee contrast. Rect may sit in higher-cost area but is still
    // outside hard mask (candidates already filter hardOverlap).
    for (const cand of candidates) {
      if (used.some((u) => rectsOverlap(u, cand))) continue;
      used.push(cand);
      usedFallback = "translucent";
      diagnostics.push({ level: "warn", code: "layout.translucent", message: `Translucent card applied to "${item.body.slice(0, 8)}" for contrast.` });
      return {
        itemIndex: item.index,
        body: item.body,
        rect: { ...cand },
        fallback: "translucent",
        contrast: 7,
        meanLumaStd: cand.meanLumaStd
      };
    }

    // Step 3: safe rail — last resort, reserved screen-edge strip.
    const rail = safeRailRect(map, opts, map.width >= map.height ? "right" : "bottom");
    used.push({ ...rail, meanCost: 0, maxCost: 0, edgeDistance: 0, hardOverlap: 0, meanLuma: 0, meanLumaStd: 0, score: 0 });
    usedFallback = "safe_rail";
    diagnostics.push({ level: "warn", code: "layout.safe_rail", message: `Safe-rail used for "${item.body.slice(0, 8)}".` });
    return {
      itemIndex: item.index,
      body: item.body,
      rect: rail,
      fallback: "safe_rail",
      contrast: 7,
      meanLumaStd: 0
    };
  };

  // First pass: place all capped items (reducing count is handled by caller).
  for (const item of capped) {
    const p = place(item, true);
    if (p) placements.push(p);
  }

  // Sort placements by original item order for deterministic rendering.
  placements.sort((a, b) => a.itemIndex - b.itemIndex);

  if (placements.length < items.length) {
    usedFallback = usedFallback === "none" ? "reduce_count" : usedFallback;
    diagnostics.push({
      level: "warn",
      code: "layout.reduce_count",
      message: `Reduced item count from ${items.length} to ${placements.length}.`
    });
  }

  return {
    placements,
    usedFallback: usedFallback !== "none",
    onnxActive: map.onnxActive,
    diagnostics
  };
}
