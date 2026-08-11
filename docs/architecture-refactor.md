# Architecture refactor — deepening opportunities

Phase 2 output of `improve-codebase-architecture` skill. Candidates use LANGUAGE.md vocabulary (Module / Interface / Depth / Seam / Adapter / Leverage / Locality). Ordered by impact. Per skill process: candidates are presented, not yet solved — user picks which to grill.

---

## Candidate 1: Selection Module is too shallow — Article-level selection (ADR-0016) has no home

**Files**: `packages/content-model/src/index.ts:91-156` (`scoreItem`, `selectForMonitor`, `selectForRotation`); `src/lib/compositor.ts:175-188` (only caller)

**Problem**: Current Interface is `selectForRotation(pool, now, monitorCount, perMonitor, lastShown)` operating on flat Passage pool with cross-monitor no-repeat via `alreadyChosenIds`. ADR-0016's real algorithm is two-level (Article top-1 then Passages from that Article, surplus monitors untouched). Depth is low (Interface nearly as wide as body); wrong concerns at the seam (`alreadyChosenIds`/`slotsRemaining` exist for a constraint ADR-0016 makes irrelevant). Deletion test: delete `selectForRotation` and Article-level selection reappears nowhere — it's just missing.

**Solution**: One external seam `planRotationSet(articles, passages, now, monitorCount): {articleId, placements}`; internally composes private article-scorer + private within-article Passage picker. Drop cross-Passage-repeat plumbing from the public Interface.

**Benefits**: Locality (ADR-0016 invariant in one Module); Leverage (compositor/tray/launch-flush cross one seam); Tests (single assertion for Article pick + Passage assignment).

**ADR conflict**: None — implements ADR-0016; contradicts stale `selectForRotation` shape.

---

## Candidate 2: Subject-saliency Adapter invoked twice with different images — seam is wrong

**Files**: `packages/attention/src/scoring.ts:122-137` (softCost path, zero-size dummy image); `:251-253` (public-map path, real image); `adapters.ts:86-92` (hardcoded `confidence:0.9`)

**Problem**: `AttentionAdapter.run(input, gridW, gridH)` called twice — once with `{width:0,height:0,data:empty}` for softCost, once with real image for exported map. Seam for "produce subject map once" is missing; locality lost (image provenance decided at consumer call sites). The zero-image call is a latent bug — ONNX path never actually exercised. Tests can't verify "ONNX active" without reaching past Interface.

**Solution**: `SubjectSaliencySource` Module, one seam `compute(img, gridW, gridH): {map, confidence, source, reason?}`. `buildAttentionMap` calls once, threads result into both `composeCost` and exported map. Adapter stays behind that seam; hardcoded `confidence` propagated properly.

**Benefits**: Locality (zero-image bug structurally impossible); Leverage (one call site, N consumers); Tests (mock returns fixed map, assert both softCost and exported map reflect it).

**ADR conflict**: None — serves ADR-0008. Fixes gap-analysis §2.1 latent bug.

---

## Candidate 3: Multi-monitor rotation-set orchestration lives nowhere — compositor is per-monitor

**Files**: `src/lib/compositor.ts:173-213` (`composite`); `src/sections/WallpaperSection.tsx` (calls composite per selected monitor); `packages/content-model/src/index.ts:135-156`

**Problem**: `composite()` takes single `MonitorInfo` + flat `ContentItem[]` and internally calls `selectForRotation(...,1,perMonitorMax,{})` — degenerate single-monitor slice. ADR-0016's unit is set-level (Article pick + Passage-to-monitor assignment + surplus-untouched). Deletion test: delete `composite()` and per-monitor rendering reappears in 1 caller (fine), but set-level orchestration reappears in zero places — absent. Seam is one level too low.

**Solution**: Hoist `RotationSet` Module: `composeSet(monitors, articles, passages, now): (CompositeOutput|null)[]` — `null` = "keep previous wallpaper." Composes Candidate 1's `planRotationSet` + one `composite()` per non-null monitor. `composite()` keeps per-monitor (earning its keep) but drops inline `selectForRotation`. WallpaperSection calls `composeSet`.

