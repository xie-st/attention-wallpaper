import type {
  AttentionAdapter,
  ComponentStatus,
  Diagnostic,
  HardExclusions,
  ImageInput,
  Rect
} from "./types";
import type { HeuristicMaps } from "./heuristics";
import { computeHeuristics } from "./heuristics";
import { boxBlur, clamp, normalize, rectToGridCells } from "./image";
import type { FaceDetLiteAdapter, PpOcrTextAdapter } from "./adapters";

export interface BuildMapOptions {
  gridW?: number;
  gridH?: number;
  hard: HardExclusions;
  subjectAdapter?: AttentionAdapter;
  faceAdapter?: FaceDetLiteAdapter;
  textAdapter?: PpOcrTextAdapter;
}

export const SOFT_COST_WEIGHTS = {
  subjectSaliency: 0.45,
  spectralSaliency: 0.2,
  edgeDensity: 0.15,
  readabilityPenalty: 0.2
} as const;

/** Expand a rect about its center by a fractional factor (e.g. 0.15 = 15%). */
export function expandRect(r: Rect, factor: number): Rect {
  const dx = (r.w * factor) / 2;
  const dy = (r.h * factor) / 2;
  return { x: r.x - dx, y: r.y - dy, w: r.w + dx * 2, h: r.h + dy * 2 };
}

/** Expand a rect by a fixed number of pixels on each side. */
export function expandRectPx(r: Rect, px: number): Rect {
  return { x: r.x - px, y: r.y - px, w: r.w + px * 2, h: r.h + px * 2 };
}

