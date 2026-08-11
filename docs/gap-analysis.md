# Gap Analysis — current code vs ADR target

Scope: the entire codebase at commit 59c615f vs `CONTEXT.md` + `docs/adr/0001`–`0017`. Three layers scanned (frontend `src/`, TS `packages/`, Rust `src-tauri/`). Each finding cites file:line and the ADR it diverges from.

This document is the zoom-out view. It does not prescribe implementation order — that is `docs/DEVELOPMENT_PLAN.md` Phase 5's job (tracer-bullet slices). It prescribes *what to keep / delete / modify / add* per module.

---

## 1. Frontend (`src/`)

### 1.1 Section structure

Current: 5 sections (`App.tsx:9-17`) — content / wallpaper / display / ai / privacy. Default lands on `"content"` (`App.tsx:20`).
Target (ADR-0010/0007/0009): 2 sections + 设置 — 内容 / 壁纸. Default lands on `"wallpaper"` (ADR-0010 consequence).

| File | Verdict | Note |
|------|---------|------|
| `sections/AiSection.tsx` | DELETE | ADR-0007. Imports `@ai-client`, calls full 4-endpoint contract. |
| `sections/PrivacySection.tsx` | DELETE | ADR-0009. Privacy statement → 设置/关于; ONNX status + manifest dir → 设置 block 2 (ADR-0017); rotation-interval input → 设置 block 1. Fields `perMonitorMax`/`fontBody`/`aiBaseUrl` must NOT carry over. |
| `sections/DisplaySection.tsx` | DELETE / MERGE | ADR-0010. Per-monitor preview/apply/restore fold into WallpaperSection; 轮换状态 → 壁纸; 模型状态 → 设置. |
| `sections/ContentSection.tsx` | FULL REWRITE | ADR-0004/0011/0015. Was free-text CRUD for atomic `ContentItem` (`kind: goal\|question\|sentence`). Becomes two tabs: 文章 (import + reader + sentence highlight) + Passage 库 (grouped by Source Article, priority, included toggle). `SAMPLE_CONTENT` seeding must go. Header copy "每台显示器最多显示 N 条" contradicts ADR-0001. |
| `sections/WallpaperSection.tsx` | MODIFY | ADR-0010/0012/0001. (a) Auto-all-monitors apply (currently manual `selectedMonitor` (`WallpaperSection.tsx:101-114`)). (b) Drop BMP from file picker (`:123`). (c) Store imported wallpaper in app data dir + replace-previous (ADR-0012). (d) Add 重新布局 button (ADR-0014 moves it here from tray). (e) `composite()` call must pass Passages from one Source Article per ADR-0016, max 1 per monitor. |

### 1.2 `lib/tauri.ts` — settings interface

`tauri.ts:20-29` — fields and their disposition per ADR-0003/0006/0007/0017:

| Field | Verdict | Reason |
|-------|---------|--------|
| `rotationIntervalMinutes` | MODIFY | Default 25→15 (ADR-0003); clamp 5–120. |
| `perMonitorMax` | DELETE | ADR-0001 fixes 1/monitor; not exposed (ADR-0017). |
| `fontBody` / `fontDisplay` | DELETE | ADR-0006 single serif, no picker. |
| `aiBaseUrl` | DELETE | ADR-0007. |
| `deviceTokenFromKeychain` | DELETE | ADR-0007. |
| `telemetry` | DELETE | ADR-0017 "no telemetry". |
| `modelManifestDir` | KEEP | ADR-0017 block 2. |

### 1.3 `lib/tauri.ts` — IPC surface

17 commands currently bridged. Disposition:

