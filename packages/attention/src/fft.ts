/**
 * Minimal radix-2 Cooley-Tukey FFT (in-place). Size must be a power of two.
 * Operates on interleaved real/imag pairs (length = n*2). Used only for the
 * spectral-residual saliency heuristic on a small grid (64x64), so the O(n
 * log n) cost is tiny. Pure and deterministic.
 */

export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function bitReverse(n: number): number {
  let r = 0;
  let bits = 0;
  let tmp = n;
  while (tmp > 0) {
    bits++;
    tmp >>= 1;
  }
  for (let i = 0; i < bits; i++) {
    r = (r << 1) | ((n >> i) & 1);
  }
  return r;
}

/**
 * 1D in-place FFT on data[0..2n-1] where data[2k]=Re, data[2k+1]=Im.
 * inverse=true computes the inverse transform (with 1/n scaling).
 */
export function fft1d(data: Float64Array, inverse = false): void {
  const n = data.length / 2;
  if (!isPow2(n)) throw new Error(`fft1d: size ${n} is not a power of two`);
  // bit reversal
  for (let i = 0; i < n; i++) {
    const j = bitReverse(i);
    if (j > i) {
      const tr = data[2 * i];
      const ti = data[2 * i + 1];
      data[2 * i] = data[2 * j];
      data[2 * i + 1] = data[2 * j + 1];
      data[2 * j] = tr;
      data[2 * j + 1] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const theta = (sign * Math.PI) / half;
    const wr = Math.cos(theta);
    const wi = Math.sin(theta);
    for (let start = 0; start < n; start += size) {
      let curWr = 1;
      let curWi = 0;
      for (let k = 0; k < half; k++) {
        const ai = 2 * (start + k);
        const bi = 2 * (start + k + half);
        const tr = curWr * data[bi] - curWi * data[bi + 1];
        const ti = curWr * data[bi + 1] + curWi * data[bi];
        data[bi] = data[ai] - tr;
        data[bi + 1] = data[ai + 1] - ti;
        data[ai] += tr;
        data[ai + 1] += ti;
        const nextWr = curWr * wr - curWi * wi;
        curWi = curWr * wi + curWi * wr;
        curWr = nextWr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < 2 * n; i++) data[i] /= n;
  }
}

/** 2D FFT, rows then columns. data length = rows*cols*2 interleaved. */
export function fft2d(data: Float64Array, rows: number, cols: number, inverse = false): void {
  const rowBuf = new Float64Array(cols * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 2;
      rowBuf[2 * c] = data[i];
      rowBuf[2 * c + 1] = data[i + 1];
    }
    fft1d(rowBuf, inverse);
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 2;
      data[i] = rowBuf[2 * c];
      data[i + 1] = rowBuf[2 * c + 1];
    }
  }
  const colBuf = new Float64Array(rows * 2);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const i = (r * cols + c) * 2;
      colBuf[2 * r] = data[i];
      colBuf[2 * r + 1] = data[i + 1];
    }
    fft1d(colBuf, inverse);
    for (let r = 0; r < rows; r++) {
      const i = (r * cols + c) * 2;
      data[i] = colBuf[2 * r];
      data[i + 1] = colBuf[2 * r + 1];
    }
  }
}
