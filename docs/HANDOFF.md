# Handoff — Attention Wallpaper MVP

**Session end**: after completing 2/10 tracer-bullet slices (#2 teardown, #5 layout-region). 8 slices remain.
**Repo**: https://github.com/xie-st/attention-wallpaper
**Latest commit**: 57ec1ee (Slice #5: packages/layout-region/ + tests)

## What this project is now

A local-first Windows desktop app that renders an article (imported as .docx/.txt/.md) as multi-column text directly on the desktop, with an AI pet walking across the text layer driving scroll progress. The product pivoted mid-session (ADR-0019) from the original "Passages on imported wallpaper" model to the current "transparent overlay + article-as-background + AI pet" model. Pre-pivot ADRs (0001–0018) are superseded but kept as historical record.

Authoritative source-of-truth documents (read these first):
- `CONTEXT.md` — domain glossary (Source Article / Overlay Window / Editor Window / Pet / Spritesheet / Pet Behavior State / Icon Rect / Text Region / Display Column / Scroll Progress / Solid Background). Vocabulary is binding.
- `docs/adr/0019` through `docs/adr/0024` — the live architectural decisions post-pivot. Read in order; later ADRs reference earlier.
- `docs/adr/0007`, `0009` — surviving pre-pivot ADRs (AI generation out of scope; remove 隐私 section).
- `docs/DEVELOPMENT_PLAN.md` — phased plan using mattpocock/skills pack + anthropics/frontend-design + vercel-labs/agent-skills. Phases 0–5 done; Phase 7 partially done.
- `docs/gap-analysis.md` + `docs/architecture-refactor.md` — pre-pivot analyses, marked historical. Still useful for understanding code shape but no longer prescriptive.
- `prototype/text-region/` — validated ADR-0022 algorithm; the pure module has been migrated to `packages/layout-region/`. The prototype `NOTES.md` documents the bug found + fix.
- `AGENTS.md` — skills-pack-aware contributor guide. Aesthetic directive (light theme `#FAFBFC` + sage/sky accent + Noto Sans SC chrome + Noto Serif SC on wallpaper + line icons + no shadows + no motion) is non-negotiable for MVP.
- `docs/agents/{issue-tracker,triage-labels,domain}.md` — skills config: GitHub Issues via `gh`, 5 triage labels.

## GitHub Issues state

- **#1** PRD (parent, open, ready-for-agent)
- **#2** Teardown — **DONE**, closed by commit 184ef1d
- **#3** SourceArticle schema + CRUD (Rust db + TS rewrite) — open, ready-for-agent, blocked by #2 (resolved)
- **#4** import_source_article command (docx/txt/md) — open, ready-for-agent, blocked by #3
- **#5** packages/layout-region/ computeTextRegions — **DONE**, closed by commit 57ec1ee
- **#6** get_desktop_icon_rects via UI Automation — open, ready-for-agent, blocked by #2 (resolved)
- **#7** PetBehavior state machine (pure TS) — open, ready-for-agent, blocked by #2 (resolved)
- **#8** pretextArticleLayout (extend pretext-layout, Pass 2 iteration) — open, ready-for-agent, blocked by #5 (resolved)
- **#9** Overlay Window: transparent + desktop-layer + Canvas render loop (HITL) — open, ready-for-human, blocked by #4, #6, #7, #8
- **#10** Editor Window rewrite: 内容 + 设置, light theme (HITL) — open, ready-for-human, blocked by #3, #6, #7
- **#11** Tray reduction to 2 actions + final wiring + tauri:build smoke — open, ready-for-agent, blocked by #9, #10

## Current repo state

### Tests passing
- `npx pnpm test` → 47 tests green (40 original after teardown + 7 new in @layout-region)
- `npx pnpm typecheck` → green
- `npx pnpm tauri:test` → 5 Rust tests green

### What was ripped out in slice #2
- `packages/ai-client/`, `mock-server/`, `tests/mock-server.test.ts`
- `src/sections/{Ai,Privacy,Display}Section.tsx`
- Dead `Settings` fields: `perMonitorMax`, `fontBody`, `fontDisplay`, `aiBaseUrl`, `deviceTokenFromKeychain`, `telemetry` (TS + Rust both stripped)
- `relayout` Tauri command + lib.rs registration
- Tightened `tauri.conf.json` CSP `connect-src` (dropped `127.0.0.1:*` + `localhost:*`)
- `mock:server` script + workspace entry

### What was added in slice #5
- `packages/layout-region/` (new package): `src/index.ts` exports `computeTextRegions`, `buildOccupancyGrid`, `columnOccupancyRate`, `classifyColumn`, `groupColumns`, `findDominantSparseCluster`, `DEFAULT_CONFIG` + types
- `packages/layout-region/src/index.test.ts`: 7 tests (5 prototype fixtures lifted + 2 new edge cases: vertical-middle, diagonal-trail)
- Path alias `@layout-region` added to `tsconfig.app.json` + `vitest.config.ts`
- Dead alias `@ai-client` removed from both

### What still needs cleanup (later slices)
- `packages/attention/` is still in the repo (not deleted per any slice yet — ADR-0019 says delete entirely). It's currently unused by App.tsx after teardown but tests still run. Slice #3 or a separate cleanup slice should remove it. (PRD issue #3 covers db rewrite; the attention-package deletion is implicitly part of the broader pivot but no explicit slice tackles it — recommend next-session agent adds it to slice #3 or creates a micro-slice.)
- `src/lib/compositor.ts` still exists with stale references to `ContentItem` / passage-composite logic — will be replaced/substantially rewritten by slice #9 (OverlayWindow). Don't try to clean it up before then.
- `src/sections/ContentSection.tsx` and `WallpaperSection.tsx` still exist (pre-pivot code) — will be rewritten by slice #10. They still type-check because `Settings` interface was kept shape-compatible (rotationIntervalMinutes + modelManifestDir only).
- `src-tauri/src/db.rs` schema still has the old `content` table — slice #3 will drop it and add `source_articles`.

## Next-session entry point

**Recommended first slice**: #7 (`PetBehavior` state machine). It's pure TS, independent of other in-progress work, well-specified in ADR-0020 + issue #7's acceptance criteria. The state-machine + Perlin-noise shape is fully defined in the issue body. About 1 hour of coding.

**Then**: #3 (`SourceArticle` schema + CRUD), #6 (UIA icon detection, Rust-heavy), #8 (pretextArticleLayout extension). These three are also independent of each other.

**HITL after AFK done**: #9 (Overlay Window — needs visual z-order verification) and #10 (Editor Window — needs aesthetic review against the 清新简约 directive). User wants to be asked for visual verification at this point.

**Last**: #11 (tray reduction + tauri:build smoke).

## Skills to use next session

- `tdd` — for every slice, red-green-refactor per the slice's acceptance criteria
- `diagnose` — when a test red is unexpected or integration breaks
- `obra/superpowers` pack (`systematic-debugging`, `verification-before-completion`) — already installed
- `anthropics/skills@frontend-design` + `vercel-labs/agent-skills` (`web-design-guidelines`, `vercel-react-best-practices`, `vercel-composition-patterns`) — load these before slice #10 (Editor UI rewrite). Aesthetic directive is light/clean/sage; line icons (lucide-react); no shadows/motion. Already documented in `AGENTS.md`.
- `grill-with-docs` — if any new architectural questions surface, grill them one-at-a-time and write to CONTEXT.md + new ADRs
- `write-a-skill` (Phase 9, optional) — if a workflow recurs 3+ times (e.g. "regenerate windows icon", "docx→sentence-segmentation round-trip"), capture it

## Conventions established in this session

- **Commit messages**: `Slice #N (closes #N): <overview>; <details>.` — GitHub auto-closes issues when `closes #N` is in the commit message.
- **PRs**: not used; pushing directly to `main`. User did not ask for PR workflow.
- **Force-push**: only for amending unmerged commits with fixes (used once after typecheck error in slice #5).
- **pnpm via npx**: `pnpm` not in PATH on this machine; use `npx pnpm <cmd>` instead.
- **PowerShell quoting**: `gh issue create --body "$var"` fails because PowerShell expands `$var` as array; use `--body-file <path>` instead.
- **Heredoc for issue bodies**: write body to `C:\Users\hiyad\Temp\<name>.md`, then `gh issue create --body-file <path>`.
- **Rust test command**: `npx pnpm tauri:test` = `cargo test --manifest-path src-tauri/Cargo.toml`. Compiles cold in ~50s; warm runs in ~5s.
- **Path aliases** (in `tsconfig.app.json` + `vitest.config.ts`): `@attention`, `@pretext-layout`, `@content-model`, `@layout-region`. `@ai-client` is gone. New packages need manual alias addition (workspace glob picks them up for pnpm but not for tsc/vitest path resolution).
- **Stale ADRs note**: ADR-0018 (rotation-orchestration split) was created mid-Phase-2 just before the pivot and is now superseded by ADR-0019. It's marked as superseded inside ADR-0019's table but the file itself wasn't edited. Reader should consult ADR-0019 first.
- **Sample .docx fixture**: `C:\Users\hiyad\Desktop\对自己说的话.docx` (Hamming's "You and Your Research" talk, ~77KB, 40+ paragraphs). Use as the slice #4 integration-test fixture.

## Specific gotchas the next agent should know

1. **The pivot was mid-Phase-2**. Pre-pivot work (gap analysis, architecture refactor, ADRs 0001–0018 except 0007/0009) describes a *different* product. Don't trust those docs for implementation guidance; trust ADR-0019 onwards + CONTEXT.md.

2. **Phase 2 grill produced 8 architecture-refactor candidates (1–8) but only #1+#3 were grilled (→ ADR-0018)** before the pivot voided them. The other 6 candidates in `docs/architecture-refactor.md` describe pre-pivot concerns (Passage selection, subject-saliency Adapter, etc.) that no longer apply. The post-pivot equivalent of "Text Region computation as a deep module" was already enacted via slice #5 (the `computeTextRegions` pure module). For the next set of deepening opportunities, run `improve-codebase-architecture` again post-pivot if needed — don't try to revive candidates 4–8.

3. **`packages/attention/` deletion**: ADR-0019 says delete entirely, but none of the 10 slices explicitly does it. Recommend: bundle it into slice #3 (the schema rewritetouches related areas) or open a micro-issue `#12: Delete packages/attention/` and close it as a 5-line PR.

4. **Windows-specific paths**: this project is Windows-first. The dev machine is `C:\Users\hiyad\...`. Tests run via `npx pnpm` (pnpm not in PATH). Rust via `cargo` directly.

5. **The `closes #N` auto-close is real**: GitHub closes the issue on commit push. To leave a closing comment, use `gh issue comment <N> --body "..."` *before* pushing the closing commit, or accept the auto-close without detailed comment.

6. **CONTEXT.md / AGENTS.md / docs/agents/** are the canonical entry-point docs. If a skill asks "where are the ADRs / where is the issue tracker" — `docs/agents/domain.md` has the answer. Don't re-run `setup-matt-pocock-skills`.

7. **No git config changes**: don't touch `git config`. The user is `xie-st` and pushes to `origin/main` over HTTPS via cached `gh` token.

## Suggested commit cadence for next session

Per slice: write code → run `npx pnpm typecheck` + `npx pnpm test` (TS slices) and/or `npx pnpm tauri:test` (Rust slices) → fix any errors → `git add -A && git commit -m "Slice #N (closes #N): <overview>" && git push`. Done.

HITL slices (#9, #10): same, but pause after push and ask the user to visually verify before closing the issue manually (these slices are `ready-for-human` so the auto-close via commit message should NOT be used — instead `gh issue close <N> --comment "..."` only after the user confirms it works).
