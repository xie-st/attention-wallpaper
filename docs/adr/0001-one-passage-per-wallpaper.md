# One Passage per wallpaper

The core display unit is a single **Passage** composited onto one wallpaper. A multi-monitor setup shows one Passage per monitor, with no Passage repeated across monitors in the same set.

## Why

The product's core verb is **Reminder**, not **Reading**. Reminders work by focusing attention on one idea at a time — two Passages on the same surface dilute each other and contradict the "low-distraction region" premise the entire attention pipeline is built on. Passage lengths vary widely (a one-liner vs. a multi-paragraph argument), so multi-Passage layouts would force the layout system to solve a much harder problem than the README's original "≤3 short cards" model assumed. Multi-monitor setups already give the user 2-3 simultaneous Passages in peripheral view, which is enough.

## Considered options

- **1 Passage per wallpaper** (accepted) — single focus, simplest layout, multi-monitor gives natural multiplicity.
- **2-3 Passages per wallpaper** (rejected) — README's original model, designed for atomic one-liners; breaks for variable-length Passages and dilutes attention.
- **1 main Passage + 1 corner anchor quote** (deferred) — visual layering is appealing but doubles layout complexity; revisit only if single-Passage feels too sparse.

## Consequences

- README's "max 3 per monitor" becomes "max 1 per monitor"; the selection/rotation logic keeps its shape, only the per-monitor count changes.
- The layout engine focuses on placing and styling a single text block per wallpaper, which is far simpler than multi-card packing.
- "No cross-monitor repeats" still holds — the current set is N distinct Passages across N monitors.