**Benefits**: Locality (surplus-untouched invariant in one Module); Leverage (tray/launch-flush/WallpaperSection share seam); Tests (`composeSet` 3-monitor + 2-Passage article → `[out,out,null]`).

**ADR conflict**: None — implements ADR-0016 under-fill clause.

---

## Candidate 4: Contrast/text-color Locality is split across `attention/layout` and `pretext-layout`

**Files**: `packages/attention/src/layout.ts:14-32` (non-WCAG `contrastRatio`); `packages/pretext-layout/src/index.ts:99-123` (WCAG-correct, *exported but unused*); `src/lib/compositor.ts:113-118` (uses `pickTextLumaFor` then overrides with rgba)

**Problem**: Two Adapters for "text-on-background color decision," no Home. `attention/layout` ships non-WCAG luma approximation; `pretext-layout` ships WCAG-correct version that nobody consumes. Locality lost: ADR-0006 pure-black/white rule must be enforced in two places that disagree. Deletion test: delete `attention/layout`'s contrast functions — complexity does NOT reappear (pretext-layout already provides it); Module was a pass-through that *diverged*.

**Solution**: Make `pretext-layout` the Home; export `effectiveContrast(bgLuminance, bgLumaStd)` next to `pickTextLumaFor`. `attention/layout` imports and removes local copies. Seam becomes "ask pretext-layout how readable this rect is."

**Benefits**: Locality (WCAG math + readability curve in one Module); Leverage (layout/compositor/preview share decision Module); Tests (contrast in pretext-layout, layout asserts "given contrast, which candidate wins").

**ADR conflict**: None — addresses ADR-0006 + gap-analysis §2.1/§2.3.

---

## Candidate 5: Priority concept has no Home — weights and labels duplicated across 3 Modules

**Files**: `packages/content-model/src/index.ts:33-37` (`PRIORITY_WEIGHT` 3/2/1, wrong per ADR-0011 = 3/1/0.3); `src/lib/compositor.ts:215-217` (`priorityNum` re-implements); `src/sections/ContentSection.tsx:11-17` (labels); `packages/attention/src/types.ts:1` (stale `Priority`, unused)

**Problem**: Priority (核心/普通/偶尔 → weight + label) has no Home: weight in content-model, re-derived in compositor, label in ContentSection, stale English duplicate in attention/types. Deletion test on `priorityNum`: missing complexity reappears immediately (layout needs numeric priority) — Module reached past content-model's Interface. Interface too narrow (exports type + weight map but not label map or normalize function).

**Solution**: content-model exports `Priority`, `PRIORITY_WEIGHT` (corrected 3/1/0.3), `PRIORITY_LABEL`, `priorityWeight(p)`. Delete `attention/types.ts` Priority + compositor `priorityNum`. ContentSection imports labels.

**Benefits**: Locality (mapping in one Module — ADR-0011 fix is one-line); Leverage (compositor/layout/UI share Interface); Tests (priority-weight in content-model, consumers stop needing priority fixtures).

**ADR conflict**: None — reconciles ADR-0011 3/1/0.3 vs current 3/2/1.

---

## Candidate 6: `tauri.ts` bridge mirrors Rust commands, not domain verbs — seam one level too low

**Files**: `src/lib/tauri.ts:109-230` (`bridge` object, 17 methods, each `IN_TAURI ? invoke : localStorage`); `src-tauri/src/commands.rs:1-408`

**Problem**: Bridge is near-shallow but earns its keep (dev-fallback Adapter is real leverage — deletion test: `IN_TAURI ? :` reappears across N callers). BUT seam is wrong: sits at Rust-command grain, so ADR-0004/0015/0016 rewrites churn Interface 1:1 with Rust. Browser-dev Adapter is structurally a second Adapter but smushed via `IN_TAURI ? :` per method — one Adapter per method instead of one per storage backend. Locality lost: new domain verb ("import Source Article + re-derive spans") must be a low-level command sequence at every caller.

