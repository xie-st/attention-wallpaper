import { describe, expect, it } from "vitest";
import {
  computeTextRegions,
  type GridRect,
  type ScreenSpec,
} from "./index";

const SCREEN: ScreenSpec = { colsM: 25, rowsN: 16 };

describe("computeTextRegions", () => {
  describe("scenario 1: empty desktop", () => {
    it("produces a single full-screen region with 1:1 ratio", () => {
      const regions = computeTextRegions(SCREEN, []);
      expect(regions).toHaveLength(1);
      const r = regions[0];
      expect(r.x).toBe(2); // page margin
      expect(r.y).toBe(2);
      expect(r.w).toBe(21); // 25 - 2*2
      expect(r.h).toBe(12); // 16 - 2*2
      expect(r.columnRatio).toEqual([1, 1]);
      expect(r.strayCells).toHaveLength(0);
    });
  });

  describe("scenario 2: icons densely on the left half", () => {
    it("produces one region on the right side, 1:1 ratio", () => {
      const icons: GridRect[] = [];
      for (let x = 0; x < 6; x++) {
        for (let y = 0; y < 12; y++) {
          icons.push({ gx: x, gy: y, gw: 1, gh: 1 });
        }
      }
      const regions = computeTextRegions(SCREEN, icons);
      expect(regions).toHaveLength(1);
      const r = regions[0];
      expect(r.x).toBe(8); // 6 (block end) + 2 (margin)
      expect(r.w).toBe(15); // 25-6-2*2
      expect(r.columnRatio).toEqual([1, 1]);
      expect(r.strayCells).toHaveLength(0);
    });
  });

  describe("scenario 3: sparse strays (left cluster + 2 right-area strays)", () => {
    it("detects strays and splits per their position", () => {
      const icons: GridRect[] = [
        { gx: 0, gy: 0, gw: 1, gh: 1 },
        { gx: 0, gy: 1, gw: 1, gh: 1 },
        { gx: 1, gy: 0, gw: 1, gh: 1 },
        { gx: 1, gy: 1, gw: 1, gh: 1 },
        { gx: 10, gy: 6, gw: 1, gh: 1 },
        { gx: 18, gy: 12, gw: 1, gh: 1 },
      ];
      const regions = computeTextRegions(SCREEN, icons);
      expect(regions).toHaveLength(1);
      expect(regions[0].strayCells.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("scenario 4: dense icon cluster", () => {
    it("degrades to 0 regions when no region is wide enough", () => {
      const icons: GridRect[] = [];
      for (let x = 0; x < 20; x++) {
        for (let y = 0; y < SCREEN.rowsN; y++) {
          if ((x * 7 + y * 3) % 3 !== 0) icons.push({ gx: x, gy: y, gw: 1, gh: 1 });
        }
      }
      const regions = computeTextRegions(SCREEN, icons);
      expect(regions).toHaveLength(0);
    });
  });

  describe("scenario 5: 40/60 split — icon at 40% of right area", () => {
    it("produces a 3:2 ratio (60/40) split from icon position", () => {
      const icons: GridRect[] = [
        { gx: 0, gy: 0, gw: 1, gh: 1 },
        { gx: 0, gy: 1, gw: 1, gh: 1 },
        { gx: 1, gy: 0, gw: 1, gh: 1 },
        { gx: 1, gy: 1, gw: 1, gh: 1 },
        { gx: 14, gy: 5, gw: 1, gh: 1 },
        { gx: 14, gy: 6, gw: 1, gh: 1 },
      ];
      const regions = computeTextRegions(SCREEN, icons);
      expect(regions).toHaveLength(1);
      expect(regions[0].columnRatio).toEqual([3, 2]);
      expect(regions[0].strayCells).toHaveLength(2);
    });
  });

  describe("edge case: six icons in a vertical column down the middle", () => {
    it("produces two regions left and right of the middle column", () => {
      // Vertical column at gx=12, gy=0..15 (fully blocked)
      const icons: GridRect[] = [];
      for (let y = 0; y < SCREEN.rowsN; y++) {
        icons.push({ gx: 12, gy: y, gw: 1, gh: 1 });
      }
      const regions = computeTextRegions(SCREEN, icons);
      // Left region (cols 0-11) and right region (cols 13-24), both after margin
      expect(regions.length).toBe(2);
      const [left, right] = regions;
      expect(left.x + left.w).toBeLessThanOrEqual(12);
      expect(right.x).toBeGreaterThanOrEqual(13);
    });
  });

  describe("edge case: diagonal icon trail — no false split", () => {
    it("treats a diagonal trail as sparse and stays in one region", () => {
      // Diagonal: (3,3), (6,6), (9,9), (12,12), (15,15) — one icon each
      const icons: GridRect[] = [
        { gx: 3, gy: 3, gw: 1, gh: 1 },
        { gx: 6, gy: 6, gw: 1, gh: 1 },
        { gx: 9, gy: 9, gw: 1, gh: 1 },
        { gx: 12, gy: 12, gw: 1, gh: 1 },
        { gx: 15, gy: 15, gw: 1, gh: 1 },
      ];
      const regions = computeTextRegions(SCREEN, icons);
      // Each affected column has only 1/N occupancy → all sparse, no blocked.
      // The whole screen is one sparse-tolerant region (sparseRate = 5/25 = 0.2 ≤ 0.3).
      expect(regions.length).toBe(1);
      expect(regions[0].strayCells.length).toBeGreaterThanOrEqual(4);
    });
  });
});
