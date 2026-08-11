import { describe, expect, it } from "vitest";
import { step, DEFAULT_CONFIG, ROW_BY_STATE, type PetBehaviorInput, type PetState } from "./pet-behavior";

const baseInput = (overrides: Partial<PetBehaviorInput> = {}): PetBehaviorInput => ({
  currentState: "idle",
  dt: 16,
  rng: Math.random,
  events: [],
  articleProgress: 0,
  ...overrides,
});

describe("PetBehavior step", () => {
  describe("tracer: idle + no events + dt=16ms", () => {
    it("returns a well-formed output object", () => {
      const out = step(baseInput());
      expect(out).toHaveProperty("nextState");
      expect(out).toHaveProperty("positionDelta");
      expect(out).toHaveProperty("currentRow");
      expect(typeof out.nextState).toBe("string");
      expect(typeof out.currentRow).toBe("number");
      expect(out.positionDelta).toHaveProperty("dx");
      expect(out.positionDelta).toHaveProperty("dy");
    });
  });

  describe("spritesheet row mapping (ADR-0020)", () => {
    it("ROW_BY_STATE constant matches the ADR-0020 row table", () => {
      expect(ROW_BY_STATE).toEqual({
        idle: 0,
        "drift-right": 1,
        "drift-left": 2,
        celebrate: 3,
        hop: 4,
        "end-of-article": 5,
        pause: 6,
        "walk-down": 7,
        "walk-up": 8,
      });
    });

    it("step output always satisfies currentRow === ROW_BY_STATE[nextState]", () => {
      const states: PetState[] = [
        "idle", "drift-right", "drift-left", "celebrate", "hop",
        "end-of-article", "pause", "walk-down", "walk-up",
      ];
      for (const s of states) {
        const out = step(baseInput({ currentState: s }));
        expect(out.currentRow).toBe(ROW_BY_STATE[out.nextState]);
      }
    });
  });

  describe("walk-down motion", () => {
    it("moves downward (dy > 0) on each tick", () => {
      let rng = 0.5;
      const out = step(baseInput({ currentState: "walk-down", rng: () => rng }));
      expect(out.positionDelta.dy).toBeGreaterThan(0);
    });
  });

  describe("reaching article end", () => {
    const cases: ReadonlyArray<[string, Partial<PetBehaviorInput>]> = [
      ["articleProgress >= 1.0", { articleProgress: 1.0, events: [] }],
      ["article-end event", { articleProgress: 0.5, events: ["article-end"] }],
    ];
    it.each(cases)("walk-down + %s → end-of-article", (_label, overrides) => {
      const out = step(
        baseInput({ currentState: "walk-down", ...overrides }),
      );
      expect(out.nextState).toBe("end-of-article");
    });
  });

  describe("article switch: end-of-article → celebrate → walk-down", () => {
    it("advances on double-click, holds celebrate for flourishMs, then resets", () => {
      const dt = 300;
      const config = { ...DEFAULT_CONFIG, flourishMs: 800 };

      const tick1 = step(
        baseInput({ currentState: "end-of-article", dt, events: ["double-click"] }),
        config,
      );
      expect(tick1.nextState).toBe("celebrate");
      expect(tick1.celebratedMs).toBe(dt);

      const tick2 = step(
        baseInput({
          currentState: "celebrate",
          dt,
          celebratedMs: tick1.celebratedMs,
        }),
        config,
      );
      expect(tick2.nextState).toBe("celebrate");
      expect(tick2.celebratedMs).toBe(dt * 2);

      const tick3 = step(
        baseInput({
          currentState: "celebrate",
          dt,
          celebratedMs: tick2.celebratedMs,
        }),
        config,
      );
      expect(tick3.nextState).toBe("walk-down");
      expect(tick3.articleSwitch).toBe(true);
      expect(tick3.celebratedMs).toBeUndefined();
    });
  });

  describe("rewind gesture", () => {
    it("walk-down + double-click → walk-up", () => {
      const out = step(
        baseInput({ currentState: "walk-down", events: ["double-click"] }),
      );
      expect(out.nextState).toBe("walk-up");
    });

    it("walk-up + article-start → walk-down", () => {
      const out = step(
        baseInput({ currentState: "walk-up", events: ["article-start"] }),
      );
      expect(out.nextState).toBe("walk-down");
    });
  });

  describe("pause saves walking state, resume restores it", () => {
    it.each(["walk-down", "walk-up"] as PetState[])(
      "%s → pause (savedWalkingState carried) → resume → %s",
      (walking) => {
        const tick1 = step(
          baseInput({ currentState: walking, events: ["pause"] }),
        );
        expect(tick1.nextState).toBe("pause");
        expect(tick1.savedWalkingState).toBe(walking);

        const tick2 = step(
          baseInput({
            currentState: "pause",
            events: ["resume"],
            savedWalkingState: tick1.savedWalkingState,
          }),
        );
        expect(tick2.nextState).toBe(walking);
        expect(tick2.savedWalkingState).toBeUndefined();
      },
    );
  });

  describe("noise-interleaved flavor states", () => {
    it("walk-down over 1000 ticks produces at least one drift-*/hop", () => {
      const states = new Set<PetState>();
      let state: PetState = "walk-down";
      const rng = () => 0.07;
      for (let i = 0; i < 1000; i++) {
        const out = step(baseInput({ currentState: state, rng }));
        states.add(out.nextState);
        state = out.nextState;
      }
      const flavors = ["drift-right", "drift-left", "hop"] as const;
      expect(flavors.some((f) => states.has(f))).toBe(true);
    });
  });

  describe("seeded reproducibility", () => {
    const makeRng = (seed: number) => () => {
      seed = (seed * 1664525 + 1013904223) % 0x100000000;
      return seed / 0x100000000;
    };

    it("same seed → identical positionDelta sequence across step calls", () => {
      const runOnce = () => {
        const rng = makeRng(42);
        let state: PetState = "walk-down";
        const deltas: { dx: number; dy: number }[] = [];
        for (let i = 0; i < 100; i++) {
          const out = step(baseInput({ currentState: state, rng }));
          deltas.push(out.positionDelta);
          state = out.nextState;
        }
        return deltas;
      };
      const first = runOnce();
      const second = runOnce();
      expect(second).toEqual(first);
    });
  });

  describe("average downward rate", () => {
    it("Σdy / Σdt over 1000 ticks is within ±20% of petRate", () => {
      const petRate = 50;
      const config = { ...DEFAULT_CONFIG, petRate };
      const makeRng = (seed: number) => () => {
        seed = (seed * 1664525 + 1013904223) % 0x100000000;
        return seed / 0x100000000;
      };
      const rng = makeRng(7);
      const dt = 16;
      let state: PetState = "walk-down";
      let sumDy = 0;
      let sumDt = 0;
      for (let i = 0; i < 1000; i++) {
        const out = step(baseInput({ currentState: state, dt, rng }), config);
        sumDy += out.positionDelta.dy;
        sumDt += dt;
        state = out.nextState;
      }
      const seconds = sumDt / 1000;
      const avg = sumDy / seconds;
      expect(avg).toBeGreaterThanOrEqual(petRate * 0.8);
      expect(avg).toBeLessThanOrEqual(petRate * 1.2);
    });
  });
});
