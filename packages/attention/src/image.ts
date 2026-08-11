import type { ImageInput, Rect } from "./types";

/** Luminance using Rec. 709 weights, returned in [0,1]. */
export function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Sample an RGBA pixel at integer coords. Returns [r,g,b,a]. */
export function pixel(img: ImageInput, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  const d = img.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

/**
 * Build a grayscale luma buffer downsampled to gridW x gridH using simple
 * box averaging. Pixels outside the image are treated as black.
 */
export function downsampleLuma(img: ImageInput, gridW: number, gridH: number): Float32Array {
  const out = new Float32Array(gridW * gridH);
  const cw = img.width / gridW;
  const ch = img.height / gridH;
  const d = img.data;
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      let sum = 0;
      let count = 0;
      const x0 = Math.floor(gx * cw);
      const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cw));
      const y0 = Math.floor(gy * ch);
      const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * ch));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
          const i = (y * img.width + x) * 4;
          sum += luma(d[i], d[i + 1], d[i + 2]);
          count++;
        }
      }
      out[gy * gridW + gx] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/** Mean luma per grid cell, for contrast checks. */
export function downsampleMeanLumaAndVariance(
  img: ImageInput,
  gridW: number,
  gridH: number
): { mean: Float32Array; variance: Float32Array; colorVariance: Float32Array; stdRaw: Float32Array } {
  const mean = new Float32Array(gridW * gridH);
  const variance = new Float32Array(gridW * gridH);
  const colorVariance = new Float32Array(gridW * gridH);
  const stdRaw = new Float32Array(gridW * gridH);
  const cw = img.width / gridW;
  const ch = img.height / gridH;
  const d = img.data;
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      let sum = 0;
      let sumSq = 0;
      let rSum = 0, gSum = 0, bSum = 0;
      let rSq = 0, gSq = 0, bSq = 0;
      let count = 0;
      const x0 = Math.floor(gx * cw);
      const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cw));
      const y0 = Math.floor(gy * ch);
      const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * ch));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
          const i = (y * img.width + x) * 4;
          const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
          const lu = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += lu;
          sumSq += lu * lu;
          rSum += r; gSum += g; bSum += b;
          rSq += r * r; gSq += g * g; bSq += b * b;
          count++;
        }
      }
      if (count > 0) {
        const m = sum / count;
        mean[gy * gridW + gx] = m;
        const varRaw = Math.max(0, sumSq / count - m * m);
        variance[gy * gridW + gx] = varRaw;
        stdRaw[gy * gridW + gx] = Math.sqrt(varRaw);
        const rm = rSum / count, gm = gSum / count, bm = bSum / count;
        colorVariance[gy * gridW + gx] = Math.max(
          0,
          Math.max(rSq / count - rm * rm, gSq / count - gm * gm, bSq / count - bm * bm)
        );
      }
    }
  }
  return { mean, variance, colorVariance, stdRaw };
}

/** Normalize a Float32Array to [0,1]. If range is zero, returns zeros. */
export function normalize(src: Float32Array, dst?: Float32Array): Float32Array {
  const out = dst ?? new Float32Array(src.length);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range < 1e-8) {
    out.fill(0);
    return out;
  }
  for (let i = 0; i < src.length; i++) {
    out[i] = (src[i] - min) / range;
  }
  return out;
}

/** Simple separable box blur on a grid. */
export function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = radius * 2 + 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) {
      const xi = clamp(x, 0, w - 1);
      acc += src[y * w + xi];
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / win;
      const xOut = clamp(x - radius, 0, w - 1);
      const xIn = clamp(x + radius + 1, 0, w - 1);
      acc += src[y * w + xIn] - src[y * w + xOut];
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) {
      const yi = clamp(y, 0, h - 1);
      acc += tmp[yi * w + x];
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      const yOut = clamp(y - radius, 0, h - 1);
      const yIn = clamp(y + radius + 1, 0, h - 1);
      acc += tmp[yIn * w + x] - tmp[yOut * w + x];
    }
  }
  return out;
}

/** Deepens contrast so the brightest 20% stands out (used for saliency maps). */
export function sharpenTopTail(src: Float32Array, tail = 0.2): Float32Array {
  const out = new Float32Array(src.length);
  let max = 0;
  for (let i = 0; i < src.length; i++) if (src[i] > max) max = src[i];
  if (max < 1e-8) return out;
  for (let i = 0; i < src.length; i++) {
    const v = src[i] / max;
    out[i] = v >= 1 - tail ? v : v * 0.4;
  }
  return out;
}

/** Rasterize a pixel-space rect into the grid (gx,gy,gw,gh). Returns cells. */
export function rectToGridCells(r: Rect, imgW: number, imgH: number, gridW: number, gridH: number): {
  gx: number; gy: number; gw: number; gh: number;
} {
  const sx = gridW / imgW;
  const sy = gridH / imgH;
  const gx = Math.floor(r.x * sx);
  const gy = Math.floor(r.y * sy);
  const gx2 = Math.ceil((r.x + r.w) * sx);
  const gy2 = Math.ceil((r.y + r.h) * sy);
  return {
    gx: Math.max(0, gx),
    gy: Math.max(0, gy),
    gw: Math.min(gridW, gx2) - Math.max(0, gx),
    gh: Math.min(gridH, gy2) - Math.max(0, gy)
  };
}
