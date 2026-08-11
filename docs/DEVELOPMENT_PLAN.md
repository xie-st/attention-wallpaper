# Development Plan — Attention Wallpaper MVP

This plan executes the MVP defined by `CONTEXT.md` + `docs/adr/0001`–`0017` using the mattpocock/skills pack. Each phase binds to one skill, with entry criteria, exit criteria, and concrete deliverables. Phases run sequentially; subagent-driven parallelism is used inside phases where independent.

The project is **not** a git repo yet and has no remote issue tracker — skills that need an issue tracker use **local markdown issues** under `docs/issues/` (configured by `setup-matt-pocock-skills`).

---

## Phase 0 — Skill pack setup
**Skill:** `setup-matt-pocock-skills`

**Why first:** Its own description mandates running before `to-issues`, `to-prd`, `triage`, `diagnose`, `tdd`, `improve-codebase-architecture`, `zoom-out`. It wires the `## Agent skills` block into `AGENTS.md` and `docs/agents/` so the other skills know: issue tracker = local markdown at `docs/issues/`; triage label vocabulary; domain doc layout (CONTEXT.md + docs/adr).

**Entry:** ADRs 0001–0017 + CONTEXT.md exist (done).
**Exit:** `AGENTS.md` has `## Agent skills` block; `docs/agents/` describes issue tracker, labels, doc layout.
**Deliverables:** `AGENTS.md`, `docs/agents/README.md`, label vocabulary doc.

---

## Phase 1 — Gap analysis: current code vs ADR target
**Skill:** `zoom-out`

