# Passage typography: single serif typeface, auto black/white

**Passages** render in a single serif typeface — **思源宋体 / Noto Serif SC** — at a size determined by the layout engine. Text color is auto-selected: the readability pipeline picks pure white or pure black per the local background region to satisfy WCAG ≥4.5:1. No font picker in the MVP.

## Why

The user chose serif (A) over sans-serif (B), valuing the contemplative tone of serif against the "tool-like" feel of sans — this matches the sedimentary intent of **Reminder** better than the maximum-legibility argument I made for sans. Noto Serif SC is the serif counterpart to Noto Sans SC: free, full-coverage, multi-weight, and the de-facto choice for Chinese serif on the web. Auto black/white keeps the pipeline honest (the readability penalty already computes which is safer) without the engineering cost of multi-color palettes (C). A font picker (D) adds UI surface for a single-user product where one good default is enough.

## Considered options

- **Single serif (Noto Serif SC) + auto black/white** (accepted) — user's choice; contemplative tone, honest contrast.
- **Single sans-serif (Noto Sans SC) + auto black/white** (my recommendation, rejected by user) — marginally more legible at small sizes but "tool-like" rather than sedimentary.
- **Multi-color palette** (C) — visually richer but engineering-heavy; defer.
- **User font picker** (D) — pushes the decision back onto the user; reject for MVP.

## Consequences

- `packages/pretext-layout` pins Noto Serif SC as the font; font file bundled locally (no network dependency, consistent with local-first).
- The readability pipeline's binary black/white choice stays as-is.
- Font size range and whether to add a safety outline/shadow under low-contrast backgrounds are deferred sub-decisions.
