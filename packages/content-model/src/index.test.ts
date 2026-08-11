import { describe, it, expect } from "vitest";
import {
  SAMPLE_CONTENT,
  ROTATION_INTERVAL_MS,
  evaluateSchedule,
  pauseOneHour,
  recencyBoost,
  selectForMonitor,
  selectForRotation,
  validateContentItem,
  type ContentItem,
  type SelectionContext
} from "./index";

const NOW = "2026-08-11T09:00:00.000Z";

function ctx(over: Partial<SelectionContext> = {}): SelectionContext {
  return {
    now: NOW,
    alreadyChosenIds: [],
    lastShown: {},
    slotsRemaining: 1,
    ...over
  };
}

function item(over: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "id-" + Math.random().toString(36).slice(2),
    kind: "goal",
    body: "默认正文",
    priority: "normal",
    startsAt: null,
    endsAt: null,
    frequency: "normal",
    enabled: true,
    ...over
  };
}

describe("selection", () => {
  it("respects the per-monitor cap", () => {
    const pool = SAMPLE_CONTENT.slice(0, 5);
    const { selected } = selectForMonitor(pool, ctx(), 3);
    expect(selected.length).toBe(3);
  });

  it("excludes disabled and empty-body items", () => {
    const pool = [
      item({ id: "a", enabled: false }),
      item({ id: "b", body: "   " }),
      item({ id: "c", body: "ok" })
    ];
    const { selected, skipped } = selectForMonitor(pool, ctx(), 3);
    expect(selected.map((i) => i.id)).toEqual(["c"]);
    expect(skipped.find((s) => s.id === "a")?.reason).toBe("disabled");
    expect(skipped.find((s) => s.id === "b")?.reason).toBe("empty_body");
  });

  it("prefers higher priority", () => {
    const pool = [
      item({ id: "low", priority: "low" }),
      item({ id: "high", priority: "high" }),
      item({ id: "normal", priority: "normal" })
    ];
    const { selected } = selectForMonitor(pool, ctx(), 1);
    expect(selected[0].id).toBe("high");
  });

  it("boosts long-unseen items", () => {
    const pool = [
      item({ id: "recent", priority: "high" }),
      item({ id: "ancient", priority: "normal" })
    ];
    const lastShown = {
      recent: "2026-08-11T08:00:00.000Z",
      ancient: "2026-07-01T00:00:00.000Z"
    };
    const { selected } = selectForMonitor(pool, ctx({ lastShown }), 1);
    expect(selected[0].id).toBe("ancient");
  });

  it("avoids repeats across monitors when enough items exist", () => {
    const pool = Array.from({ length: 6 }, (_, i) =>
      item({ id: "i" + i, priority: "normal", frequency: "normal" })
    );
    const rotation = selectForRotation(pool, NOW, 2, 3);
    const flat = rotation.flat();
    expect(flat.length).toBe(6);
    expect(new Set(flat.map((i) => i.id)).size).toBe(6);
  });

  it("honours time windows", () => {
    const pool = [
      item({ id: "future", startsAt: "2026-08-12T00:00:00.000Z" }),
      item({ id: "past", endsAt: "2026-08-01T00:00:00.000Z" }),
      item({ id: "live", startsAt: "2026-08-01T00:00:00.000Z", endsAt: "2026-08-31T00:00:00.000Z" })
    ];
    const { selected } = selectForMonitor(pool, ctx(), 3);
    expect(selected.map((i) => i.id)).toEqual(["live"]);
  });

  it("recencyBoost is monotonic", () => {
    expect(recencyBoost(0)).toBeLessThanOrEqual(recencyBoost(1));
    expect(recencyBoost(1)).toBeLessThan(recencyBoost(48));
    expect(recencyBoost(Number.POSITIVE_INFINITY)).toBeGreaterThan(recencyBoost(48));
  });
});

describe("scheduling", () => {
  it("fires immediately when never rotated", () => {
    const d = evaluateSchedule(null, NOW);
    expect(d.due).toBe(true);
    expect(d.pendingSince).toBe(NOW);
  });

  it("is not due before the interval elapses", () => {
    const last = "2026-08-11T08:40:00.000Z";
    const d = evaluateSchedule(last, NOW, ROTATION_INTERVAL_MS);
    expect(d.due).toBe(false);
    expect(d.pendingSince).toBeNull();
    expect(d.nextAt).toBe(new Date(Date.parse(last) + ROTATION_INTERVAL_MS).toISOString());
  });

  it("is due after the 25-minute interval", () => {
    const last = "2026-08-11T08:30:00.000Z";
    const d = evaluateSchedule(last, NOW, ROTATION_INTERVAL_MS);
    expect(d.due).toBe(true);
    expect(d.pendingSince).toBe("2026-08-11T08:55:00.000Z");
  });

  it("pauseOneHour returns now + 1h", () => {
    expect(pauseOneHour(NOW)).toBe("2026-08-11T10:00:00.000Z");
  });
});

describe("validation", () => {
  it("rejects empty body", () => {
    const e = validateContentItem({ body: "   " });
    expect(e.some((x) => x.field === "body")).toBe(true);
  });

  it("rejects body over 280 chars", () => {
    const e = validateContentItem({ body: "x".repeat(281) });
    expect(e.some((x) => x.field === "body")).toBe(true);
  });

  it("rejects startsAt > endsAt", () => {
    const e = validateContentItem({
      startsAt: "2026-08-12T00:00:00.000Z",
      endsAt: "2026-08-11T00:00:00.000Z"
    });
    expect(e.some((x) => x.field === "startsAt")).toBe(true);
  });

  it("rejects bad priority/frequency/kind", () => {
    expect(validateContentItem({ priority: "urgent" as never }).length).toBeGreaterThan(0);
    expect(validateContentItem({ frequency: "always" as never }).length).toBeGreaterThan(0);
    expect(validateContentItem({ kind: "todo" as never }).length).toBeGreaterThan(0);
  });

  it("accepts valid input", () => {
    expect(
      validateContentItem({
        body: "完成第一稿",
        priority: "high",
        frequency: "normal",
        kind: "goal"
      })
    ).toEqual([]);
  });
});