| Command | Verdict |
|---------|---------|
| `list_monitors` | KEEP |
| `get_desktop_icon_rects` | KEEP |
| `apply_wallpaper` | MODIFY — ADR-0010 auto-all-monitors (drop manual monitorId) |
| `restore_wallpaper` | KEEP command; DELETE `tray://restore` listener (`App.tsx:58`) — ADR-0014 |
| `list_content` | SPLIT → `list_source_articles` + `list_passages(articleId)` |
| `save_content` | REPLACE → `import_source_article` + `create_passage` + `update_passage_metadata` (priority + included only, ADR-0015) |
| `delete_content` | SPLIT → `delete_passage` + `delete_source_article` (cascade w/ confirm, ADR-0015) |
| `get_settings` / `set_settings` | KEEP; shrink field set |
| `get_rotation_state` / `set_rotation_state` | KEEP |
| `next_set` | KEEP (ADR-0014 tray 下一组) |
| `pause_one_hour` | KEEP (ADR-0014 tray 暂停一小时) |
| `relayout` | DELETE command (no-op already); ADR-0014 moves action to 壁纸 button |
| `get_models_status` | KEEP; MODIFY impl — real ONNX diagnostics (ADR-0008/0017) |
| `get_wallpaper_profile` / `set_wallpaper_profile` | KEEP |
| **NEW** | `import_source_article` (.docx/.txt/.md, dedupe by filename — ADR-0004/0015) |
| **NEW** | `import_wallpaper_file` (copy to data dir — ADR-0012) |
| **NEW** | `run_attention_inference(imageBytes)` — feeds ONNX results to TS attention pipeline (ADR-0008) |

Tray listeners (`App.tsx:55-61`): keep `tray://next-set` + `tray://pause-one-hour`; delete `tray://restore` + `tray://relayout`; repoint `nav://settings` to a real 设置 page. `tray://open-editor` already OS-level.

### 1.4 `lib/compositor.ts`

`composite()` (`:173-213`) skeleton exists (decode → analyze → select → layout → composite → PNG). Gaps:

1. **Atomic content assumption (`:62`, `:181`)** — `CompositeInput.content: ContentItem[]`; `selectForRotation` operates on atomic model. Must retype around `Passage` with `sourceArticleId`/`startSentenceIdx`/`endSentenceIdx`/`text`/`priority`(核心/普通/偶尔)/`included`/`lastShown`. Multi-monitor single-Source-Article constraint (ADR-0016) not enforced.
2. **`perMonitorMax` plural (`:181`, `:187`)** — hardcoded `1` per ADR-0001, not read from settings.
3. **Wrong font (`:81-83`)** — `settings.fontBody \|\| "Microsoft YaHei UI"`. ADR-0006 pins Noto Serif SC; hardcoded `FontSpec`, not settings-derived.
4. **Wrong priority weights (`:215-217`)** — 3/2/1 for high/normal/low. ADR-0011 requires 3/1/0.3 for 核心/普通/偶尔. Vocabulary wrong too.
5. **Impure text colors (`:118`)** — `rgba(255,255,255,0.96)` / `rgba(12,14,18,0.92)`. ADR-0006 says pure white / pure black. Fallback forces `#f5f7fa` (`:117`).
6. **Always-on shadow (`:121-123`)** — `shadowBlur=6` for non-fallback placements. ADR-0006 defers shadow/outline decision; currently unconditional.
7. **No multi-monitor orchestration** — `composite()` is per-monitor (one `MonitorInfo`). The "pick N Passages from one Source Article for N monitors" orchestration lives nowhere; `WallpaperSection` calls `composite` once per selected monitor.

### 1.5 `styles.css` vs 清新简约 directive

| Aspect | Current | Gap |
|--------|---------|-----|
| Palette (`:1-14`) | `--bg:#0e1116`, `--accent:#4f8cff` | Cool-neutral OK; directive suggests lighter off-white background (`#FAFBFC`) for "清新" — currently dark theme. **Discuss: keep dark or flip to light?** |
| Chrome font (`:17`) | Microsoft YaHei UI first | Must be Noto Sans SC first (directive). |
| Shadows (`:16`, `:91`, `:202`) | `--shadow` token applied on `.card`, `.toast` | Directive "no shadows" — remove. |
| Motion (`:112`) | `transition: background 0.12s` on buttons | Directive "no motion" — remove. |
| Icons (`App.tsx:12-16`) | Unicode glyphs `✎ ▣ ▤ ✦ 🔒` | Mixed (🔒 is emoji); replace with consistent line icon set (lucide-react). Section count shrinks anyway. |

---

## 2. TS packages (`packages/`)

### 2.1 `packages/attention/`

