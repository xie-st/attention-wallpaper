# Rotation is time-driven with pause and persisted pending

**Passages** rotate on a fixed time cadence. When the desktop is not safe to disturb (the app cannot reliably detect this), pending rotations are persisted to SQLite and applied on the next explicit refresh or tray "下一组" action — they are never silently dropped or silently applied. A "暂停一小时" tray action pauses rotation for one hour.

## Why

The product's verb is **Reminder**, which requires *repeated exposure* — that demands Passages actually change on a cadence, not only when the user remembers to advance them. Pure-manual rotation (B) would let the wallpaper stagnate, defeating the purpose. But silently mutating the desktop while the user is in flow is hostile, hence the persisted-pending rule: the app commits to an intended rotation, and honesty about *not* auto-applying it is preserved from the README's existing limitation.

The cadence default and configurability are decided separately (see ADR-0003).

## Considered options

- **Time-driven + pause + persisted pending** (accepted) — README's current design; honest about the safe-to-distact limitation, ensures exposure cadence.
- **Pure time-driven, no pending** (A) — simpler but either mutates the desktop unpredictably or silently skips rotations; both are bad.
- **Pure manual "下一组"** (B) — user-controlled but stagnates; contradicts the Reminder verb.
- **Adaptive by Passage length** (D) — over-engineers a word-count→dwell-time mapping that does not match how reminders actually work (a 5-word anchor may need a week of dwelling).

## Consequences

- The existing `db.rs` rotation/pending persistence and tray "下一组" / "暂停一小时" actions stay as-is in shape.
- The rotation cadence is the only parameter left open; resolved in ADR-0003.
- Selection logic (priority/frequency/recency weighting) remains relevant — it picks the *next* Passage when a rotation fires.
- App launch applies a pending rotation if the cadence has elapsed since the last applied rotation (i.e., launch is treated as a "safe-to-disturb" moment that flushes pending rotations). If no rotation is due, the current wallpaper state is preserved. This reuses the existing pending-persistence path — no new mechanism. Launch-never-forces-rotation-only-flushes-due.
