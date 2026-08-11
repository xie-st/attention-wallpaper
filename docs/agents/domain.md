# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary for this project's domain language (Passage, Source Article, Wallpaper, Reminder vs Reading, Priority, Attention Pipeline). Single-context repo; no `CONTEXT-MAP.md`.
- **`docs/adr/`** — architectural decision records. Read ADRs that touch the area you're about to work in. 0001–0017 cover the MVP design; later ADRs supersede earlier ones where noted.

If either of these files doesn't exist for a topic, **proceed silently**. Don't flag the absence; don't suggest creating them upfront. The producer skill (`grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/
│   ├── adr/                 ← 0001–0017 so far
│   ├── agents/              ← this file and siblings
│   ├── DEVELOPMENT_PLAN.md  ← phased execution plan
│   └── ...
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

Key terms to respect:
- **Passage** (not "quote", "snippet", "card", "item") — one or more adjacent sentences from a Source Article.
- **Source Article** (not "document", "file", "text") — the imported .docx/.txt/.md being mined for Passages.
- **Wallpaper** (not "background", "backdrop") — the desktop background image.
- **Reminder** vs **Reading** — the product verb; Passages *remind*, they aren't *read*.
- **Priority** — 3-level enum (核心/普通/偶尔), not a numeric weight or star rating.

If the concept you need isn't in the glossary yet, note it for `grill-with-docs` rather than inventing a synonym.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (AI generation out of scope) — but worth reopening because…_