**Why:** Before changing anything, get the big picture of how the *existing* codebase (README's 5-section / atomic-sentence / AI-generation / 25-min / unwired-ONNX architecture) diverges from the *target* (ADRs: 2-section / Passage / no-AI / 15-min / wired-ONNX / sentence-highlight). Zoom-out surfaces the global shape so we don't refactor blindly.

**Entry:** Phase 0 done.
**Exit:** A written gap report identifying, per package: what to keep, delete, add, rewrite.
**Deliverables:** `docs/gap-analysis.md` covering:
- `packages/attention` — keep heuristic pipeline; wire ONNX consumption path (was stub).
- `packages/content-model` — rewrite from atomic ContentItem → Source Article + Passage (sentence-span) model; add article-level priority + lastShown.
- `packages/pretext-layout` — keep; font pinned to Noto Serif SC; maxLines=6 retained.
- `packages/ai-client` + `mock-server/` + `tests/` (mock integration) — delete (ADR-0007).
- `src/sections/` — collapse 5 → 2 (内容 / 壁纸) + 设置; 内容 gains 文章/Passage库 tabs.
- `src-tauri/src/` — add `inference/` module for ONNX bridge (`ort` crate); tray menu 7 → 4; db schema migration for source_articles + passages tables.
- `models/` —保留目录 + manifest 逻辑真正被 consume.

---

## Phase 2 — Architecture deepening plan
**Skill:** `improve-codebase-architecture`

**Why:** Zoom-out gave the gap; this skill finds *how* to restructure for testability and AI-navigability — e.g. should sentence-segmentation live in content-model or a new package? Should the ONNX bridge be one module or split (model-load / inference / marshal)? Should the 文章 reader's selection state be a reducer or a hook?

**Entry:** `docs/gap-analysis.md` exists.
**Exit:** `docs/architecture-refactor.md` with module boundaries, dependency directions, and a list of "deepening opportunities" (tightly-coupled modules to consolidate, untested seams to introduce).
**Deliverables:** Refactor plan that Phase 4+ issues will reference.

---

## Phase 3 — Prototype the riskiest interaction
**Skill:** `prototype`

**Why:** The single most novel UI is the **文章 tab reader with sentence-level highlight selection** (ADR-0015: click = one sentence, shift-click/drag = extend adjacent). It has no precedent in the codebase and its feel determines whether the whole 内容 section works. Per the prototype skill, build a throwaway terminal-app variant for the state/business-logic question (sentence segmentation + multi-sentence span state machine), before committing to it in React.

**Entry:** Phase 2 done.
**Exit:** A runnable throwaway prototype validating: (a) sentence boundary segmentation on real Hamming text + teacher notes, (b) click→select-one / shift-click→extend-span state model, (c) the `[startSentenceIdx, endSentenceIdx]` storage shape round-trips correctly.
**Deliverables:** `prototype/sentence-selection/` (throwaway, not in final bundle); notes on what worked.

---

## Phase 4 — Formalize the MVP as a PRD
**Skill:** `to-prd`

**Why:** ADRs record *decisions*; a PRD states *what to build* in implementable terms. to-prd turns the conversation context (ADRs + CONTEXT.md + gap analysis + prototype findings) into a PRD published to the local issue tracker as a top-level PRD document.

**Entry:** Phases 1–3 done.
**Exit:** `docs/issues/PRD.md` (or whatever path the tracker layout uses) describing scope, user stories, success criteria, out-of-scope, referencing ADRs.
**Deliverables:** PRD document.

---

## Phase 5 — Break PRD into tracer-bullet issues
**Skill:** `to-issues`

**Why:** to-issues converts the PRD into independently-grabbable issues cut as *vertical slices* (each touches db → package → UI → tray/IPC where relevant). This is the unit of work for TDD in Phase 7.

**Entry:** PRD exists.
**Exit:** A set of issues in `docs/issues/NNNN-slug.md`, each with acceptance criteria and ADR references.
**Suggested slice ordering** (first → last, each delivers running value):
1. **Schema migration** — `source_articles` + `passages` (sentence-span) tables; drop old content tables.
2. **Sentence segmentation + selection-span model** (pure logic, the prototype's lessons hardened).
3. **文章 tab: import .docx/.txt/.md → reader → sentence highlight → store Passage** (vertical: file dialog → db → UI).
4. **Passage 库 tab: grouped view + priority + included toggle**.
5. **Wallpaper section: import single image → preview → apply button** (merges 显示器; auto multi-monitor via IDesktopWallper).
6. **Rotation engine: article-level top-1 score + within-article Passage selection + cadence 15min + persisted pending + launch-flush**.
7. **ONNX bridge: `ort` integration, manifest validation, inference → softCost feed, heuristic fallback**.
8. **Tray menu reduction to 4 + 设置 page (cadence / ONNX diagnostics / 关于)**.
9. **Typography: Noto Serif SC bundled, auto black/white, 200-char soft warning**.
10. **Teardown: delete ai-client/mock-server/tests, update README to MVP scope.**

---

## Phase 6 — Triage issues for execution
**Skill:** `triage`

**Why:** Before grabbing issues, run them through the triage state machine so each is labeled (e.g. `ready`, `blocked`, `needs-info`) and dependencies are explicit. This makes Phase 7's TDD loop pick from a clean queue, and prepares issues for AFK-agent handoff if needed.

**Entry:** Issues exist.
**Exit:** Every issue has a triage state + dependency edges; `ready` queue is non-empty.
**Deliverables:** Triaged issue board in `docs/issues/`.

---

## Phase 7 — Implement tracer-bullet slices via TDD
**Skill:** `tdd` (per slice) + `diagnose` (on failure)

**Why:** Each slice from Phase 5's ready queue is implemented red-green-refactor. Start with slice #2 (sentence segmentation — pure logic, highest test ROI) to establish the TDD rhythm, then proceed through slices. When a test fails unexpectedly or integration breaks, switch to `diagnose`'s reproduce→minimise→hypothesise→instrument→fix→regression-test loop rather than guessing.

**Entry:** Triaged ready queue non-empty.
**Exit:** All slices merged; `pnpm test` + `pnpm typecheck` green; manual smoke (import Hamming docx → highlight → apply to wallpaper) works.
**Deliverables:** Implemented code per slice; tests per slice; ADR-0008's ONNX bridge verified with a real `.onnx` model file (smoke).

**Per-slice TDD rhythm:**
1. Write failing test (red).
2. Minimal implementation (green).
3. Refactor (keep green).
4. If red-for-wrong-reason or integration breakage → `diagnose` loop.
5. Commit slice.

---

## Phase 8 — Handoff
**Skill:** `handoff`

**Why:** After the slices land (or mid-way when context is large), compact the session into a handoff document so the next agent (or future-you) can continue without re-deriving all the ADR rationale.

**Entry:** At least the first 3 slices done, or session context large.
**Exit:** `docs/handoff/HANDOFF.md` with: current state, what's done, what's next, blockers, key decisions pointer (ADRs), how to verify.
**Deliverables:** Handoff document.

---

## Optional Phase 9 — Codify reusable workflows
**Skill:** `write-a-skill`

**Why:** If during Phase 7 a non-obvious workflow recurs (e.g. "verify an ONNX model loads correctly", "regenerate the Windows multi-size icon", "run the docx→sentence-segmentation round-trip test"), capture it as a skill so future agents don't re-derive. Triggered by noticing repetition, not scheduled.

**Entry:** A workflow has been done manually 3+ times with the same steps.
**Exit:** A new skill in `~/.agents/skills/` or repo-local skills dir.
**Deliverables:** Skill on demand only.

---

## Frontend skills binding

Two additional skill packs (installed earlier) bind to UI-bearing phases:

- **`anthropics/skills@frontend-design`** — design principles, typography, color, component layout. Consulted at:
  - Phase 3 (prototype): visual feel of the sentence-highlight reader.
  - Phase 7 slices #3 (文章 tab), #4 (Passage 库 tab), #5 (壁纸 section), #8 (设置 page): every UI-bearing slice loads this skill before writing component code.
- **`vercel-labs/agent-skills`** (`vercel-react-best-practices`, `web-design-guidelines`, `vercel-composition-patterns`) — React 18 + TS patterns, web design guidelines, composition. Consulted at:
  - Phase 2 (architecture): component decomposition and state composition patterns.
  - Phase 7 all UI slices: React idioms, hooks-vs-reducer decisions, accessibility.

### Aesthetic directive — 清新简约

The user's stated visual direction: **fresh/clean palette + minimal style**. Concrete interpretation the implementer must follow:

- **Palette**: cool-leaning neutrals (off-white #FAFBFC backgrounds, soft slate text #2E3440, one accent — suggested a calm sage/celadon green #6B8F71 or muted sky #7AA6C2, used sparingly for primary actions only). No saturated primaries, no dark-mode-by-default.
- **Layout**: generous whitespace; single-column flows; max 2 visual zones per screen; no cards-within-cards; no drop shadows except where a surface genuinely floats.
- **Typography (UI chrome, distinct from Passage-on-wallpaper typography)**: a single sans-serif for all in-app chrome (Noto Sans SC), 14–16px body, restrained weights (400/500). The serif Noto Serif SC is reserved for Passage text *on the wallpaper only* — UI chrome stays sans for contrast.
- **Iconography**: line icons only (stroke 1.5px), no filled icons. Consistent set (e.g. Lucide).
- **Motion**: none beyond native OS transitions. No fade-ins, no springs.

This directive is referenced by every UI slice in Phase 7 and is non-negotiable for MVP.

---

## Ordering summary

```
0  setup-matt-pocock-skills   (configures the pack + git/GitHub init)
1  zoom-out                   (gap: code vs ADRs)
2  improve-codebase-architecture + frontend-design + web-design-guidelines (UI shape)
3  prototype                  (de-risk sentence-selection — UI feel validated)
4  to-prd                     (formalize what to build)
5  to-issues                  (tracer-bullet slice list)
6  triage                     (ready queue)
7  tdd × N slices + diagnose + frontend-design + vercel-react-best-practices (implement)
8  handoff                    (compact for next agent)
9  write-a-skill              (only if repetition found)
```

---

## First concrete action

Begin Phase 0 now: invoke `setup-matt-pocock-skills` to wire `AGENTS.md` + `docs/agents/`. It needs two inputs from the user:
1. **Issue tracker**: local markdown at `docs/issues/` (recommended — repo is not git-initialized) vs GitHub (requires `git init` + remote first).
2. **Domain doc layout**: confirm `CONTEXT.md` at root + `docs/adr/` (already established by grill-with-docs).

Confirm these and Phase 0 starts.
