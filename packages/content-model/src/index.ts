export type ContentKind = "goal" | "question" | "sentence";
export type Priority = "low" | "normal" | "high";
export type Frequency = "occasional" | "normal" | "frequent";

export interface ContentItem {
  id: string;
  kind: ContentKind;
  body: string;
  priority: Priority;
  startsAt: string | null;
  endsAt: string | null;
  frequency: Frequency;
  enabled: boolean;
}

export interface SelectionContext {
  /** ISO timestamp for "now". Injected for deterministic tests. */
  now: string;
  /** Items already chosen for other monitors in this rotation, to avoid repeats. */
  alreadyChosenIds: readonly string[];
  /** Per-item "last shown at" timestamps (ISO). */
  lastShown: Readonly<Record<string, string>>;
  /** Number of monitors still to fill in this rotation. */
  slotsRemaining: number;
}

export interface SelectionResult {
  selected: ContentItem[];
  /** Why each item was passed over, useful for diagnostics. */
  skipped: Array<{ id: string; reason: string }>;
}

export const PRIORITY_WEIGHT: Record<Priority, number> = {
  low: 1,
  normal: 2,
  high: 3
};

export const FREQUENCY_WEIGHT: Record<Frequency, number> = {
  occasional: 1,
  normal: 2,
  frequent: 3
};

const MS_PER_HOUR = 3_600_000;

/**
 * A content item is eligible to be shown if:
 *  - it is enabled
 *  - its body is non-empty (after trim)
 *  - the current time is within [startsAt, endsAt] (open-ended when null)
 *  - it is not already chosen for another monitor this rotation
 */
export function isEligible(item: ContentItem, ctx: SelectionContext): { ok: true } | { ok: false; reason: string } {
  if (!item.enabled) return { ok: false, reason: "disabled" };
  const body = item.body.trim();
  if (body.length === 0) return { ok: false, reason: "empty_body" };
  if (item.startsAt && Date.parse(ctx.now) < Date.parse(item.startsAt)) {
    return { ok: false, reason: "before_starts_at" };
  }
  if (item.endsAt && Date.parse(ctx.now) > Date.parse(item.endsAt)) {
    return { ok: false, reason: "after_ends_at" };
  }
  if (ctx.alreadyChosenIds.includes(item.id)) return { ok: false, reason: "repeat_within_rotation" };
  return { ok: true };
}

/** Hours since the item was last shown. Infinity if never shown. */
export function hoursSinceLastShown(item: ContentItem, ctx: SelectionContext): number {
  const last = ctx.lastShown[item.id];
  if (!last) return Number.POSITIVE_INFINITY;
  const diff = Date.parse(ctx.now) - Date.parse(last);
  if (Number.isNaN(diff)) return Number.POSITIVE_INFINITY;
  return diff / MS_PER_HOUR;
}

/**
 * Recency boost: items not seen for a long time get a higher boost. Uses a
 * logarithmic curve so the boost grows quickly at first then flattens.
 */
export function recencyBoost(hours: number): number {
  if (!Number.isFinite(hours)) return 10;
  if (hours <= 0) return 0;
  return 1 + Math.log2(1 + Math.min(hours, 24 * 14));
}

/**
 * Deterministic score used to rank eligible items. Higher is better.
 * Ties are broken by id so the order is stable across runs.
 */
export function scoreItem(item: ContentItem, ctx: SelectionContext): number {
  const priority = PRIORITY_WEIGHT[item.priority];
  const frequency = FREQUENCY_WEIGHT[item.frequency];
  const recency = recencyBoost(hoursSinceLastShown(item, ctx));
  return priority * 1.0 + frequency * 0.5 + recency * 1.2;
}

/**
 * Select at most `max` items per monitor, preferring high-priority, frequent,
 * and long-unseen items. Avoids repeats across monitors when enough eligible
 * items exist (the caller marks chosen items via `alreadyChosenIds`).
 *
 * `avoidRepeats` controls whether, when fewer eligible non-repeat items than
 * `max` exist, repeats are allowed (false) or skipped (true, the default).
 */
export function selectForMonitor(
  pool: readonly ContentItem[],
  ctx: SelectionContext,
  max: number
): SelectionResult {
  const skipped: Array<{ id: string; reason: string }> = [];
  const eligible: ContentItem[] = [];
  for (const item of pool) {
    const check = isEligible(item, ctx);
    if (check.ok) eligible.push(item);
    else skipped.push({ id: item.id, reason: check.reason });
  }

  const scored = eligible
    .map((item) => ({ item, score: scoreItem(item, ctx) }))
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));

  const selected = scored.slice(0, Math.max(0, max)).map((s) => s.item);
  for (const s of scored.slice(selected.length)) {
    skipped.push({ id: s.item.id, reason: "capped_at_max" });
  }
  return { selected, skipped };
}

/**
 * Selects content for every monitor in one rotation, advancing the
 * `alreadyChosenIds` set across monitors so we avoid cross-monitor repeats
 * as long as enough eligible items exist.
 */
