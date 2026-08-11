import { downsampleLuma, downsampleMeanLumaAndVariance, boxBlur, normalize, clamp } from "./image";
import { fft2d, isPow2 } from "./fft";
import type { ImageInput } from "./types";

export interface HeuristicMaps {
  subjectSaliency: Float32Array;
  spectralSaliency: Float32Array;
  edgeDensity: Float32Array;
  readabilityPenalty: Float32Array;
  luminanceVariance: Float32Array;
  colorVariance: Float32Array;
  meanLuma: Float32Array;
  /** Raw (un-normalised) local luminance standard deviation in [0,1] luma units. */
  lumaStdRaw: Float32Array;
  gridW: number;
  gridH: number;
}

/** Apply a separable Hanning window in-place to reduce FFT border artifacts. */
function hanningWindow(buf: Float32Array, rows: number, cols: number): void {
  for (let r = 0; r < rows; r++) {
    const wy = 0.5 * (1 - Math.cos((2 * Math.PI * r) / (rows - 1)));
    for (let c = 0; c < cols; c++) {
      const wx = 0.5 * (1 - Math.cos((2 * Math.PI * c) / (cols - 1)));
      buf[r * cols + c] *= wy * wx;
    }
  }
}

/**
 * Spectral-residual saliency (Hou & Zhang 2007), implemented on the downsampled
 * luma. Returns a grid-sized [0,1] map. Deterministic and free of any model.
 */
export function spectralResidual(img: ImageInput, gridW: number, gridH: number): Float32Array {
  const cols = isPow2(gridW) ? gridW : nextPow2(gridW);
  const rows = isPow2(gridH) ? gridH : nextPow2(gridH);
  const luma = downsampleLuma(img, cols, rows);
  hanningWindow(luma, rows, cols);

  // FFT
  const data = new Float64Array(cols * rows * 2);
  for (let i = 0; i < cols * rows; i++) {
    data[2 * i] = luma[i];
    data[2 * i + 1] = 0;
  }
  fft2d(data, rows, cols, false);

  // Amplitude / phase
  const amplitude = new Float32Array(cols * rows);
  const phase = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const re = data[2 * i];
    const im = data[2 * i + 1];
    amplitude[i] = Math.sqrt(re * re + im * im);
    phase[i] = Math.atan2(im, re);
  }

  // Log spectrum
  const logSpec = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) logSpec[i] = Math.log(amplitude[i] + 1.0001);

  // Average filter on the log spectrum (3x3 wrap-free, edge clamp).
  const avg = boxBlur(logSpec, cols, rows, 2);
  const residual = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) residual[i] = logSpec[i] - avg[i];

  // Reconstruct magnitude from exponentiated residual, keep original phase.
  const recon = new Float64Array(cols * rows * 2);
  for (let i = 0; i < cols * rows; i++) {
    const mag = Math.exp(residual[i]);
    recon[2 * i] = mag * Math.cos(phase[i]);
    recon[2 * i + 1] = mag * Math.sin(phase[i]);
  }
  fft2d(recon, rows, cols, true);

  const sal = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const re = recon[2 * i];
    const im = recon[2 * i + 1];
    sal[i] = re * re + im * im;
  }
  const blurred = boxBlur(sal, cols, rows, 3);
  const norm = normalize(blurred);

  // If grid sizes were padded to pow2, crop back to the requested grid.
  if (cols === gridW && rows === gridH) return norm;
  const out = new Float32Array(gridW * gridH);
  for (let r = 0; r < gridH; r++) {
    for (let c = 0; c < gridW; c++) {
      out[r * gridW + c] = norm[r * cols + c];
    }
  }
  return out;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Sobel edge magnitude, then local block density. Deterministic.
 */
export function edgeDensity(img: ImageInput, gridW: number, gridH: number): Float32Array {
  const luma = downsampleLuma(img, gridW, gridH);
  const mag = new Float32Array(gridW * gridH);
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const idx = y * gridW + x;
      const xl = clamp(x - 1, 0, gridW - 1);
      const xr = clamp(x + 1, 0, gridW - 1);
      const yt = clamp(y - 1, 0, gridH - 1);
      const yb = clamp(y + 1, 0, gridH - 1);
      const gx =
        -luma[yt * gridW + xl] + luma[yt * gridW + xr] -
        2 * luma[y * gridW + xl] + 2 * luma[y * gridW + xr] -
        luma[yb * gridW + xl] + luma[yb * gridW + xr];
      const gy =
        -luma[yt * gridW + xl] - 2 * luma[yt * gridW + x] - luma[yt * gridW + xr] +
        luma[yb * gridW + xl] + 2 * luma[yb * gridW + x] + luma[yb * gridW + xr];
      mag[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  const density = boxBlur(mag, gridW, gridH, 2);
  return normalize(density);
}

export function computeHeuristics(img: ImageInput, gridW: number, gridH: number): HeuristicMaps {
  const spectral = spectralResidual(img, gridW, gridH);
  const edges = edgeDensity(img, gridW, gridH);
  const { mean, variance, colorVariance, stdRaw } = downsampleMeanLumaAndVariance(img, gridW, gridH);
  const lumVar = normalize(variance);
  const colVar = normalize(colorVariance);

  // Readability penalty: busy, high-variance regions are hard to read over.
  // 0.5*lumVar + 0.3*edges + 0.2*colorVar, clamped to [0,1].
  const readability = new Float32Array(gridW * gridH);
  for (let i = 0; i < gridW * gridH; i++) {
    readability[i] = clamp(0.5 * lumVar[i] + 0.3 * edges[i] + 0.2 * colVar[i], 0, 1);
  }

  // Subject saliency is produced by the ONNX adapter normally; the heuristic
  // fallback reuses the sharpened spectral map so the softCost still has a
  // meaningful subject term without faking a detection.
  const subject = spectral.slice();
  for (let i = 0; i < subject.length; i++) subject[i] = subject[i] * subject[i];

  return {
    subjectSaliency: subject,
    spectralSaliency: spectral,
    edgeDensity: edges,
    readabilityPenalty: readability,
    luminanceVariance: lumVar,
    colorVariance: colVar,
    meanLuma: mean,
    lumaStdRaw: stdRaw,
    gridW,
    gridH
  };
}
