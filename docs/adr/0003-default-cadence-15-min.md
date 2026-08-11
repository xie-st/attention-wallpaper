# Default rotation cadence is 15 minutes, user-configurable

The wallpaper **Passage** rotates every 15 minutes by default. The interval is user-configurable in 设置, clamped to 5–120 minutes. The previous README default of 25 minutes is superseded.

## Why

The **Reminder** verb demands enough exposure frequency that a work session actually cycles through several Passages. At 15 minutes, an 8-hour workday yields ~32 exposures; the old 25-minute default yielded ~19. Passages are condensed ideas the user has already read and chosen — the goal is repeated surfacing, not sustained reading, so a shorter dwell is correct. 5–120 gives a sane range: 5 min for aggressive cycling, 120 min for "set it and forget it" days. The lower bound prevents an annoying flicker; the upper bound prevents effective stagnation.

## Consequences

- `packages/content-model` scheduling constant changes from 25 → 15 min.
- Settings UI gains a numeric interval field (number input or slider, 5–120 step 5).
- README Quick-start and Rotation section updated to reflect 15 min default.
- Pending-rotation persistence (ADR-0002) is agnostic to the interval value.
