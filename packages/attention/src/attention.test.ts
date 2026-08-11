import { describe, it, expect } from "vitest";
import {
  buildAttentionMap,
  proposeLayout,
  achievableContrast,
  contrastRatio,
  expandRect,
  expandRectPx,
  rasterizeHard,
  hardDistanceField,
  composeCost,
  computeHeuristics,
  type ImageInput,
  type HardExclusions
} from "./index";
;

function solidImage(w: number, h: number, r: number, g: number, b: number): ImageInput {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** Image split vertically: top half one color, bottom half black. */
// @ts-expect-error -- kept for reference but not used in current tests
function splitImage(w: number, h: number, top: [number, number, number]): ImageInput {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const c = y < h / 2 ? top : [0, 0, 0];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

describe("contrast helpers", () => {
  it("white on black is 21:1", () => {
    expect(contrastRatio(1, 0)).toBeCloseTo((1.05 / 0.05), 2);
  });
  it("mid-gray has high achievable contrast (adaptive black text)", () => {
    // With adaptive black/white text, mid-gray is readable via black text.
    const c = achievableContrast(0.5);
    expect(c).toBeGreaterThan(4.5);
  });
  it("near-crossover luma (~0.18) is the achievable-contrast minimum", () => {
    // The best of {black, white} text bottoms out near 4.58 around luma 0.18.
    const c = achievableContrast(0.18);
    expect(c).toBeGreaterThan(4.4);
    expect(c).toBeLessThan(4.8);
  });
  it("black background allows high contrast", () => {
    expect(achievableContrast(0.02)).toBeGreaterThan(4.5);
    expect(achievableContrast(0.98)).toBeGreaterThan(4.5);
  });
});

describe("rect expansion", () => {
  it("expandRect 15% grows about center", () => {
    const r = expandRect({ x: 10, y: 10, w: 100, h: 50 }, 0.15);
    expect(r.w).toBeCloseTo(115, 5);
    expect(r.h).toBeCloseTo(57.5, 5);
    expect(r.x).toBeCloseTo(10 - 7.5, 5);
  });
  it("expandRectPx adds px on each side", () => {
    const r = expandRectPx({ x: 10, y: 10, w: 100, h: 50 }, 12);
    expect(r).toEqual({ x: -2, y: -2, w: 124, h: 74 });
  });
});

describe("hard mask + distance field", () => {
  const gridW = 8, gridH = 8;
  const hard: HardExclusions = {
    icons: [],
    taskbar: { x: 0, y: 28, w: 32, h: 4 },
    faces: [],
    texts: []
  };
  // Image 32x32, taskbar covers bottom 4 px rows => grid rows 7 (last)
  const mask = rasterizeHard(hard, 32, 32, gridW, gridH);
  it("marks the taskbar cells", () => {
    let ones = 0;
    for (let i = 0; i < mask.length; i++) ones += mask[i];
    expect(ones).toBeGreaterThan(0);
  });
  it("distance field is 0 inside mask and grows away", () => {
    const dist = hardDistanceField(mask, gridW, gridH);
    let zeroCount = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] === 0) zeroCount++;
    expect(zeroCount).toBeGreaterThan(0);
    // top row should be far from the bottom taskbar
    expect(dist[0]).toBeGreaterThan(dist[gridW * (gridH - 1)]);
  });
});

