# Passages are authored by highlighting imported Source Articles

**Passages** enter the library by the user importing a **Source Article** (.docx/.txt/.md) into the app, reading it in-app, and highlighting a span of text to promote it to a Passage. There is no free-text Passage editor — all Passages are born from a Source Article. The Source Article is preserved as a first-class object (title, author, import date, full text) so every Passage traces back to its origin.

## Why

The user's real content sources are existing documents (articles like Hamming's talk, notes from teachers) — not freshly-typed one-liners. A highlight workflow matches how the user actually thinks about selection ("I deeply agree with this section, I want it to remind me") and preserves provenance, which a paste-or-type flow (A/D) destroys. Automatic splitting (C) would impose a segmenter's guess onto deeply subjective "what deserves to remind me" decisions, requiring post-hoc curation that negates the automation.

## Considered options

- **Import + manual highlight** (accepted) — matches real workflow, preserves provenance, respects subjective selection.
- **Free-text manual entry** (A, README's original model) — fits atomic one-liners but hostile to the user's docx-based reality.
- **Import + auto-split into candidate Passages** (C) — fast but the segmenter cannot judge "what I deeply agree with"; generates noise.
- **Paste + box-select** (D) — better than A but loses Source Article as a first-class object, breaking Passage→Source traceability.

## Consequences

- The "内容" section UI changes from a "type goals/questions/sentences" form to a two-pane: Source Article list + reader-with-highlight.
- A docx parser (e.g. mammoth.js) is a new dependency; txt/md are trivial.
- The content-model `ContentItem` type gains a `sourceArticleId` and `sourceSpan` (offset/length or paragraph refs) — free-text items are deprecated.
- README's "Create content — User authors goals/questions/sentences" step is superseded.
