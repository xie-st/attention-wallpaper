# One rotation set = one Source Article

A rotation set (the N Passages across N monitors in a single rotation) is drawn entirely from a single Source Article. All monitors show Passages from the same article in the same set — reinforcing one theme's repeated exposure. Cross-monitor repeats (the same Passage on two monitors) remain forbidden per ADR-0001.

When to rotate to the next Source Article, and how to pick Passages within an article when it has fewer Passages than monitors:

- **Article rotation cadence**: the content-model picks the next Source Article by the same priority/frequency/recency weighting, now applied at article level rather than Passage level.
- **Fewer Passages than monitors**: only fill the available monitors (e.g., 3 monitors but article has 2 Passages → 2 monitors get Passages, 1 monitor keeps its previous wallpaper state unchanged until next rotation).

## Why

The user's intent is *immersive single-theme exposure*, not multi-topic dispersion. Seeing 3 Passages from Hamming simultaneously reinforces one mindset; mixing Hamming + teacher's notes + a third article dilutes focus. This inverts the typical diversity heuristic (which I recommended in option B) but matches the product's Reminder verb — reminders work by hammering one idea, not parading ten.

Strict same-article (A) was chosen over "prefer same article, spill over when short" (B) because the user prefers keeping a theme coherent even at the cost of an under-filled set, rather than contaminating it with an off-topic Passage. Under-fill is honest: that monitor simply holds the previous Passage's wallpaper until the next rotation.

## Consequences

- content-model selection moves to article-level: pick next Source Article by deterministic top-1 score `score = priority_weight * (1 + 1/(1 + daysSinceLastShown))`, then pick up to N Passages from that article (priority desc within article). After selection, `lastShown` is updated, so the same article's score decays and other articles naturally rotate in. No weighted randomness.
- ADR-0001's "max 1 per monitor, no cross-monitor repeats" stays; the new constraint is "same Source Article across monitors in one set".
- Source Article gains its own priority field (核心/普通/偶尔, same 3-level enum as Passage) — applied to article-level rotation. **Default is 普通 (medium) on import; the user manually promotes specific articles (e.g. 老师的话) to 核心.** This avoids forcing a priority decision on every import while preserving the ability to express "this article matters more".
- Source Article gains a `lastShown` timestamp (updated each time the article is selected for a rotation set).
- When an article's Passage count < monitor count, the surplus monitors are untouched (no backfill from other articles).
- Passage-level priority / frequency / recency weights still determine *which* Passages of the chosen article go up, and in which monitor slot.