| File | Verdict | Note |
|------|---------|------|
| `src/fft.ts` | KEEP | FFT radix-2; heuristic tier stays (ADR-0008 fallback). |
| `src/image.ts` | KEEP | Luma/downsample/boxBlur helpers; ADR-neutral. |
| `src/heuristics.ts` | KEEP | Spectral residual + Sobel edge + subject saliency fallback. Mathematically reuses spectral for subject — acceptable per ADR-0008. |
| `src/scoring.ts` | MODIFY | (a) `softCost` weight slots OK (subject 0.45 / spectral 0.2 / edges 0.15 / readability 0.2). (b) ONNX subject path (`:122-137`) **calls adapter with zero-size dummy image** (`{width:0,height:0,data:empty}`) — latent bug; must pass real image bytes (ADR-0008). (c) Hardcoded `confidence:0.9` from adapter (`adapters.ts:91`) not propagated to `ComponentStatus`. (d) Add `inference_error` / `wrong_shape` diagnostic codes (ADR-0008). |
| `src/layout.ts` | MODIFY | (a) `DEFAULT_LAYOUT.maxItems = 3` (`:48`) → `1` (ADR-0001). (b) `reduce_count` diagnostic becomes unreachable under max-1; leave as defensive or remove. (c) Contrast uses local luma approximation (`:14-32`); should consolidate with `pretext-layout.pickTextLumaFor` (WCAG-correct). |
| `src/adapters.ts` | MODIFY | (a) TS adapter **does** have a real consumption path for ONNX outputs (`:86-92`) — structurally correct. (b) No adapter construction/wiring in-package; no test injects a mock `*Inference`. (c) `confidence:0.9` hardcoded. (d) Missing `inference_error`/`wrong_shape` codes. |
| `src/types.ts` | MODIFY | `Priority = "low"|"normal"|"high"` exported but unused in-package; stale vs canonical 核心/普通/偶尔 (owned by content-model). Remove or align. |
| `src/attention.test.ts` | MODIFY | `maxItems:3` test (`:204-221`) → 1; no active-ONNX-adapter test exists. |

### 2.2 `packages/content-model/` — most disrupted

**`src/index.ts` `ContentItem` (`:5-14`) vs target `Passage`:**

| Current field | Verdict | Target |
|---------------|---------|--------|
| `id` | KEEP | `id` |
| `kind` (goal/question/sentence) | DELETE | — |
| `body` | RENAME → `text` | materialized from `[startSentenceIdx, endSentenceIdx]` |
| — | ADD | `sourceArticleId` (ADR-0004/0016) |
| — | ADD | `startSentenceIdx` / `endSentenceIdx` (ADR-0015) |
| `enabled` | RENAME → `included` | rotation toggle (ADR-0015) |
| — | ADD | `lastShown` per-Passage (ADR-0016) |
| — | ADD | `lengthWarned` (ADR-0013) |
| `frequency` (occasional/normal/frequent) | DELETE | ADR-0016 formula has no frequency term |
| `startsAt` / `endsAt` | DELETE | stale README-era |
| `priority` (low/normal/high) | MODIFY | 核心/普通/偶尔 with weights 3/1/0.3 (CONTEXT.md) |

**`SourceArticle` — net-new type** (ADR-0004/0016): `{id, filename, title, plainText, priority (default 普通 on import), lastShown, createdAt}`.

**Selection algorithm (`:91-156`) — full restructure per ADR-0016:**
- Current: `scoreItem = priority*1.0 + frequency*0.5 + recency*1.2` (log-curve recency, cap 10); `selectForRotation` Passage-level top-N with cross-monitor no-repeat.
- Target: (1) Article-level top-1: `score = priority_weight * (1 + 1/(1 + daysSinceLastShown))`. (2) Within chosen article: up to N Passages by priority desc. (3) Surplus monitors (article Passage count < monitor count) keep previous wallpaper — no backfill. (4) Update article + Passage `lastShown` post-selection.
- `frequency` weight, `recencyBoost` log-curve, `FREQUENCY_WEIGHT` (`:39-43`), `PRIORITY_WEIGHT` (`:33-37`) all wrong — replace.

**Scheduling (`:158`, `:175-198`):**
- `ROTATION_INTERVAL_MS = 25 * 60_000` → `15 * 60_000` (ADR-0003).
- Add `clampCadence(minutes) ∈ [5, 120]` (ADR-0003).
- `pauseOneHour` (`:201-203`) stays (ADR-0002/0014).