**Solution**: Lift Interface to domain verbs: `listSourceArticles()`, `listPassagesForArticle(id)`, `importSourceArticle(file)`, `updatePassageMetadata(id,patch)`, `deleteSourceArticle(id)`. Two real Adapters: `TauriAdapter` + `BrowserDevAdapter` (sibling, not smushed). `IN_TAURI ? :` concentrates as Adapter-selection at construction. 1:1 methods (`listMonitors`, `getSettings`, `nextSet`) stay.

**Benefits**: Locality (import→segment→invalidate sequence in one Adapter per backend); Leverage (ADR-0011 two-tab rewrite crosses domain-verb Interfaces); Tests (in-memory `FakeAdapter` exercises article/passage flows).

**ADR conflict**: None — supports ADR-0011/0015.

---

## Candidate 7: Sentence-segmentation Module does not exist — contested home between TS and Rust

**Files**: `docs/adr/0015-sentence-selection-atom.md:11-15` (rules + invalidation); `docs/gap-analysis.md:257` (location TBD); no implementation exists

**Problem**: ADR-0015 implies TS reader segments; but article-replace invalidation ("spans exceeding new sentence count invalidated") requires Rust to know segmentation too. Without a Module, two Adapters emerge independently (articlesTab + commands.rs::import_source_article), no shared seam for "what counts as a sentence boundary." Locality violation: single concept whose rules drift across two tiers. Deletion test moot — *absence* is the friction.

**Solution**: `SentenceSegmenter` Module, pure Interface `segment(plainText): {index, text}[]`, boundary rules defined once (Chinese `。！？；+\n`, English `. ! ? +\n`). Own in TS (more demanding consumer — live highlighting); Rust consumes via shared JSON fixture or re-implements identical rules from a shared spec. Invalidation predicate = `span.end >= segment(newText).length`.

**Benefits**: Locality (boundary rules in one Module); Leverage (reader/storage/invalidation share Interface); Tests (segmentation in one Module, both tiers assert same fixture).

**ADR conflict**: None — fills "location TBD" from gap-analysis; ADR-0015 leaves location open.

---

## Candidate 8: Compositor reaches past content-model's Interface to redo eligibility

**Files**: `src/lib/compositor.ts:180` (`input.content.filter(i => i.enabled)`); `packages/content-model/src/index.ts:54-66` (`isEligible` already encapsulates enabled/empty/window/repeat)

**Problem**: `composite()` filters `enabled` inline before `selectForRotation`, which itself calls `isEligible` (also checks `enabled`). Two Modules share one concern (eligibility) with no seam — compositor reaches past content-model's Interface, then content-model redoes it. Locality lost: when ADR-0015 renames `enabled→included` + ADR-0016 adds "must belong to chosen Article," compositor's inline filter silently drifts from `isEligible`. Tests must keep two filters in sync manually.

**Solution**: Remove inline `.filter` from `composite()`; rotation-set planner (Candidate 1/3) is sole `isEligible` caller. `composite()` receives already-chosen Passages and trusts them. Seam becomes "compositor renders what it's given."

**Benefits**: Locality (eligibility in content-model exclusively; `enabled→included` touches one Module); Leverage (compositor tests pass arbitrary placed Passages); Tests (no fixture content surviving two filters).

**ADR conflict**: None — supports ADR-0015 `included` rename.

---

## Impact ordering summary

| # | Candidate | Impact | Coupling |
|---|-----------|--------|----------|
| 1 | Selection Module (Article-level home) | Highest | Coupled with #3 |
| 2 | Subject-saliency seam (kills latent bug) | High | Standalone |
| 3 | RotationSet orchestration | High | Coupled with #1 |
| 4 | Contrast Locality consolidation | Medium-high (locality per LOC) | Standalone |
| 5 | Priority Home (3/1/0.3 fix) | Medium (cross-cutting, cheap) | Standalone |
| 6 | tauri.ts domain-verb seam | Medium | Drives ADR-0011 UI rewrite |
| 7 | SentenceSegmenter Module | Medium (prevents drift) | Required by ADR-0015 invalidation |
| 8 | Compositor eligibility leak | Low | Depends on #1 |

Candidates 1+3 together replace the rotation-orchestration tier; Candidate 2 is the highest-value single-Module fix; Candidate 4 is the highest locality-per-LOC; Candidate 5 is the cheapest cross-cutting cleanup.
