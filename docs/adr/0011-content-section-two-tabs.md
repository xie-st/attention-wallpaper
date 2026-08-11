# 内容 section is two tabs: 文章 / Passage 库

The "内容" section has two top-level tabs: **文章** (import + read + highlight Source Articles → promotes a span to a Passage) and **Passage 库** (list/imported Passages with priority, frequency/recency weights, and include-in-rotation toggle). Tabs switch the whole pane; only one tab is visible at a time.

## Why

Two distinct mental modes coexist in 内容: *reading-and-judging* (input state, mining Passages from a Source Article) and *curating-and-configuring* (output state, managing the Passage library's rotation behavior). Forcing both into one screen either cramps the layout (three-pane B on narrow Tauri windows) or splits the user's attention (A's bottom drawer). Separate tabs give each mode a full pane and stay legible at any window width. The flat single-stream (D) mixes two object types in one list and makes curation hard.

## Considered options

- **Two tabs: 文章 / Passage 库** (accepted) — clean mode separation, narrow-window-safe.
- **Two-pane: article list + reader, Passage库 as drawer** (A) — drawer splits attention; reader loses vertical space.
- **Three-pane IDE style** (B) — information-dense but breaks on narrow windows.
- **Single-stream** (D) — mixes object types; curation becomes painful.

## Consequences

- `src/sections/内容/` gains two child tab components: `ArticlesTab` and `PassageLibraryTab`.
- SQLite schema: `source_articles` table (id, title, author, imported_at, full_text) + `passages` table (id, source_article_id, span_start, span_end, text, priority, frequency_weight, recency_weight, included, created_at).
- Passage library tab default view: grouped by Source Article, Passages within each group sorted by priority desc. A view toggle switches to flat list sorted by priority desc across all articles. No other filter dimensions in the MVP.
- **Priority** is a 3-level enum: 核心 (high) / 普通 (medium) / 偶尔 (low), stored as an integer (3/2/1) on the `passages` row. Selection weight multipliers: 3x / 1x / 0.3x. No 5-star or slider — humans cannot meaningfully distinguish finer granularity.
