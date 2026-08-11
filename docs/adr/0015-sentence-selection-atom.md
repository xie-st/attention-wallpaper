# Selection atom is a sentence; a Passage spans one or more adjacent sentences

In the 文章 tab reader, the user highlights text at sentence granularity: a click selects one sentence, and shift-click (or drag-extend) adds adjacent sentences to the same highlight. A Passage therefore always consists of whole sentences — never partial-sentence spans, never paragraphs-unless-the-paragraph-is-one-sentence. The browser's native text selection is *not* used; the reader applies sentence-boundary segmentation to the Source Article's plain text and treats each sentence as an atomic selectable unit.

## Why

The user chose sentence-level granularity over free-text selection. Sentence-as-atom guarantees Passages are complete thoughts (no mid-sentence cuts that mangle meaning), while multi-sentence extension preserves the ability to capture a full argument (a 2-3 sentence Passage — consistent with CONTEXT.md's "one or more adjacent sentences"). Free-text selection (C) would allow awkward partial-sentence highlights the user would later regret; paragraph-only (B) is too coarse when only one sentence in a paragraph matters. Two-step paragraph→sentence (D) adds an interaction step for no gain.

## Consequences

- `articlesTab` reader segments Source Article text into sentences (Chinese sentence boundaries: 。！？； + `\n`; English: `.` `!` `?` + `\n`).
- Selection model: click = single sentence; shift-click / drag-extend = adjacent sentences. Stored as `[startSentenceIndex, endSentenceIndex]` span, not character offsets.
- `passages` table stores `start_sentence_idx` + `end_sentence_idx` (not `span_start`/`span_end` character offsets) + the materialized `text` for convenience.
- ADR-0013's 200-char soft cap still applies — multi-sentence Passages that exceed 200 chars trigger the warning.
- Source Article import de-duplicates by filename: if a file with the same base name already exists, the app prompts "已存在，是否替换 / 保留两者？". Replace overwrites the text and invalidates Passage spans whose sentence indices exceed the new text's sentence count. Content-hash de-duplication is not implemented (over-engineering for a single-user MVP).
- A stored Passage is metadata-mutable but text-immutable: priority (核心/普通/偶尔) and `included` (rotation toggle) are editable in-place; the text and its sentence-span are not. To "change the text" a user deletes and re-highlights. This preserves the Passage-originates-from-Source-Article provenance guarantee.
- Deleting a Source Article cascades to its Passages, but a confirmation dialog first surfaces "将同时删除 N 条 Passage，确认？" — preventing accidental wipeout when re-importing a revised article. This respects the originates-from relationship (no orphan Passages) while guarding the destructive action.
