export type Priority = "low" | "normal" | "high";

export interface ImageInput {
  width: number;
  height: number;
  /** RGBA, row-major, length = width*height*4. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComponentStatus {
  name: "subject_saliency" | "face_detection" | "text_detection" | "spectral_residual" | "edge_density" | "luminance_variance" | "color_variance" | "readability_penalty";
  source: "heuristic" | "onnx";
  available: boolean;
  reason?: string;
  /** 0..1, how much of the final map came from this component's full weight. */
  effectiveWeight: number;
}

export interface Diagnostic {
  level: "ok" | "warn" | "error";
  code: string;
  message: string;
}

export interface AttentionMap {
  /** Full image size, pixels. */
  width: number;
  height: number;
  /** Grid is width/scale by height/scale. */
  scale: number;
  gridW: number;
  gridH: number;
  /** Soft cost in [0,1]; higher = worse place for text. */
  cost: Float32Array;
  /** 1 = forbidden (icontaskbar/faces/text). */
  hardMask: Uint8Array;
  /** Diagnostic sub-maps, all grid-sized, [0,1]. */
  subjectSaliency: Float32Array;
  spectralSaliency: Float32Array;
  edgeDensity: Float32Array;
  readabilityPenalty: Float32Array;
  luminanceVariance: Float32Array;
  colorVariance: Float32Array;
  /** Mean luminance per grid cell [0,1], used for text contrast checks. */
  meanLuma: Float32Array;
  /** Raw local luminance stddev per grid cell [0,1], absolute readability gauge. */
  lumaStdRaw: Float32Array;
  onnxActive: boolean;
  components: ComponentStatus[];
  diagnostics: Diagnostic[];
}

export interface CandidateRect extends Rect {
  /** Mean soft cost across the rect (lower is better). */
  meanCost: number;
  /** Max soft cost across the rect (penalises hotspots). */
  maxCost: number;
  /** Distance to nearest hard-mask cell, in grid cells (>= 0). */
  edgeDistance: number;
  /** Fraction of the rect overlapping any hard mask (should be 0 for valid). */
  hardOverlap: number;
  /** Mean luminance of the covered pixels in [0,1]. */
  meanLuma: number;
  /** Mean raw luminance stddev across the rect (absolute busyness gauge). */
  meanLumaStd: number;
  /** Score, higher = better. */
  score: number;
}

export interface PlacedItem {
  /** Index of the source item this placement corresponds to. */
  itemIndex: number;
  body: string;
  rect: Rect;
  /** Whether the layout had to fall back to translucent cards / safe rail. */
  fallback: "none" | "reduce_count" | "reflow" | "translucent" | "safe_rail";
  /** Estimated contrast ratio of text-on-background at this rect. */
  contrast: number;
  /** Mean raw luminance stddev across the rect (absolute busyness gauge). */
  meanLumaStd: number;
}

export interface LayoutResult {
  placements: PlacedItem[];
  /** True if any fallback was used. */
  usedFallback: boolean;
  /** True if ONNX adapters contributed to the map. */
  onnxActive: boolean;
  diagnostics: Diagnostic[];
}

export interface AttentionAdapter {
  name: string;
  available(): boolean;
  /** Returns a grid-sized map in [0,1] or an unavailable marker. */
  run(input: ImageInput, gridW: number, gridH: number): AdapterResult;
}

export type AdapterResult =
  | { kind: "ready"; map: Float32Array; confidence: number }
  | { kind: "unavailable"; reason: string };

/** Hard exclusion rectangles (desktop pixels). */
export interface HardExclusions {
  /** Desktop icon rectangles in image pixel space. */
  icons: Rect[];
  /** Taskbar rectangle in image pixel space, if known. */
  taskbar: Rect | null;
  /** Detected face boxes (already expanded). */
  faces: Rect[];
  /** Detected text boxes (already expanded). */
  texts: Rect[];
}