describe("attention map baseline (no ONNX)", () => {
  it("produces a grid-sized cost map in [0,1]", () => {
    const img = solidImage(64, 64, 20, 30, 50);
    const { map } = buildAttentionMap(img, {
      hard: { icons: [], taskbar: null, faces: [], texts: [] }
    });
    expect(map.gridW).toBe(64);
    expect(map.gridH).toBe(36);
    expect(map.cost.length).toBe(64 * 36);
    for (const v of map.cost) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(map.onnxActive).toBe(false);
  });

  it("flags ONNX as inactive and warns about missing models", () => {
    const img = solidImage(64, 64, 30, 40, 60);
    const { map, diagnostics } = buildAttentionMap(img, {
      hard: { icons: [{ x: 0, y: 0, w: 8, h: 8 }], taskbar: null, faces: [], texts: [] }
    });
    expect(map.onnxActive).toBe(false);
    expect(map.components.some((c) => c.name === "subject_saliency" && !c.available)).toBe(true);
    expect(diagnostics.some((d) => d.code === "icons.fallback")).toBe(false);
    expect(diagnostics.some((d) => d.level === "warn")).toBe(true);
  });

  it("forces cost = 1 where a hard mask is present", () => {
    const img = solidImage(64, 64, 80, 80, 80);
    const { map } = buildAttentionMap(img, {
      hard: { icons: [{ x: 0, y: 0, w: 16, h: 16 }], taskbar: null, faces: [], texts: [] }
    });
    expect(map.hardMask[0]).toBe(1);
    expect(map.cost[0]).toBe(1);
  });

  it("busy half has higher mean cost than flat half", () => {
    // Left half: noise-ish high variance; Right half: flat.
    const w = 128, h = 72;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (x < w / 2) {
          const checker = ((x ^ y) & 1) * 255;
          data[i] = checker; data[i + 1] = checker; data[i + 2] = checker;
        } else {
          data[i] = 100; data[i + 1] = 100; data[i + 2] = 100;
        }
        data[i + 3] = 255;
      }
    }
    const img: ImageInput = { width: w, height: h, data };
    const { map } = buildAttentionMap(img, {
      hard: { icons: [], taskbar: null, faces: [], texts: [] },
      gridW: 32, gridH: 18
    });
    let leftSum = 0, rightSum = 0;
    for (let y = 0; y < map.gridH; y++) {
      for (let x = 0; x < map.gridW / 2; x++) leftSum += map.cost[y * map.gridW + x];
      for (let x = map.gridW / 2; x < map.gridW; x++) rightSum += map.cost[y * map.gridW + x];
    }
    const leftCells = (map.gridW / 2) * map.gridH;
    expect(leftSum / leftCells).toBeGreaterThan(rightSum / leftCells);
  });
});

describe("layout fallback", () => {
  it("places nothing when no items given", () => {
    const img = solidImage(64, 64, 80, 80, 80);
    const { map } = buildAttentionMap(img, { hard: { icons: [], taskbar: null, faces: [], texts: [] } });
    const res = proposeLayout(map, []);
    expect(res.placements).toEqual([]);
  });

  it("applies fallback on a busy mid-gray background (readability too low)", () => {
    // High-frequency checkerboard of mid-gray values: luminance contrast is
    // fine in principle, but the local readability penalty is high so the
    // effective contrast drops below 4.5:1 and the fallback ladder triggers.
    const w = 256, h = 144;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = ((x + y) & 1) ? 200 : 50;
        data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
      }
    }
    const img: ImageInput = { width: w, height: h, data };
    const { map } = buildAttentionMap(img, {
      hard: { icons: [], taskbar: null, faces: [], texts: [] },
      gridW: 32, gridH: 18
    });
    const res = proposeLayout(map, [
      { body: "测试目标一", priority: 3 },
      { body: "测试问题二", priority: 2 }
    ]);
    expect(res.placements.length).toBeGreaterThan(0);
    expect(res.usedFallback).toBe(true);
    for (const p of res.placements) expect(p.fallback).not.toBe("none");
  });

  it("respects the maxItems cap", () => {
    const img = solidImage(256, 144, 10, 10, 10); // dark, high contrast
    const { map } = buildAttentionMap(img, {
      hard: { icons: [], taskbar: null, faces: [], texts: [] },
      gridW: 32, gridH: 18
    });
    const res = proposeLayout(
      map,
      [
        { body: "一", priority: 3 },
        { body: "二", priority: 2 },
        { body: "三", priority: 1 },
        { body: "四", priority: 1 }
      ],
      { maxItems: 3 }
    );
    expect(res.placements.length).toBeLessThanOrEqual(3);
  });

  it("placements do not overlap each other", () => {
    const img = solidImage(256, 144, 10, 10, 10);
    const { map } = buildAttentionMap(img, {
      hard: { icons: [], taskbar: null, faces: [], texts: [] },
      gridW: 32, gridH: 18
    });
    const res = proposeLayout(
      map,
      [
        { body: "一", priority: 3 },
        { body: "二", priority: 2 },
        { body: "三", priority: 1 }
      ],
      { maxItems: 3 }
    );
    for (let i = 0; i < res.placements.length; i++) {
      for (let j = i + 1; j < res.placements.length; j++) {
        const a = res.placements[i].rect;
        const b = res.placements[j].rect;
        const overlap = !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("composeCost weights", () => {
  it("lowers effective subject weight when ONNX inactive", () => {
    const img = solidImage(64, 64, 80, 80, 80);
    const maps = computeHeuristics(img, 16, 9);
    const hardMask = new Uint8Array(16 * 9);
    const { components } = composeCost(maps, hardMask, undefined);
    const subj = components.find((c) => c.name === "subject_saliency")!;
    expect(subj.available).toBe(false);
    expect(subj.effectiveWeight).toBeLessThan(0.45);
  });
});