/** Rasterize hard-exclusion rects into a binary grid mask (1 = forbidden). */
export function rasterizeHard(
  hard: HardExclusions,
  imgW: number,
  imgH: number,
  gridW: number,
  gridH: number
): Uint8Array {
  const mask = new Uint8Array(gridW * gridH);
  const rects: Rect[] = [...hard.icons];
  if (hard.taskbar) rects.push(hard.taskbar);
  for (const f of hard.faces) rects.push(f);
  for (const t of hard.texts) rects.push(t);
  for (const r of rects) {
    const cell = rectToGridCells(r, imgW, imgH, gridW, gridH);
    for (let y = cell.gy; y < cell.gy + cell.gh; y++) {
      for (let x = cell.gx; x < cell.gx + cell.gw; x++) {
        if (x >= 0 && y >= 0 && x < gridW && y < gridH) mask[y * gridW + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * Two-pass chamfer distance from any hard-mask cell. Values are in grid cells.
 * Large value = far from obstacles = good for placing text.
 */
export function hardDistanceField(hardMask: Uint8Array, gridW: number, gridH: number): Float32Array {
  const INF = 1e6;
  const dist = new Float32Array(gridW * gridH);
  dist.fill(INF);
  for (let i = 0; i < hardMask.length; i++) if (hardMask[i] === 1) dist[i] = 0;
  // forward pass
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const i = y * gridW + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - gridW] + 1);
      dist[i] = d;
    }
  }
  // backward pass
  for (let y = gridH - 1; y >= 0; y--) {
    for (let x = gridW - 1; x >= 0; x--) {
      const i = y * gridW + x;
      let d = dist[i];
      if (x < gridW - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < gridH - 1) d = Math.min(d, dist[i + gridW] + 1);
      dist[i] = d;
    }
  }
  return dist;
}

/**
 * Combine heuristic + adapter maps into the softCost grid using the brief's
 * weights. Hard-masked cells are forced to cost 1 so candidates that touch
 * obstacles are penalised (and filtered out at candidate-generation time).
 */
export interface ComposedCost {
  cost: Float32Array;
  components: ComponentStatus[];
  onnxActive: boolean;
  maps: HeuristicMaps;
}

export function composeCost(
  maps: HeuristicMaps,
  hardMask: Uint8Array,
  subjectAdapter: AttentionAdapter | undefined
): ComposedCost {
  const n = maps.gridW * maps.gridH;
  const components: ComponentStatus[] = [];
  let onnxActive = false;

  // Subject saliency: ONNX when available, heuristic fallback otherwise.
  let subjectMap: Float32Array;
  let subjectEffWeight = SOFT_COST_WEIGHTS.subjectSaliency;
  if (subjectAdapter && subjectAdapter.available()) {
    const r = subjectAdapter.run(
      { width: 0, height: 0, data: new Uint8ClampedArray(0) },
      maps.gridW,
      maps.gridH
    );
    if (r.kind === "ready") {
      subjectMap = normalize(r.map);
      onnxActive = true;
      components.push({
        name: "subject_saliency",
        source: "onnx",
        available: true,
        effectiveWeight: subjectEffWeight
      });
    } else {
      subjectMap = maps.subjectSaliency;
      subjectEffWeight *= 0.6;
      components.push({
        name: "subject_saliency",
        source: "heuristic",
        available: false,
        reason: r.reason,
        effectiveWeight: subjectEffWeight
      });
    }
  } else {
    subjectMap = maps.subjectSaliency;
    subjectEffWeight *= 0.6;
    components.push({
      name: "subject_saliency",
      source: "heuristic",
      available: false,
      reason: "adapter_not_configured",
      effectiveWeight: subjectEffWeight
    });
  }

  const spectral = maps.spectralSaliency;
  const edges = maps.edgeDensity;
  const readability = maps.readabilityPenalty;
  components.push({ name: "spectral_residual", source: "heuristic", available: true, effectiveWeight: SOFT_COST_WEIGHTS.spectralSaliency });
  components.push({ name: "edge_density", source: "heuristic", available: true, effectiveWeight: SOFT_COST_WEIGHTS.edgeDensity });
  components.push({ name: "readability_penalty", source: "heuristic", available: true, effectiveWeight: SOFT_COST_WEIGHTS.readabilityPenalty });
  components.push({ name: "luminance_variance", source: "heuristic", available: true, effectiveWeight: 0 });
  components.push({ name: "color_variance", source: "heuristic", available: true, effectiveWeight: 0 });

  const cost = new Float32Array(n);
  const totalW =
    subjectEffWeight +
    SOFT_COST_WEIGHTS.spectralSaliency +
    SOFT_COST_WEIGHTS.edgeDensity +
    SOFT_COST_WEIGHTS.readabilityPenalty;
  for (let i = 0; i < n; i++) {
    const c =
      (subjectEffWeight * subjectMap[i] +
        SOFT_COST_WEIGHTS.spectralSaliency * spectral[i] +
        SOFT_COST_WEIGHTS.edgeDensity * edges[i] +
        SOFT_COST_WEIGHTS.readabilityPenalty * readability[i]) /
      totalW;
    cost[i] = hardMask[i] === 1 ? 1 : clamp(c, 0, 1);
  }
  // Light Gaussian smoothing via a repeated box blur (cheap approximation).
  const smoothed = boxBlur(cost, maps.gridW, maps.gridH, 1);
  for (let i = 0; i < n; i++) if (hardMask[i] === 1) smoothed[i] = 1;
  return { cost: smoothed, components, onnxActive, maps };
}

export interface BuildMapResult {
  map: import("./types").AttentionMap;
  diagnostics: Diagnostic[];
}

/** Orchestrate the full attention pipeline for one image. */
export function buildAttentionMap(
  img: ImageInput,
  opts: BuildMapOptions
): BuildMapResult {
  const gridW = opts.gridW ?? 64;
  const gridH = opts.gridH ?? 36;
  const maps = computeHeuristics(img, gridW, gridH);

  // Expand face boxes by 15% and text boxes by 12 px per the brief.
  const expandedFaces = opts.hard.faces.map((f) => expandRect(f, 0.15));
  const expandedTexts = opts.hard.texts.map((t) => expandRectPx(t, 12));
  const hard: HardExclusions = {
    icons: opts.hard.icons,
    taskbar: opts.hard.taskbar,
    faces: expandedFaces,
    texts: expandedTexts
  };

  const hardMask = rasterizeHard(hard, img.width, img.height, gridW, gridH);
  const composed = composeCost(maps, hardMask, opts.subjectAdapter);
  const distField = hardDistanceField(hardMask, gridW, gridH);

  const diagnostics: Diagnostic[] = [];
  if (!composed.onnxActive) {
    diagnostics.push({
      level: "warn",
      code: "models.unavailable",
      message: "ONNX models not active; using local heuristic saliency. Layout will be conservative."
    });
  }
  if (opts.faceAdapter && !opts.faceAdapter.available()) {
    diagnostics.push({
      level: "warn",
      code: "faces.unavailable",
      message: `Face detector unavailable (${opts.faceAdapter.reasonUnavailable()}); faces not auto-excluded, layout will be conservative.`
    });
  }
  if (opts.textAdapter && !opts.textAdapter.available()) {
    diagnostics.push({
      level: "warn",
      code: "text.unavailable",
      message: `Text detector unavailable (${opts.textAdapter.reasonUnavailable()}); existing text not auto-excluded, layout will be conservative.`
    });
  }
  if (hard.icons.length === 0) {
    diagnostics.push({
      level: "warn",
      code: "icons.fallback",
      message: "Desktop icon rectangles unavailable; using edge-safe conservative fallback."
    });
  }

  // Subject map for the public AttentionMap. If the adapter contributed, take
  // its grid; otherwise expose the heuristic subject saliency.
  let subjectOut = maps.subjectSaliency;
  if (opts.subjectAdapter && opts.subjectAdapter.available()) {
    const r = opts.subjectAdapter.run(img, gridW, gridH);
    if (r.kind === "ready") subjectOut = normalize(r.map);
  }

  const attentionMap: import("./types").AttentionMap = {
    width: img.width,
    height: img.height,
    scale: 1,
    gridW,
    gridH,
    cost: composed.cost,
    hardMask,
    subjectSaliency: subjectOut,
    spectralSaliency: maps.spectralSaliency,
    edgeDensity: maps.edgeDensity,
    readabilityPenalty: maps.readabilityPenalty,
    luminanceVariance: maps.luminanceVariance,
    colorVariance: maps.colorVariance,
    meanLuma: maps.meanLuma,
    lumaStdRaw: maps.lumaStdRaw,
    onnxActive: composed.onnxActive,
    components: composed.components,
    diagnostics
  };
  // expose distance field via a non-enumerable extension used by scoring:
  (attentionMap as unknown as { __dist?: Float32Array }).__dist = distField;
  return { map: attentionMap, diagnostics };
}