export function selectForRotation(
  pool: readonly ContentItem[],
  now: string,
  monitorCount: number,
  perMonitor: number,
  lastShown: Readonly<Record<string, string>> = {}
): ContentItem[][] {
  const chosen: string[] = [];
  const perMonitorItems: ContentItem[][] = [];
  for (let m = 0; m < monitorCount; m++) {
    const ctx: SelectionContext = {
      now,
      alreadyChosenIds: chosen,
      lastShown,
      slotsRemaining: monitorCount - m
    };
    const { selected } = selectForMonitor(pool, ctx, perMonitor);
    for (const item of selected) chosen.push(item.id);
    perMonitorItems.push(selected);
  }
  return perMonitorItems;
}

export const ROTATION_INTERVAL_MS = 25 * 60_000;

/**
 * Pure scheduling helper. Given the last rotation timestamp and the current
 * time, returns whether a rotation is due and, if a rotation is pending but
 * the desktop is unsafe to disturb, the next time it should be retried.
 *
 * In the MVP we cannot reliably detect "desktop safe to disturb", so a pending
 * rotation is always returned and the caller (tray action) applies it on the
 * next explicit refresh. This is documented in the README limitations.
 */
export interface ScheduleDecision {
  due: boolean;
  pendingSince: string | null;
  nextAt: string | null;
}

export function evaluateSchedule(
  lastRotatedAt: string | null,
  now: string,
  intervalMs: number = ROTATION_INTERVAL_MS
): ScheduleDecision {
  if (!lastRotatedAt) {
    return { due: true, pendingSince: now, nextAt: now };
  }
  const last = Date.parse(lastRotatedAt);
  const current = Date.parse(now);
  if (Number.isNaN(last) || Number.isNaN(current)) {
    return { due: true, pendingSince: now, nextAt: now };
  }
  const elapsed = current - last;
  if (elapsed >= intervalMs) {
    const pendingSince = new Date(last + intervalMs).toISOString();
    return { due: true, pendingSince, nextAt: new Date(current).toISOString() };
  }
  return {
    due: false,
    pendingSince: null,
    nextAt: new Date(last + intervalMs).toISOString()
  };
}

/** Pause for one hour from `now`. */
export function pauseOneHour(now: string): string {
  return new Date(Date.parse(now) + MS_PER_HOUR).toISOString();
}

export interface ValidationError {
  field: keyof ContentItem | "body";
  message: string;
}

/** Validates a content item's user-editable fields. */
export function validateContentItem(input: Partial<ContentItem>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (input.body !== undefined) {
    const trimmed = input.body.trim();
    if (trimmed.length === 0) {
      errors.push({ field: "body", message: "正文不能为空" });
    } else if (trimmed.length > 280) {
      errors.push({ field: "body", message: "正文不能超过 280 字" });
    }
  }
  if (input.priority && !["low", "normal", "high"].includes(input.priority)) {
    errors.push({ field: "priority", message: "优先级无效" });
  }
  if (input.frequency && !["occasional", "normal", "frequent"].includes(input.frequency)) {
    errors.push({ field: "frequency", message: "频率无效" });
  }
  if (input.kind && !["goal", "question", "sentence"].includes(input.kind)) {
    errors.push({ field: "kind", message: "类型无效" });
  }
  if (input.startsAt && input.endsAt && Date.parse(input.startsAt) > Date.parse(input.endsAt)) {
    errors.push({ field: "startsAt", message: "开始时间不能晚于结束时间" });
  }
  return errors;
}

/** A clearly-tagged sample content set, separable from real user data. */
export const SAMPLE_CONTENT: ContentItem[] = [
  {
    id: "sample-goal-1",
    kind: "goal",
    body: "把今天最重要的一件事做完，再打开社交应用。",
    priority: "high",
    startsAt: null,
    endsAt: null,
    frequency: "frequent",
    enabled: true
  },
  {
    id: "sample-question-1",
    kind: "question",
    body: "此刻这件事，是在推进目标，还是在逃避困难？",
    priority: "normal",
    startsAt: null,
    endsAt: null,
    frequency: "normal",
    enabled: true
  },
  {
    id: "sample-sentence-1",
    kind: "sentence",
    body: "注意力是你最稀缺的资源。",
    priority: "normal",
    startsAt: null,
    endsAt: null,
    frequency: "occasional",
    enabled: true
  },
  {
    id: "sample-goal-2",
    kind: "goal",
    body: "十二周计划：完成第一篇可演示的原型。",
    priority: "high",
    startsAt: null,
    endsAt: null,
    frequency: "normal",
    enabled: true
  },
  {
    id: "sample-question-2",
    kind: "question",
    body: "如果只能保留三个待办，会留下哪三个？",
    priority: "low",
    startsAt: null,
    endsAt: null,
    frequency: "occasional",
    enabled: true
  }
];