**Validation (`:211-234`):**
- Hard 280-char rejection (`:217-219`) contradicts ADR-0013's 200-char *soft* warning. Replace with `lengthWarned` flag; no hard reject.

**Sentence segmentation — net-new** (ADR-0015): Chinese `。！？； + \n`; English `. ! ? + \n`. Likely lives in TS (articlesTab reader), but the indexing scheme is defined here so storage + reader agree.

**`index.test.ts`:** 25-min expectation (`:125-129`) → 15; `perMonitor:3` (`:83-91`) → 1 + single-article semantics; 280-char rejection (`:143-146`) → 200-char soft warning; `low/normal/high` labels → 核心/普通/偶尔; net-new Source-Article-level selection tests.

### 2.3 `packages/pretext-layout/`

| Aspect | Verdict | Note |
|--------|---------|------|
| `maxLines = 6` default (`:86`) | KEEP | ADR-0013 soft cap is UI-only, not layout-engine. |
| Font pinning | MODIFY | No `DEFAULT_FONT_FAMILY`; tests use `Noto Sans CJK SC` (`test:48`). Pin `Noto Serif SC` per ADR-0006. |
| `pickTextLumaFor` (`:119-123`) | WIRE IN | WCAG-correct, exported, but **not consumed** — `attention/layout.ts` uses its own luma approximation. Consolidate to one WCAG path (ADR-0006). |
| `contrastRatio` / `relativeLuminance` / `srgbToLinear` (`:100-113`) | KEEP | WCAG 2.1 correct; should be the single contrast source. |

### 2.4 `packages/ai-client/`

Entire package deleted per ADR-0007. Scope: 4 files, ~347 lines:
- `package.json`, `tsconfig.json`, `src/index.ts` (195 lines, ApiClient + 4 endpoints + quota + PNG validation + PromptDirector), `src/ai-client.test.ts` (152 lines).
- No other package imports it — clean delete. Also remove from `pnpm-workspace.yaml`.

---

## 3. Rust layer (`src-tauri/`)

### 3.1 `Cargo.toml`

| Dep | Verdict | Note |
|-----|---------|------|
| `tauri` v2 + tray-icon | KEEP | |
| `tauri-plugin-dialog` / `tauri-plugin-fs` | KEEP | ADR-0004 file import. |
| `rusqlite` v0.32 bundled | KEEP | |
| `uuid` / `chrono` / `base64` / `thiserror` / `serde` / `serde_json` | KEEP | |
| `windows-sys` v0.59 | KEEP | IDesktopWallpaper + GDI. |
| **`ort`** | ADD | ONNX Runtime Rust binding, `load-dynamic` feature (ADR-0008). |
| **`sha2`** | ADD | Manifest checksum verification (ADR-0008). |
| **`image`** (optional) | ADD | Decode PNG/JPG in Rust for inference preprocessing (ADR-0008). |

`description` field (`:8`) stale ("goals, questions, sentences") — update to Passage vocabulary.

### 3.2 `src/db.rs` — schema

| Table | Lines | Verdict |
|-------|-------|---------|
| `content` | 67-76 | REPLACE → `source_articles` + `passages` (see below) |
| `settings` | 77 | KEEP shape; MODIFY defaults |
| `rotation_state` | 78-82 | KEEP (matches ADR-0002 persisted-pending) |
| `wallpaper_profiles` | 83-89 | KEEP (per-monitor restore, ADR-0014) |

**`source_articles` (new):** `id TEXT PK, filename TEXT (dedupe key — ADR-0015), title TEXT, plain_text TEXT, priority TEXT DEFAULT 'normal', last_shown_at TEXT, created_at TEXT`.

**`passages` (new):** `id TEXT PK, article_id TEXT FK→source_articles ON DELETE CASCADE, start_sentence_idx INT, end_sentence_idx INT, text TEXT, priority TEXT DEFAULT 'normal', included INT DEFAULT 1, last_shown_at TEXT, created_at TEXT`.

**`settings` defaults (`:227-238`):**
- `rotation_interval_minutes`: 25 → **15** (ADR-0003).
- `per_monitor_max`: **delete** (ADR-0001).
- `font_body` / `font_display`: **delete** (ADR-0006).
- `ai_base_url`: **delete** (ADR-0007).
- `model_manifest_dir`: KEEP (ADR-0017).

