# Attention Wallpaper

A local-first Windows desktop app that projects user-curated text passages onto the desktop wallpaper, so personally meaningful ideas stay in view as low-distraction reminders.

## Language

**Passage**:
A text unit the user has selected from a Source Article because they deeply agree with it and want it to repeatedly remind them. Consists of one or more adjacent sentences — the selection atom is a sentence, and the user may extend a highlight across adjacent sentences to capture a complete idea. Typically shorter than a full paragraph, never a whole article.
_Avoid_: Quote, snippet, card, item

**Source Article**:
An article the user imports (from .docx/.txt/.md) whose contents they mine for Passages (e.g. Hamming's "You and Your Research" talk, notes from a teacher). The app preserves the Source Article as a browseable object so the user can read it in-app and select Passages by highlighting. Only paragraph-level structure is retained; inline styling (bold/italic/lists) is discarded — Passage layout on the wallpaper is plain-text anyway.
_Avoid_: Document, file, text

**Wallpaper**:
The desktop background image, imported by the user (PNG/JPG), onto which Passages are composited as plain text directly on the image — no card, no panel. The attention pipeline (saliency/edges/readability) exists precisely to make this plain-text overlay legible on arbitrary backgrounds. When contrast cannot reach WCAG ≥4.5:1, the layout degrades through the fallback ladder (reduce_count → reflow → translucent cards → safe rail) — translucent cards are a *degraded* mode, not the default. AI-generated wallpapers are out of scope for the MVP; the wallpaper is always a user-imported image.
_Avoid_: Background, backdrop

**Reminder** (vs. **Reading**):
The core verb of the product. A Passage goes on the wallpaper to *remind*, not to be *read* end-to-end. This distinction shapes layout density, rotation cadence, and what counts as "done" — the goal is repeated exposure to a condensed idea, not comprehension of a full text.
_Avoid_: Display, show

**Passage Typography**:
A single serif typeface (思源宋体 / Noto Serif SC) rendered as plain text on the wallpaper. Text color is auto-selected (pure white or pure black) by the readability pipeline to meet WCAG ≥4.5:1 against the local background. No user-facing font picker in the MVP.
_Avoid_: Card text, label

**Priority** (of a Passage):
A 3-level enum — 核心 (high, weight 3x) / 普通 (medium, weight 1x) / 偶尔 (low, weight 0.3x) — that biases selection toward higher-priority Passages during rotation. Combined with frequency (how long since last shown) and recency (when created) per the content-model.
_Avoid_: Weight, score, importance

**Attention Pipeline** (Heuristic vs ONNX):
The local pipeline that finds low-distraction regions on a wallpaper for Passage placement. Two tiers exist, both **active in the MVP**: (1) **Heuristic** — FFT spectral residual + Sobel edge density + luminance/color variance + readability penalty, always works, no dependencies; (2) **ONNX-enhanced** — U2-NetP (subject saliency), FaceDetLite (face detection), PP-OCRv6-tiny (existing-text detection), runs fully locally via ONNX Runtime. When the user has installed models in `models/` with a valid `manifest.json`, the ONNX tier runs and its results feed `softCost` (replacing/augmenting the heuristic subject-saliency term); when models are absent, the pipeline transparently falls back to heuristic-only. Models are user-installed (never auto-downloaded) per the privacy guarantee.
_Avoid_: Saliency, vision model, attention model

## Relationships

- A **Source Article** yields zero or more **Passages**
- A **Passage** originates from exactly one **Source Article**
- Exactly one **Passage** is composited onto a **Wallpaper** at a time (see ADR-0001)
- A rotation set (one Passage per monitor across N monitors) is drawn entirely from a single Source Article — all monitors in the same set show Passages from the same article, reinforcing one theme's exposure (see ADR-0016)
- When an article's Passage count is less than the monitor count, the surplus monitors keep their previous wallpaper state until the next rotation

## Flagged ambiguities

- README's content-model describes atomic "goals/questions/sentences" (≤1 sentence each, max 3 per monitor). The user's actual content unit is a **Passage** (a paragraph or section, potentially multi-sentence). Resolved: the canonical unit is **Passage**; the README model is a stale artifact to be reconciled.
