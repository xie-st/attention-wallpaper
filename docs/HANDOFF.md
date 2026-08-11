# Handoff — Attention Wallpaper MVP

**Session end**: 6/10 tracer-bullet slices done (#2 teardown, #5 layout-region, #7 PetBehavior, #3 SourceArticle, #6 UIA icon rects, #8 pretextArticleLayout). 4 remain (#9 HITL, #10 HITL, #11 wiring+build, #1 parent PRD).
**Repo**: https://github.com/xie-st/attention-wallpaper
**Latest commit**: `d87166e` (Slice #8: packages/pretext-layout/article-layout module + tests)

## What this project is now

A local-first Windows desktop app that renders an article (imported as .docx/.txt/.md) as multi-column text directly on the desktop, with an AI pet walking across the text layer driving scroll progress. The product pivoted mid-Phase-2 (ADR-0019) from the original "Passages on imported wallpaper" model to the current "transparent overlay + article-as-background + AI pet" model. Pre-pivot ADRs (0001–0018) are superseded but kept as historical record.

Authoritative source-of-truth documents (read these first — do not re-derive):
- `CONTEXT.md` — domain glossary (Source Article / Overlay Window / Editor Window / Pet / Spritesheet / Pet Behavior State / Icon Rect / Text Region / Display Column / Scroll Progress / Solid Background). Vocabulary is binding.
- `docs/adr/0019` through `docs/adr/0024` — the live architectural decisions post-pivot. Read in order; later ADRs reference earlier.
- `docs/adr/0007`, `0009` — surviving pre-pivot ADRs (AI generation out of scope; remove 隐私 section).
- `docs/DEVELOPMENT_PLAN.md` — phased plan using mattpocock/skills pack + anthropics/frontend-design + vercel-labs/agent-skills. Phases 0–5 done; Phase 7 partially done.
- `docs/gap-analysis.md` + `docs/architecture-refactor.md` — pre-pivot analyses, marked historical. Still useful for code shape but no longer prescriptive.
- `prototype/text-region/` — validated ADR-0022 algorithm; migrated to `packages/layout-region/`. The prototype `NOTES.md` documents the bug found + fix.
- `AGENTS.md` — skills-pack-aware contributor guide. Aesthetic directive (light theme `#FAFBFC` + sage/sky accent + Noto Sans SC chrome + Noto Serif SC on wallpaper + line icons + no shadows + no motion) is non-negotiable for MVP.
- `docs/agents/{issue-tracker,triage-labels,domain}.md` — skills config: GitHub Issues via `gh`, 5 triage labels.

## GitHub Issues state

- **#1** PRD (parent, open, ready-for-agent) — implicitly satisfied when #11 lands; close manually after #11
- **#2** Teardown — **DONE** (commit 184ef1d)
- **#3** SourceArticle schema + CRUD — **DONE** (commit 106f620)
- **#4** import_source_article command (docx/txt/md) — open, ready-for-agent, blocked by #3 (resolved)
- **#5** packages/layout-region/ computeTextRegions — **DONE** (commit 57ec1ee)
- **#6** get_desktop_icon_rects via UI Automation — **DONE** (commit 1542949; README limitation #4 noted in issue comment)
- **#7** PetBehavior state machine (pure TS) — **DONE** (commit b6f8ec6)
- **#8** pretextArticleLayout — **DONE** (commit d87166e)
- **#9** Overlay Window: transparent + desktop-layer + Canvas render loop (HITL) — open, ready-for-human, was blocked by #4/#6/#7/#8 — #6/#7/#8 now resolved; **only #4 still blocks** if the overlay needs an imported article to render. If the overlay can render against settings-only (solid bg + empty article list), #9 can start without #4.
- **#10** Editor Window rewrite: 内容 + 设置, light theme (HITL) — open, ready-for-human, blocked by #3/#6/#7 — **all resolved**. Can start any time.
- **#11** Tray reduction to 2 actions + final wiring + tauri:build smoke — open, ready-for-agent, blocked by #9, #10

## Current repo state

### Tests passing (verification-before-completion evidence as of d87166e)
- `npx pnpm test` → **44 tests green** (8 content-model + 7 layout-region + 14 pet-behavior + 8 article-layout + 7 pretext-layout; `packages/attention/` 17 tests gone with the package)
- `npx pnpm typecheck` (`tsc -b`) → green (exit 0)
- `npx pnpm tauri:test` (`cargo test`) → **13 tests green** (10 db + 3 windows collect_icon_rects)

### What was added this session (slices #7, #3, #6, #8)

**#7 `src/overlay/pet-behavior.ts`** (commit `b6f8ec6`): pure-TS state machine per ADR-0020. Exports `step(input, config?)` + `DEFAULT_CONFIG` + `ROW_BY_STATE` + types. 14 TDD vertical red-green tests cover all 9-state row mappings, every transition in ADR-0020 (walk-down→end-of-article, end-of-article→celebrate→walk-down+articleSwitch, walk-down+dblclick→walk-up, walk-up+article-start→walk-down, pause↔resume preserving saved walking state), noise-interleaved flavor states, seeded reproducibility, ±20% petRate invariant over 1000 ticks.

Interface decisions baked in (issue body didn't fully specify these):
- Config: `step(input, config?)` + exported `DEFAULT_CONFIG` (mirrors `@layout-region`'s pattern); second param optional, defaults to DEFAULT_CONFIG. Tests inject small petRate to verify rate invariant.
- Article progress reset on celebrate→walk-down: `Output.articleSwitch?: boolean` set true; caller resets articleProgress to 0 on next tick.
- Pause memory: `Input.savedWalkingState?` + `Output.savedWalkingState?` round-trip — step stays pure, caller persists + replays on next tick.
- Celebrate timing: accumulate dt ≥ `config.flourishMs`; elapsed ms carried via `Input.celebratedMs?` / `Output.celebratedMs?`.
- RNG: injected `rng: () => number`; module-internal value-noise (no Perlin dep). flavor picker extracted as `pickFlavor` helper after refactor.
- `currentRow`: `ROW_BY_STATE[state]` lookup; invariant test `out.currentRow === ROW_BY_STATE[out.nextState]` parameterized over all 9 states.

**#3 `src-tauri/src/db.rs` + `commands.rs` + `packages/content-model`** (commit `106f620`):
- `db.rs`: dropped `content` table + key/value `settings` table; new `source_articles { id TEXT PK, title TEXT, plain_text TEXT, paragraphs_json TEXT, imported_at INTEGER }` and column-based `settings` singleton `{ id=1, background_color, pet_package_id, pet_rate, pet_paused }`. CRUD: `list_source_articles` (sorted by imported_at), `create_source_article`, `delete_source_article(id) → bool` (confirmation flag).
- `commands.rs`: `list_source_articles` / `create_source_article(input)` (validates non-empty title/plainText) / `delete_source_article(id) → { removed }`. `get_settings`/`set_settings` rewritten against the typed column schema; `SettingsDto` carries the 4 ADR-0019 fields. Legacy `list_content`/`save_content`/`delete_content` commands deleted.
- `lib.rs`: invoke_handler updated — `list_content`/`save_content`/`delete_content` removed.
- `packages/content-model/src/index.ts`: rewritten. Exports `SourceArticle`, `CreateArticleInput`, `validateArticle`, `splitParagraphs`, `newArticle`, `ValidationError`. All old exports gone (`ContentItem`/`Passage`/`Priority`/`Frequency`/`selectForRotation`/`planRotationSet`/`evaluateSchedule`/`pauseOneHour`/`validateContentItem`/`ROTATION_INTERVAL_MS`/`SAMPLE_CONTENT`). 8 TDD tests.
- `src/lib/tauri.ts`: bridge exposes `listSourceArticles()`, `createArticle(input)`, `deleteArticle(id) → {removed}`. `Settings` interface re-typed to `{ backgroundColor, petPackageId, petRate, petPaused }`. Legacy `listContent`/`saveContent`/`deleteContent` bridge methods gone.
- **`packages/attention/` deleted entirely** per ADR-0019 + HANDOFF gotcha #3 (ADR-0019 §2 mandates deletion; no slice explicitly did it — bundled into #3 to clear the dead reference). Path alias `@attention` removed from `tsconfig.app.json` + `vitest.config.ts`.

**#6 `src-tauri/src/platform/windows.rs`** (commit `1542949`): the `Err("...not available in this build")` stub replaced with a real UIA walk via the `uiautomation = "0.16"` crate (`Cargo.toml` updated). Walks desktop → `SHELLDLL_DefView` → `SysListView32` children, reads each `BoundingRectangle`. Returns `Vec<Rect>` (physical screen coords). Empty/degraded cases return empty `Vec` per ADR-0022 ladder. The pure rect-conversion extracted as `collect_icon_rects(&[(f64, f64, f64, f64)]) -> Vec<Rect>` so the conversion is unit-testable with a mock fixture without standing up a real UIA tree (3 tests, satisfying issue #6's mock-tree criterion). Real UIA calls naturally only run on Windows; non-Windows falls through at `#[cfg(not(windows))]` in `mod.rs`.

Also fixed a latent bug in `mod.rs`: `IconRectsResult.diagnostic` was formatting the `source` string ("uiautomation" / "fallback") where it meant `rects.len()`; count now captured before the move into the result struct.

**#8 `packages/pretext-layout/src/article-layout.ts`** (commit `d87166e`): pure function `pretextArticleLayout(article, regions, baseFontSpec, opts) -> LaidOutArticle` per ADR-0022 Pass 2. Iterates font size ±1px (clamped to [18, 36], max 3 iterations) to drive whitespace ratio (text area / region area) into [0.35, 0.65]. Family pinned to `Noto Serif SC` per ADR-0006 regardless of `baseFontSpec.family`. Per-column maxLines derived from region height; text consumed sequentially across regions (multi-region distribution in order). `filterStrayIntersections` drops any line whose bbox intersects a `strayCells` entry. Scroll: `visibleStartY = clamp(petScrollProgress * max(0, totalHeight - viewportHeight), 0, scrollable)`. 8 TDD tests: empty regions / single short / single long (scrollable) / multi-region distribution / stray-cell padding / progress boundaries (0 and 1) / font pinning. New symbols re-exported from `packages/pretext-layout/src/index.ts`.

### What still needs cleanup (next slices own these)

- **#4 import_source_article (docx/txt/md)** — still open. The Rust + TS CRUD exists (slice #3) but no importer. Blocks **only** if the overlay window (#9) needs an actual article present to demo; it can ship without if `bridge.listSourceArticles()` returning `[]` is acceptable for the visual-verification step.
- **`src/lib/compositor.ts`** — stubbed to throw `voided per ADR-0019` (3-line file with type-only exports + throwing functions). `decodeImage` and `composite` are no-ops. Slice #9 (OverlayWindow) either rewrites `compositor.ts` for the canvas-render loop or replaces its call-sites entirely; the stub is intentionally there to keep `tsc -b` green between slices.
- **`src/sections/ContentSection.tsx` + `src/sections/WallpaperSection.tsx`** — stubbed to placeholder `<section>` elements ("will be rewritten by slice #10"). `WallpaperSection` now takes `content: SourceArticle[]` (not the dead `ContentItem[]`); the stub still ignores it. Slice #10 replaces both with the real 内容 + 设置 UI per ADR-0019.
- **`src/App.tsx`** — still uses the old two-section nav (`content` / `wallpaper`) with the line-icon glyphs (✎/▣). Slice #10 collapses to the ADR-0019 layout (内容 + 设置) and trims the `models`/`monitors` sidebar chrome that referenced ADR-0017's ONNX diagnostics (void per pivot).
- **`tray.rs`** — still has the pre-pivot menu structure (two actions per ADR-0023 but the labels/listeners in `App.tsx` still call `nextSet` + `pauseOneHour`, which themselves are no longer meaningful in the pet-driven model). Slice #11 will collapse to the exact two actions (`打开编辑器` / `退出`) per ADR-0023 + remove the now-dead command registrations (`next_set`, `pause_one_hour`, `get_rotation_state`, `set_rotation_state`) from `lib.rs` if they're no longer used.
- **`commands.rs`** still registers `get_rotation_state`, `set_rotation_state`, `next_set`, `pause_one_hour`, `get_models_status`, `apply_wallpaper`, `restore_wallpaper`, `get_wallpaper_profile`, `set_wallpaper_profile` — most are vestigial (rotation is gone per ADR-0019; model status with no ONNX always returns unavailable; wallpaper apply/restore still useful to set the solid bgcolor once at setup). Audit + prune in slice #11.
- **`packages/content-model/src/index.ts`** exports are clean. No `Passage`/`Priority`/etc references anywhere — verified by `grep` (only matches are inside `docs/adr/` historical text + this HANDOFF).

## Next-session entry point

**Slice #9 (Overlay Window)** is the next slice. It's `ready-for-human` so the workflow is:
1. AFK-able implementation work (transparent window config, Canvas render loop, PetBehavior integration, pretextArticleLayout integration, icon-rect avoidance through `computeTextRegions`).
2. Follow `verification-before-completion` skill — `npx pnpm typecheck` + `npx pnpm test` + `npx pnpm tauri:build` (or at least `tauri:dev`) must pass before push.
3. Push to `main` WITHOUT `closes #9` in the commit message. Add a `gh issue comment 9 --repo xie-st/attention-wallpaper --body-file <visual-verification-checklist.md>` describing exactly what the human must visually confirm (transparent window z-order per ADR-0024, pet animation visible when at desktop, covered by foreground windows when working, text columns positioned per ADR-0022, double-click gesture works).
4. Wait for human visual confirmation.
5. Only then: `gh issue close 9 --repo xie-st/attention-wallpaper --comment "Verified by user."`

If during #9 design a non-trivial z-order / window-stacking question arises (Windows' `SetWindowPos` / `WS_EX_TOOLWINDOW` / desktop-layer interplay), load the `brainstorming` skill first to walk the design space, then write the chosen approach as ADR-0025 (or extend ADR-0024). Do NOT silently commit a z-order implementation without an ADR — that's the load-bearing visual decision of the whole product. If the design is uncertain enough that you want a throwaway runnable check first, use the `prototype` skill (terminal-runnable app branch) to validate the z-order API calls before committing them to the real overlay.

**Then #10 (Editor Window rewrite)** — `ready-for-human`, same HITL flow. All blockers resolved (#3/#6/#7 done). Use the `anthropics/skills@frontend-design` + `vercel-labs/agent-skills` (`web-design-guidelines`, `vercel-react-best-practices`, `vercel-composition-patterns`) skills; aesthetic directive in AGENTS.md is non-negotiable (light/clean/sage, line icons via `lucide-react`, no shadows, no motion). Replace the stubbed `ContentSection.tsx` + `WallpaperSection.tsx` + the old two-section nav in `App.tsx` with the ADR-0019 layout: 内容 (flat article list + import button — which depends on #4 if a real importer is wanted; otherwise seed with `bridge.createArticle`) and 设置 (background color picker + pet package + pet rate slider + pet pause toggle + 关于 footer).

**Last: #11** (tray reduction to 2 actions + final wiring + tauri:build smoke). After completing, follow the `finishing-a-development-branch` skill (adapted: per HANDOFF conventions we push directly to `main`, so the "options 1/2/3" menu collapses to running `npx pnpm tauri:build` for smoke + updating `docs/HANDOFF.md` to "10/10 slices done" + closing #1 manually).

## Skills to use next session

- `verification-before-completion` — IRON LAW. No completion claim without fresh verification evidence. Runs before every commit/push, and again after push for the HITL slices.
- `tdd` — vertical red-green, one test at a time, no horizontal slicing. Used for all four slices this session (#7 / #3 / #6 / #8); reuse for #4 if it comes up and for any pure logic in #10.
- `diagnose` — when a test red is unexpected or integration breaks. Multi-stage reproduce→minimise→hypothesise→instrument→fix→regression-test.
- `brainstorming` — if a non-trivial design question surfaces for #9 (z-order, render-loop lifecycle) or #10 (section composition). HARD-GATE: do not write any implementation code until the design is presented and user-approved.
- `prototype` — if #9's z-order / window-stack approach needs a throwaway validation before committing to the real overlay. Run a small Tauri experiment that just opens a transparent window at the desktop layer and confirms it's covered by foreground windows — before folding it into overlay/.
- `grill-with-docs` — if any new architectural question surfaces for #9 implementation, grill it one-at-a-time and write to CONTEXT.md + new ADR (ADR-0025+).
- `anthropics/skills@frontend-design` + `vercel-labs/agent-skills` (`web-design-guidelines`, `vercel-react-best-practices`, `vercel-composition-patterns`) — load before #10 (Editor UI rewrite). Aesthetic directive is light/clean/sage; line icons (lucide-react); no shadows/motion. Already documented in `AGENTS.md`.
- `finishing-a-development-branch` — at the very end after #11's `tauri:build` smoke. Adapted for direct-to-main workflow (skip option 1 merge, skip option 2 PR; equivalent is "tests green + build green → push → done").
- `handoff` — update this file at session end.
- `write-a-skill` (optional, Phase 9) — if a workflow recurs 3+ times (e.g. "regenerate windows icon cache", "docx→sentence-segmentation round-trip"), capture it.

## Conventions established (this session + prior)

- **Commit messages**: `Slice #N (closes #N): <overview>; <details>.` — GitHub auto-closes issues when `closes #N` is in the commit message. **HITL slices (#9, #10) use `Slice #N: <overview>` WITHOUT `closes #N`** — auto-close is deferred until the human verifies; close manually via `gh issue close <N> --comment "Verified by user."` after verification.
- **PRs**: not used; pushing directly to `main`. User did not ask for PR workflow.
- **Force-push**: only for amending unmerged commits with fixes (used once after typecheck error in slice #5).
- **pnpm via npx**: `pnpm` not in PATH on this machine. HANDOFF originally said `npx pnpm <cmd>`. **Gotcha update this session:** pnpm 11's `verifyDepsBeforeRun` check can block `npx pnpm <cmd>` with `[ERR_PNPM_IGNORED_BUILDS]` on esbuild. Workaround that works without re-installing: invoke vitest/tsc directly via node, e.g. `node node_modules/vitest/vitest.mjs run [pattern]` and `node node_modules/typescript/bin/tsc -b --pretty`. Same test/tc paths, skips the deps check. Cargo unaffected (`cargo test --manifest-path src-tauri/Cargo.toml` works as-is).
- **PowerShell quoting**: `gh issue create --body "$var"` fails because PowerShell expands `$var` as array; use `--body-file <path>` instead. **Also**: do not write multi-line commit messages inline with `;` separators in PowerShell — `;` is the command separator and will produce `error: pathspec 'typecheck' did not match any file(s)` because PowerShell splits the line. Write the message to `C:\Users\hiyad\AppData\Local\Temp\opencode\aw-slice<N>-commit.txt` and `git commit -F <path>`. Same for `gh issue comment --body-file`.
- **Rust test command**: `cargo test --manifest-path src-tauri/Cargo.toml` (the `npx pnpm tauri:test` script wraps this but pnpm 11 may block — call cargo directly). Compiles cold in ~50s; warm runs in ~5s.
- **Path aliases** (in `tsconfig.app.json` + `vitest.config.ts`): `@pretext-layout`, `@content-model`, `@layout-region`, `@` (→ `src`). `@ai-client` gone (slice #5), `@attention` gone (slice #3). New packages need manual alias addition (workspace glob picks them up for pnpm but not for tsc/vitest path resolution).
- **Stale ADRs note**: ADR-0018 (rotation-orchestration split) was created mid-Phase-2 just before the pivot and is now superseded by ADR-0019. It's marked as superseded inside ADR-0019's table but the file itself wasn't edited. Reader should consult ADR-0019 first.
- **Sample .docx fixture**: `C:\Users\hiyad\Desktop\对自己说的话.docx` (Hamming's "You and Your Research" talk, ~77KB, 40+ paragraphs). Use as the slice #4 integration-test fixture.
- **`docs/superpowers/specs/`**: brainstorming skill writes design docs here. If you brainstorm #9's z-order approach, the spec lands at `docs/superpowers/specs/YYYY-MM-DD-overlay-z-order-design.md` — commit it.

## Specific gotchas the next agent should know

1. **The pivot was mid-Phase-2**. Pre-pivot work (gap analysis, architecture refactor, ADRs 0001–0018 except 0007/0009) describes a *different* product. Don't trust those docs for implementation guidance; trust ADR-0019 onwards + CONTEXT.md.

2. **Phase 2 grill produced 8 architecture-refactor candidates (1–8) but only #1+#3 were grilled (→ ADR-0018)** before the pivot voided them. The other 6 candidates in `docs/architecture-refactor.md` describe pre-pivot concerns (Passage selection, subject-saliency Adapter, etc.) that no longer apply. The post-pivot equivalent of "Text Region computation as a deep module" was enacted via slice #5 (the `computeTextRegions` pure module). For the next set of deepening opportunities, run `improve-codebase-architecture` again post-pivot if needed — don't try to revive candidates 4–8.

3. **`packages/attention/` deletion — DONE** (slice #3 this session, commit `106f620`). No longer a gotcha. The deletion is recorded in the issue-3 commit body. ADR-0019 §2 mandate satisfied.

4. **Windows-specific paths**: this project is Windows-first. The dev machine is `C:\Users\hiyad\...`. Tests run via `npx pnpm` (pnpm not in PATH) OR directly via `node node_modules/vitest/vitest.mjs` (see "pnpm via npx" convention above for the pnpm 11 gotcha). Rust via `cargo` directly.

5. **The `closes #N` auto-close is real**: GitHub closes the issue on commit push. To leave a closing comment, use `gh issue comment <N> --body "..."` *before* pushing the closing commit, or accept the auto-close without detailed comment. **For HITL slices (#9, #10): omit `closes #N` from the commit message**, push, leave a verification-checklist comment, wait for user confirmation, then `gh issue close <N> --comment "Verified by user."` — see "Next-session entry point" above.

6. **CONTEXT.md / AGENTS.md / docs/agents/** are the canonical entry-point docs. If a skill asks "where are the ADRs / where is the issue tracker" — `docs/agents/domain.md` has the answer. Don't re-run `setup-matt-pocock-skills`.

7. **No git config changes**: don't touch `git config`. The user is `xie-st` and pushes to `origin/main` over HTTPS via cached `gh` token.

8. **`packages/pretext-layout/src/index.ts` re-exports** `pretextArticleLayout` + its constants (`ARTICLE_FONT_FAMILY`, `MIN_FONT_SIZE`, `MAX_FONT_SIZE`, `WHITESPACE_MIN`, `WHITESPACE_MAX`, `MAX_ITERATIONS`) + types (`LaidOutArticle`, `LaidOutColumn`, `PretextArticleLayoutOptions`, `RectLike`) from `./article-layout`. Import from `@pretext-layout`, not the deep path.

9. **`PetBehaviorInput` / `PetBehaviorOutput` carry cross-tick state via optional fields** (`savedWalkingState`, `celebratedMs`). The caller (overlay render loop in #9) MUST round-trip these: read `Output.savedWalkingState` → store → pass back as `Input.savedWalkingState` on the next tick. Same for `celebratedMs`. Forgetting this breaks pause-resume and celebrate-timer. The `step` function is intentionally pure (no internal state); purity depends on the caller replaying state.

10. **`src/lib/compositor.ts` is intentionally a throwing stub** since slice #3. `decodeImage` / `composite` throw on call. Do NOT try to "fix" them — slice #9 either rewrites them for the canvas-render loop or removes the call-sites entirely. The stub exists only so `tsc -b` stays green between slices.

11. **`packages/content-model` no longer exports `ContentItem`, `Passage`, `Priority`, `Frequency`, `ContentKind`, `SAMPLE_CONTENT`, `ROTATION_INTERVAL_MS`, `validateContentItem`, `selectForRotation`, `planRotationSet`, `evaluateSchedule`, `pauseOneHour`, `selectForMonitor`, `isEligible`, `hoursSinceLastShown`, `scoreItem`, `pickTextLumaFor` (still in pretext-layout), `recencyBoost`** — all gone. If you grep for these you should find zero matches outside `docs/adr/` historical text and this HANDOFF. If you find one in `src/`, it's a leftover from pre-pivot — delete it.

12. **`Settings` TS interface + `SettingsDto` Rust struct are intentionally coupled 1:1** to the four ADR-0019 fields (`backgroundColor`, `petPackageId`, `petRate`, `petPaused`). If you add a settings field in #10, add it in both places + update `db.rs::SettingsRow` + the `init_schema` column list + `set_settings` patch handler. The bridge's `setSettings(patch)` merges partial updates server-side.

13. **`bridge.createArticle(input: CreateArticleInput)` does NOT generate `id` or `importedAt`** — the caller must provide them. Slice #4's importer will use `crypto.randomUUID()` + `Date.now()`. Slice #10's editor "add test article" button should do the same. The Rust `create_source_article` command rejects empty title or empty plainText with a string error.

14. **The non-Windows fallback is intentional** (the dev machine is Windows, but `cfg(not(windows))` guards exist throughout `platform/mod.rs`). Don't delete the fallbacks — they keep typecheck + vitest runnable in non-Windows CI if added later.

## Suggested commit cadence for next session

Per slice (AFK #4 / #11): write code → run `node node_modules/typescript/bin/tsc -b --pretty` + `node node_modules/vitest/vitest.mjs run` (TS slices) and/or `cargo test --manifest-path src-tauri/Cargo.toml` (Rust slices) → fix any errors → write commit message to `$env:TEMP\opencode\aw-slice<N>-commit.txt` → `git add -A && git commit -F <path> && git push`.

HITL slices (#9, #10): same verification gate, BUT push with a commit message that omits `closes #N`. After push, write the visual-verification checklist to `$env:TEMP\opencode\aw-slice<N>-verify.md` and `gh issue comment <N> --repo xie-st/attention-wallpaper --body-file <path>`. Wait for the user to confirm visual verification. Then `gh issue close <N> --repo xie-st/attention-wallpaper --comment "Verified by user."`.