### 3.3 `src/commands.rs`

17 commands. Key dispositions (full table in subagent report):

- `list_content` / `save_content` / `delete_content` (`:203-219`) → full rewrite to article + passage CRUD.
- **NEW** `import_source_article` — accepts file path from dialog, parses .docx/.txt/.md, dedupe by filename (ADR-0004/0015).
- `get_settings` / `set_settings` (`:221-270`) → strip `ai_base_url`/`device_token_from_keychain`/`telemetry`/`per_monitor_max`/font fields (ADR-0007/0017).
- `get_models_status` (`:311-332`) → real ONNX diagnostics: `loaded` / `failed-checksum` / `wrong-shape` / `inference-error` / `not-installed` (ADR-0008/0017).
- `relayout` (`:402-407`, registered `lib.rs:53`) → DELETE (no-op; ADR-0014 moves action to UI button).
- **NEW** `run_attention_inference(imageBytes)` → ONNX results to TS pipeline (ADR-0008).
- `RotationDto.next_at` / `pending_since` (`:79-80`, 281, 307, 382, 398) always `None` — compute from `last_rotated_at + cadence` or remove.

### 3.4 `src/tray.rs`

7 items (`:10-16`) → 4. Delete `tray_relayout` / `tray_restore` / `tray_settings` items + their `on_menu_event` arms (`:49-61`) + event emissions. Keep `tray_open` / `tray_next` / `tray_pause` / `tray_quit`.

### 3.5 `src/platform/`

| File | Verdict | Note |
|------|---------|------|
| `mod.rs` monitor enumeration (`:54-80`) | KEEP | Already IDesktopWallpaper + GDI fallback (ADR-0010). |
| `mod.rs` `apply_wallpaper` (`:128-158`) | KEEP | Per-device-path apply. |
| `mod.rs` `get_models_status` stub (`:208-226`) | REPLACE | Hardcoded `unavailable` → delegate to new `inference/` module (ADR-0008). |
| `windows.rs` IDesktopWallpaper FFI (`:22-120`) | KEEP | Hand-rolled vtable, functional. |
| `windows.rs` `list_monitors` + GDI fallback (`:131-221`) | KEEP | ADR-0010/README #5. |
| `windows.rs` `apply_wallpaper` / `restore_wallpaper` (`:249-293`) | KEEP | |
| `windows.rs` `get_desktop_icon_rects` (`:223-225`) | STUB | Returns hard `Err`; not strictly required by any MVP ADR. Flag as pre-existing. |

### 3.6 `src/inference/` — net-new (ADR-0008)

New sibling module to `platform/` (not nested — keeps `platform/` focused on Windows OS glue).

| Submodule | Responsibility |
|-----------|----------------|
| `inference/manifest.rs` | Read `manifest.json` from `model_manifest_dir`; parse 3 entries (u2netp / facedetlite / ppocrv6_tiny); sha256 each `.onnx` via `sha2` crate; return `not_installed` / `failed_checksum` / `ok`. |
| `inference/session.rs` | `ort::session::Session` per model, CPU execution provider; validate I/O tensor shapes → `wrong_shape` on mismatch; hold in `OrtBridge` struct managed via `tauri::State`. Handle missing `onnxruntime.dll` gracefully → `not_installed` for all slots. |
| `inference/runner.rs` | `run_subject_saliency(bytes)`, `run_face_detect(bytes)`, `run_text_detect(bytes)`; image preprocessing (resize/normalize via `image` crate); `inference_error` on failure. |
| `inference/mod.rs` | Aggregate per-slot state into `ModelStatus` / `ComponentStatus`; replace `platform::get_models_status` stub; expose `pub fn get_models_status(bridge: &OrtBridge)`. |

Wire `pub mod inference;` in `lib.rs` (`:1-4`); add `OrtBridge` to managed state (`:29-31`).

### 3.7 `tauri.conf.json` + `capabilities/`

