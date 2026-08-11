import { buildAttentionMap, proposeLayout, type AttentionMap, type LayoutResult, type PlacedItem, type HardExclusions, type ImageInput } from "@attention";
import { layoutText, pickTextLumaFor, relativeLuminance, canvasFont, PretextMeasurer, type FontSpec, type TextMeasurer } from "@pretext-layout";
import { selectForRotation, type ContentItem, ROTATION_INTERVAL_MS } from "@content-model";
import type { MonitorInfo, Rect, Settings } from "./tauri";

export interface DecodedImage {
  imageData: ImageInput;
  width: number;
  height: number;
  bitmap: ImageBitmap | null;
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    return { canvas: c, ctx };
  }
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  return { canvas: c, ctx };
}

export async function decodeImage(bytes: Uint8Array): Promise<DecodedImage> {
  // Copy into a standalone ArrayBuffer so Blob gets a pure ArrayBuffer (not
  // SharedArrayBuffer) — keeps TS strict-mode happy across lib versions.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);
  const { ctx } = makeCanvas(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { imageData: { width: bitmap.width, height: bitmap.height, data: imageData.data }, width: bitmap.width, height: bitmap.height, bitmap };
}

export interface AnalysisInput {
  image: ImageInput;
  hard: HardExclusions;
  gridW?: number;
  gridH?: number;
}

export interface AnalysisResult {
  map: AttentionMap;
  diagnostics: { level: "ok" | "warn" | "error"; code: string; message: string }[];
}

export function analyze(input: AnalysisInput): AnalysisResult {
  const res = buildAttentionMap(input.image, {
    hard: input.hard,
    gridW: input.gridW ?? 96,
    gridH: input.gridH ?? 54
  });
  return { map: res.map, diagnostics: res.diagnostics };
}

export interface CompositeInput {
  wallpaper: ImageInput;
  monitor: MonitorInfo;
  hard: HardExclusions;
  content: ContentItem[];
  settings: Settings;
  measurer?: TextMeasurer;
  /** When true, preview is rendered at a smaller scale for display. */
  previewMaxWidth?: number;
}

export interface CompositeOutput {
  map: AttentionMap;
  layout: LayoutResult;
  placed: ContentItem[];
  /** Full-resolution PNG bytes. */
  png: Uint8Array;
  /** Scaled PNG for preview. */
  previewPng: Uint8Array;
  diagnostics: { level: "ok" | "warn" | "error"; code: string; message: string }[];
}

function pickFont(_settings: Settings, sizePx: number): FontSpec {
  // Font family is no longer settings-driven post-pivot (ADR-0006 + ADR-0019).
  // Hardcoded until slice #8 (pretextArticleLayout) reintroduces Noto Serif SC pinning.
  return { family: "Microsoft YaHei UI", size: sizePx, weight: 500 };
}

function drawPlacement(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  placement: PlacedItem,
  measurer: TextMeasurer,
  font: FontSpec
): void {
  const { rect, body } = placement;
  const fontStr = canvasFont(font);
  ctx.font = fontStr;
  if ("letterSpacing" in ctx) {
    (ctx as CanvasRenderingContext2D).letterSpacing = `${font.letterSpacing ?? 0}px`;
  }
  const lineHeight = Math.round(font.size * 1.45);
  const maxWidth = rect.w - 20;
  const laid = layoutText(body, font, maxWidth, lineHeight, measurer, 4);

  // Background card for translucent / safe_rail fallbacks.
  if (placement.fallback === "translucent") {
    ctx.fillStyle = "rgba(8, 10, 14, 0.52)";
    roundRect(ctx, rect.x + 6, rect.y + 4, rect.w - 12, rect.h - 8, 10);
    ctx.fill();
  } else if (placement.fallback === "safe_rail") {
    ctx.fillStyle = "rgba(8, 10, 14, 0.6)";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  // Choose text color from the placement's mean luma via the map (approx).
  // The compositor knows the wallpaper pixels; we sample a few at the rect.
  const sample = sampleMeanLuma(ctx, rect);
  const luminance = relativeLuminance(sample, sample, sample);
  const textLuma = pickTextLumaFor(luminance);
  const color = placement.fallback === "translucent" || placement.fallback === "safe_rail"
    ? "#f5f7fa"
    : textLuma === 1 ? "rgba(255,255,255,0.96)" : "rgba(12,14,18,0.92)";

  // Soft shadow for legibility on photographs.
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = placement.fallback === "none" ? 6 : 0;
  ctx.shadowOffsetY = 1;

  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  const startY = rect.y + (rect.h - laid.totalHeight) / 2 + lineHeight / 2;
  ctx.textAlign = "left";
  for (let i = 0; i < laid.lines.length; i++) {
    const line = laid.lines[i];
    const w = line.width;
    const x = rect.x + (rect.w - w) / 2;
    ctx.fillText(line.text, x, startY + i * lineHeight);
  }
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

function sampleMeanLuma(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, rect: Rect): number {
  try {
    const w = Math.max(1, Math.floor(rect.w));
    const h = Math.max(1, Math.floor(rect.h));
    const data = ctx.getImageData(Math.max(0, Math.floor(rect.x)), Math.max(0, Math.floor(rect.y)), Math.min(w, 64), Math.min(h, 64)).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    }
    return sum / (data.length / 4);
  } catch {
    return 0.5;
  }
}

function roundRect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function canvasToPng(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const blob = (canvas as OffscreenCanvas).convertToBlob
      ? (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" })
      : new Promise<Blob>((res) => (canvas as HTMLCanvasElement).toBlob((b) => res(b!), "image/png"));
    Promise.resolve(blob).then((b) => b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)))).catch(reject);
  });
}

