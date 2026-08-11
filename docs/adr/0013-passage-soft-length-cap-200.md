# Passage soft length cap at ~200 characters

A Passage exceeding ~200 Chinese characters triggers a non-blocking UI warning at highlight-promotion time: "段落较长，可能截断显示，是否继续？" The user may accept (Passage stored, layout may truncate to `maxLines` with ellipsis) or cancel and select a shorter span. No hard rejection. The `maxLines` default of 6 in `pretext-layout` stays unchanged.

## Why

~200 chars is the empirical fit for 6 lines of Noto Serif SC at wallpaper size — Hamming's most-quoted passages (e.g. the "value is in the struggle" paragraph, ~150 chars) fall comfortably inside. Longer passages are usually argumentation that resists repeated-exposure reminding. A hard cap (B) rejects legitimate "I want this whole paragraph" intent; raising `maxLines` (C) solves "does it fit" but creates a newspaper-wallpaper that violates 简洁美观. Silent truncation (D) hides the consequence. A soft warning (A) informs the user and respects their judgement.

## Consequences

- `articlesTab` highlight-promotion flow gains a length check: if `text.length > 200`, show a confirm dialog with the actual `maxLines`/chars-breakdown before storing.
- The `maxLines = 6` constant in `pretext-layout` is kept; no layout engine change.
- content-model `Passage` gains an optional `length_warned: boolean` to suppress re-warning on edits that don't change length.