| Aspect | Verdict | Note |
|--------|---------|------|
| Window size `1080×740`, min `880×600` (`:14-24`) | KEEP | Fits 2-section + 设置. |
| CSP `connect-src` (`:27`) | TIGHTEN | `127.0.0.1:*` / `localhost:*` wildcards are AI-mock leftovers → `connect-src 'self' ipc: http://ipc.localhost` (ADR-0007). |
| `bundle.resources` (`:30-44`) | ADD | `onnxruntime.dll` relocatable bundling (ADR-0008). |
| `productName` / descriptions (`:3`, `:42-43`) | UPDATE | Stale "goals, questions, sentences" → Passage vocabulary. |
| `capabilities/default.json` `dialog:default` + `fs:allow-read-text-file` (`:19-21`) | KEEP | Sufficient if `import_source_article` reads the file in Rust (recommended — no binary docx over IPC). |

### 3.8 `src/lib.rs`

- `pub mod inference;` declaration (ADR-0008).
- `OrtBridge` in managed state (ADR-0008).
- **Launch-flush of pending rotation** (ADR-0002 consequence): if `now - last_rotated_at ≥ cadence` at startup, trigger one rotation. Schema supports it; logic not implemented (`:19-35`).

---

## 4. Cross-cutting ambiguities (flag for `grill-with-docs` follow-up)

1. **Light vs dark theme** — `styles.css` is dark (`#0e1116`); 清新简约 directive suggests light off-white (`#FAFBTC`). Not yet decided; needs user input.
2. **Sentence segmentation location** — ADR-0015 implies TS (articlesTab reader), but article-replace invalidation (ADR-0015) needs Rust to re-materialize spans. Shared segmentation rules must live somewhere; currently undefined.
3. **Wallpaper text shadow** — ADR-0006 defers shadow/outline decision; `compositor.ts:121-123` currently always-on. Needs a follow-up sub-decision.
4. **`RotationDto.next_at` / `pending_since`** — always `None`; should compute or be removed.
5. **`get_desktop_icon_rects` stub** (`windows.rs:223-225`) — returns hard `Err`; pre-existing, not strictly MVP-blocking but flagged in README limitation #4.

---

## 5. Teardown sizing summary

| Item | Files | LOC approx | ADR |
|------|-------|------------|-----|
| `packages/ai-client/` | 4 | 347 | 0007 |
| `mock-server/` | 4 | TBD | 0007 |
| `tests/mock-server.test.ts` | 1 | TBD | 0007 |
| `sections/AiSection.tsx` | 1 | ~90 | 0007 |
| `sections/PrivacySection.tsx` | 1 | ~115 | 0009 |
| `sections/DisplaySection.tsx` | 1 | ~95 | 0010 |
| Tray items 4-6 | partial `tray.rs` | ~30 | 0014 |
| `relayout` command | partial `commands.rs` + `lib.rs` | ~10 | 0014 |
| Settings fields (aiBaseUrl/font/perMonitorMax/telemetry/deviceToken) | cross-layer | scattered | 0007/0006/0017 |

## 6. Net-new sizing summary

| Item | Files | ADR |
|------|-------|-----|
| `source_articles` + `passages` schema + CRUD | `db.rs`, `commands.rs` | 0004/0015/0016 |
| `SourceArticle` + `Passage` TS types + selection rewrite | `packages/content-model/src/index.ts` | 0004/0015/0016 |
| Sentence segmentation module | TS (location TBD) | 0015 |
| 文章 tab (import + reader + highlight) | new `sections/内容/ArticlesTab.tsx` | 0004/0011/0015 |
| Passage 库 tab | new `sections/内容/PassageLibraryTab.tsx` | 0011 |
| 设置 page | new `sections/设置/` | 0017 |
| `src/inference/` Rust module | 4 new files | 0008 |
| `ort` + `sha2` + `image` Cargo deps | `Cargo.toml` | 0008 |
| `run_attention_inference` IPC command | `commands.rs` | 0008 |
| `import_source_article` IPC command | `commands.rs` | 0004/0015 |
| `import_wallpaper_file` IPC command | `commands.rs` | 0012 |
| Launch-flush rotation logic | `lib.rs` | 0002 |
| Noto Serif SC font bundling | `pretext-layout` + build | 0006 |
| Light-theme + line-icons + no-shadow restyle | `styles.css`, `App.tsx` | directive |

---

End of gap analysis. Next: Phase 2 (`improve-codebase-architecture` + frontend skills) turns this into a refactor plan with module boundaries.