export async function composite(input: CompositeInput): Promise<CompositeOutput> {
  const measurer = input.measurer ?? new PretextMeasurer();
  const { map, diagnostics } = analyze({ image: input.wallpaper, hard: input.hard });

  // Select content for this single monitor (rotation of 1). Use the
  // content-model selection with last-shown = lastRotatedAt per item.
  const now = new Date().toISOString();
  const items = input.content.filter((i) => i.enabled);
  const rotation = selectForRotation(items, now, 1, 1, {});
  const chosen = rotation[0] ?? [];

  const layout = proposeLayout(
    map,
    chosen.map((c) => ({ body: c.body, priority: priorityNum(c.priority) })),
    { maxItems: 1, onnxActive: map.onnxActive }
  );

  // Draw wallpaper to a full-res canvas matching the monitor.
  const { canvas, ctx } = makeCanvas(input.wallpaper.width, input.wallpaper.height);
  const tmp = ctx.createImageData(input.wallpaper.width, input.wallpaper.height);
  tmp.data.set(input.wallpaper.data);
  ctx.putImageData(tmp, 0, 0);

  const font = pickFont(input.settings, Math.round(input.wallpaper.height / 38));
  for (const placement of layout.placements) {
    drawPlacement(ctx, placement, measurer, font);
  }

  const png = await canvasToPng(canvas);

  // Preview: scale down to previewMaxWidth.
  const previewMaxWidth = input.previewMaxWidth ?? 720;
  const scale = Math.min(1, previewMaxWidth / input.wallpaper.width);
  const pw = Math.round(input.wallpaper.width * scale);
  const ph = Math.round(input.wallpaper.height * scale);
  const prev = makeCanvas(pw, ph);
  prev.ctx.drawImage(canvas instanceof HTMLCanvasElement ? canvas : canvas, 0, 0, pw, ph);
  const previewPng = await canvasToPng(prev.canvas);

  return { map, layout, placed: chosen, png, previewPng, diagnostics };
}

function priorityNum(p: ContentItem["priority"]): number {
  return p === "high" ? 3 : p === "normal" ? 2 : 1;
}

export const ROTATION_INTERVAL = ROTATION_INTERVAL_MS;
