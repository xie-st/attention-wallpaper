import { describe, expect, it } from "vitest";
import { stepVisibility, FADE_MS, type VisibilityInput } from "./visibility";

const baseInput = (overrides: Partial<VisibilityInput> = {}): VisibilityInput => ({
  foregroundIsDesktop: true,
  currentAlpha: 0,
  dt: 0,
  ...overrides,
});

describe("overlay visibility stepVisibility (ADR-0025)", () => {
  describe("tracer: foreground=desktop, alpha=0, dt=0 (no time yet)", () => {
    it("returns a well-formed output object with nextAlpha and shouldStepPet", () => {
      const out = stepVisibility(baseInput());
      expect(out).toHaveProperty("nextAlpha");
      expect(out).toHaveProperty("shouldStepPet");
      expect(typeof out.nextAlpha).toBe("number");
      expect(typeof out.shouldStepPet).toBe("boolean");
    });

    it("FADE_MS constant is 200 (ADR-0025 ~200ms both directions)", () => {
      expect(FADE_MS).toBe(200);
    });

    it("alpha stays at 0 when dt=0 (no time advanced)", () => {
      const out = stepVisibility(baseInput({ currentAlpha: 0, dt: 0 }));
      expect(out.nextAlpha).toBe(0);
      expect(out.shouldStepPet).toBe(false);
    });
  });

  describe("fade-in (foreground returns to desktop)", () => {
    it("alpha goes 0 -> 1 in exactly FADE_MS (200ms) when at full speed", () => {
      const out = stepVisibility(baseInput({ foregroundIsDesktop: true, currentAlpha: 0, dt: 200 }));
      expect(out.nextAlpha).toBeCloseTo(1, 6);
      expect(out.shouldStepPet).toBe(true);
    });

    it("alpha advances partially on partial dt (0 -> 0.5 at dt=100)", () => {
      const out = stepVisibility(baseInput({ foregroundIsDesktop: true, currentAlpha: 0, dt: 100 }));
      expect(out.nextAlpha).toBeCloseTo(0.5, 6);
      expect(out.shouldStepPet).toBe(true);
    });

    it("alpha saturates at 1 when already 1 (no overshoot)", () => {
      const out = stepVisibility(baseInput({ foregroundIsDesktop: true, currentAlpha: 1, dt: 100 }));
      expect(out.nextAlpha).toBe(1);
      expect(out.shouldStepPet).toBe(true);
    });

    it("alpha saturates at 1 even with huge dt (no overshoot)", () => {
      const out = stepVisibility(baseInput({ foregroundIsDesktop: true, currentAlpha: 0.5, dt: 2000 }));
      expect(out.nextAlpha).toBe(1);
      expect(out.shouldStepPet).toBe(true);
    });
  });

  describe("fade-out (foreground leaves desktop)", () => {
    it("alpha goes 1 -> 0 in exactly FADE_MS when leaving desktop", () => {
      const out = stepVisibility(baseInput({ foregroundIsDesktop: false, currentAlpha: 1, dt: 200 }));
      expect(out.nextAlpha).toBeCloseTo(0, 6);
    });

    it("alpha decreases partially on partial dt (1 -> 0.5 at dt=100)", () => {
      const out = stepVisibility(baseInput({ foregroundIsDesktop: false, currentAlpha: 1, dt: 100 }));
      expect(out.nextAlpha).toBeCloseTo(0.5, 6);
    });

    it("alpha saturates at 0 (no undershoot)", () => {
      const out = stepVisibility(baseInput({ foregroundIsDesktop: false, currentAlpha: 0, dt: 100 }));
      expect(out.nextAlpha).toBe(0);
      expect(out.shouldStepPet).toBe(false);
    });
  });

  describe("pet pause at alpha=0 boundary (ADR-0025)", () => {
    it("shouldStepPet flips false when alpha crosses 0 to exactly 0", () => {
      const out = stepVisibility(baseInput({
        foregroundIsDesktop: false,
        currentAlpha: 0.5,
        dt: 200,
      }));
      expect(out.nextAlpha).toBe(0);
      expect(out.shouldStepPet).toBe(false);
    });

    it("shouldStepPet stays true while alpha > 0 during fade-out", () => {
      const out = stepVisibility(baseInput({
        foregroundIsDesktop: false,
        currentAlpha: 1,
        dt: 150,
      }));
      expect(out.nextAlpha).toBeCloseTo(0.25, 6);
      expect(out.shouldStepPet).toBe(true);
    });

    it("shouldStepPet flips true when alpha rises above 0 from 0", () => {
      const out = stepVisibility(baseInput({
        foregroundIsDesktop: true,
        currentAlpha: 0,
        dt: 1,
      }));
      expect(out.nextAlpha).toBeGreaterThan(0);
      expect(out.shouldStepPet).toBe(true);
    });
  });
});
