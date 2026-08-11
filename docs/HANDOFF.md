# Handoff — Attention Wallpaper MVP

**Session end**: 7/10 tracer-bullet slices done. Slice #9 implemented + pushed (commit `7ccbe57`), HITL verification gate OPEN — awaiting user visual sign-off on [issue #9 comment 5253211125](https://github.com/xie-st/attention-wallpaper/issues/9#issuecomment-5253211125). 3 remain (#10 HITL, #11 wiring+build, #1 parent PRD).
**Repo**: https://github.com/xie-st/attention-wallpaper
**Latest commit**: `7ccbe57` (Slice #9: Overlay Window — topmost + foreground-window auto-hide / ADR-0025)

## What this project is now

(Same as previous handoff — see ADR-0019 / CONTEXT.md.) A local-first Windows desktop app that renders an article as multi-column text directly on the desktop, with an AI pet walking across the text layer driving scroll progress. The "wallpaper" is a static solid color; all dynamic content lives in a transparent overlay window.

## Architectural decision this session — ADR-0025 (supersedes ADR-0024)

**Pivot from desktop-layer z-order to topmost + foreground-window auto-hide.** This was driven by empirical prototype validation, not theory. See `prototype/overlay-zorder/NOTES.md` for the full verdict matrix.

The original ADR-0024 plan (`SetParent(WorkerW/Progman)`, "below normal windows, above wallpaper") was disproven by the prototype:
- **`SetParent(overlay, WorkerW)`** → overlay disappears. The wallpaper-painting WorkerW sits below SHELLDLL_DefView (the desktop icon ListView), which is a full-screen opaque ListView covering whatever is below it. So parent-to-WorkerW hides the overlay behind the icon layer.
- **`SetParent(overlay, Progman)`** (Progman-child strategy) → z-order reorder succeeds (verified via `GW_HWNDPREV`), but **Progman does not paint child windows** other than SHELLDLL_DefView. Shell windows only render defview; other children stay invisible regardless of z-order.
- **`HWND_BOTTOM` top-level** (B strategy) → passes 3/4 product-critical criteria (icons clickable ✓, pet double-click ✓, Notepad covers ✓) but fails Win+D (HWND_BOTTOM is still a normal top-level, no shell privilege).
- **codex pet on Windows** (`ziyan-codex-usage-pet`, C# WinForms) — inspected source. Uses `TopMost = true` + `WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` + `WS_EX_TRANSPARENT` toggle + `WM_NCHITTEST → HTTRANSPARENT`. **No WorkerW/Progman/SetParent code at all.** "codex pet不受 Win+D" = topmost top-level is not minimized by Win+D.

ADR-0025 keeps the user intent of ADR-0024 (ritual exposure, covered while working, survives Win+D) via a different mechanism:
- Overlay is **topmost** (`alwaysOnTop: true` in tauri.conf.json) → immune to Win+D.
- **Selective WM_NCHITTEST** via Rust `SetWindowSubclass` on the overlay HWND: pet rect returns `HTCLIENT` (pet double-click reaches the overlay); everywhere else returns `HTTRANSPARENT` (clicks pass through to whatever is below — desktop icons or other windows).
- **Foreground-window auto-hide**: Rust `WinEventHook(EVENT_SYSTEM_FOREGROUND)` callback checks if foreground class is `Progman`/`WorkerW`. On transition, emits `overlay://visibility` Tauri event. Frontend `stepVisibility()` tweens alpha 0↔1 over 200ms (TDD'd in `src/overlay/visibility.ts` with 13 tests). When alpha=0: `WM_NCHITTEST` returns `HTTRANSPARENT` everywhere (invisible pets can't be clicked), and `PetBehavior.step` is paused (no invisible scrolling — caller's `shouldStepPet` flag).

## GitHub Issues state

- **#1** PRD (parent, open, ready-for-agent) — implicitly satisfied when #11 lands; close manually after #11
- **#2** Teardown — **DONE** (commit 184ef1d)
- **#3** SourceArticle schema + CRUD — **DONE** (commit 106f620)
- **#4** import_source_article (docx/txt/md) — open, ready-for-agent. Still not blocking the overlay smoke (placeholder text shown when no articles imported).
- **#5** packages/layout-region/ computeTextRegions — **DONE** (commit 57ec1ee)
- **#6** get_desktop_icon_rects via UI Automation — **DONE** (commit 1542949)
- **#7** PetBehavior state machine — **DONE** (commit b6f8ec6)
- **#8** pretextArticleLayout — **DONE** (commit d87166e)
- **#9** Overlay Window (HITL) — **IMPLEMENTED + PUSHED** (commit `7ccbe57`). HITL gate open: [verification checklist](https://github.com/xie-st/attention-wallpaper/issues/9#issuecomment-5253211125). Awaiting user visual sign-off. After sign-off: `gh issue close 9 --repo xie-st/attention-wallpaper --comment "Verified by user."`
- **#10** Editor Window rewrite (HITL) — open, ready-for-human, all blockers resolved.
- **#11** Tray reduction to 2 actions + final wiring + tauri:build smoke — open, ready-for-agent, blocked by #9, #10.

## Current repo state

### Tests passing (verification-before-completion evidence as of 7ccbe57)
- `node node_modules/typescript/bin/tsc -b --pretty` → green (exit 0)
- `node node_modules/vitest/vitest.mjs run` → **57 tests green** (8 content-model + 7 layout-region + 14 pet-behavior + 8 article-layout + 7 pretext-layout + 13 visibility). The 13 visibility tests are the new TDD'd reducer for ADR-0025 (fade in/out + alpha=0 pet-pause boundary).
- `cargo test --manifest-path src-tauri/Cargo.toml` → **13 tests green** (10 db + 3 windows collect_icon_rects). No new Rust tests this slice (the z-order hooks are FFI, exercising real HWNDs — not unit-testable; the visibility reducer is the testable pure logic).
- `npx pnpm tauri:dev` smoke → app launches, both editor + overlay windows visible, no Rust panics, no console errors.

### What was added this session (slice #9)

- **`docs/adr/0025-overlay-topmost-foreground-autohide.md`** — new ADR recording the z-order pivot. Includes "Considered options" with the four prototype-validated strategies + reference to `ziyan-codex-usage-pet` source inspection.
- **`docs/adr/0024-overlay-at-desktop-layer.md`** — marked `Status: superseded by ADR-0025` at top. The "Why" section still describes the user intent; the "How" section is voided.
- **`prototype/overlay-zorder/`** — throwaway prototype (separate `Cargo.toml`, not part of the workspace). Three strategies tested: WorkerW-parent, Progman-child, HWND_BOTTOM top-level. Retained per ADR-0025 as historical evidence; delete after one release cycle. Has its own `NOTES.md` with the verdict matrix. NOT unit-tested (prototype skill: "no tests, no error handling beyond runnable").
- **`src/overlay/visibility.ts`** + **`.test.ts`** — pure reducer TDD'd vertical-red-green. Exports `stepVisibility(input: { foregroundIsDesktop, currentAlpha, dt }): { nextAlpha, shouldStepPet }` + `FADE_MS = 200`. Fixed-speed linear ease over [0,1] alpha range; saturates at 0 and 1; `shouldStepPet = nextAlpha > 0`.
- **`src/overlay/OverlayWindow.tsx`** — Canvas + `requestAnimationFrame` loop wiring PetBehavior + pretextArticleLayout + icon-rect subscription + visibility tween. Pet is a **placeholder colored rect** (issue acceptance permits: "bundle a small placeholder spritesheet; community pet drop-in is a stretch goal"); state-colored per `PET_COLOR_BY_STATE` so the user can visually verify PetBehavior state transitions during HITL.
- **`src/main.tsx`** — routes `?window=overlay` to `<OverlayWindow />`, else `<App />`. Same `index.html` for both windows (no Vite multi-entry config needed).
- **`src-tauri/Cargo.toml`** — added `Win32_UI_Accessibility` feature (for `SetWinEventHook`, `HWINEVENTHOOK`).
- **`src-tauri/tauri.conf.json`** — second window entry `label: "overlay"` (transparent, `alwaysOnTop: true`, decorations false, skipTaskbar, `url: "index.html?window=overlay"`, fixed 1260×792 at (0,0)). The editor window now has `label: "editor"`.
- **`src-tauri/src/platform/windows.rs`** — bottom section "Overlay window z-order + visibility hooks (ADR-0025)":
  - `install_overlay_hooks<F>(hwnd, on_visibility)` — applies `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` + `SetWindowSubclass` (subclass ID `0xA601`) for selective `WM_NCHITTEST` + `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`.
  - `update_pet_rect(left, top, w, h)` — updates a `Mutex<PetRectState>` (cheap lock; frontend calls every frame via `update_pet_rect` command).
  - `update_overlay_alpha(alpha_0_255: u8)` — `AtomicU8` storage; `WM_NCHITTEST` returns full `HTTRANSPARENT` when 0.
  - Subclass proc `overlay_subclass_proc`: WM_NCHITTEST → reads `OVERLAY_ALPHA` + `PET_RECT`, returns HTCLIENT (pet region, alpha>0) or HTTRANSPARENT (elsewhere, or alpha==0 everywhere). All other messages → `DefSubclassProc` (chains to Tauri's existing WndProc).
  - `foreground_event_callback` (WinEventHook callback): `GetForegroundWindow` + `GetClassNameW` → "Progman" or "WorkerW". `AtomicBool` `LAST_FOREGROUND_IS_DESKTOP` debounces transitions; calls the `on_visibility` closure (which `commands.rs` wires to emit `overlay://visibility` with `{ visible: bool }`).
  - Statics: `OVERLAY_APP_HANDLE` (OnceLock — currently unused, kept for future Rust-side emit if closure approach is replaced), `VISIBILITY_CALLBACK` (OnceLock<Box<dyn Fn>>), `LAST_FOREGROUND_IS_DESKTOP` (AtomicBool), `OVERLAY_ALPHA` (AtomicU8), `PET_RECT` (Mutex).
- **`src-tauri/src/platform/mod.rs`** — cross-platform facade: `pub use windows::{install_overlay_hooks, update_overlay_alpha, update_pet_rect}` on Windows; no-op stubs on `cfg(not(windows))`. New `OverlayHwnd` type alias.
- **`src-tauri/src/commands.rs`** — three new commands: `install_overlay_hooks(app)` (gets webview "overlay" HWND, calls `platform::install_overlay_hooks` with a closure that emits `VisibilityEvent { visible }`), `update_pet_rect(left, top, w, h)`, `set_overlay_alpha(alpha: u8)`.
- **`src-tauri/src/lib.rs`** — registers the 3 new commands.
- **`vite.config.ts`** — added `@layout-region` alias (was missing — only `@pretext-layout`/`@content-model`/`@` were there; `@layout-region` was only in `vitest.config.ts`). Removed stale `@attention` and `@ai-client` aliases (packages deleted previous sessions).
- **`tsconfig.app.json`** — added `"@/*": ["src/*"]` path alias (was in vite/vitest config but missing from tsc; my new code uses `@/lib/tauri`).

### What still needs cleanup (next slices own these)

- **`src/lib/compositor.ts`** — still a throwing stub (`decodeImage`/`composite` throw). Not called by the overlay (overlay renders Canvas directly). Slice #10/#11 may finally delete it; for now it keeps `tsc -b` green.
- **`src/sections/ContentSection.tsx` + `WallpaperSection.tsx`** — still stubbed placeholders. Slice #10 replaces with ADR-0019 内容/设置 UI.
- **`src/App.tsx`** — still uses old two-section nav. Slice #10 collapses to ADR-0019 layout.
- **`tray.rs`** — still has pre-pivot menu structure. Slice #11 collapses to 2 actions per ADR-0023.
- **`commands.rs`** still registers vestigial commands (`get_rotation_state`, `set_rotation_state`, `next_set`, `pause_one_hour`, `get_models_status`, `apply_wallpaper`, `restore_wallpaper`, `get_wallpaper_profile`, `set_wallpaper_profile`). Slice #11 audit.
- **Stale dev DB**: existing installs from before slice #3's schema rewrite have a `settings` table WITHOUT the `id` column (pre-pivot key/value schema). `CREATE TABLE IF NOT EXISTS` won't migrate. Symptom on `tauri:dev`: `sqlite: table settings has no column named id`. Workaround for dev: delete `%APPDATA%\com.attentionwallpaper.desktop\attention-wallpaper.sqlite`. Production install (slice #11) should ship a migration or a "first run" delete.
- **Spritesheet loading** — not implemented. Pet is a placeholder colored rect. ADR-0020 spritesheet (`pet.json` + `spritesheet.webp`) loading + Codex-format atlas rendering is a follow-up slice. The `PET_COLOR_BY_STATE` map in `OverlayWindow.tsx` is a stand-in for visual state verification.
- **Icon-rect event subscription** — currently a 5-second poll inside `onFrame`. ADR-0022 mentions "recompute on movement"; an event-driven subscription (e.g. on `SHELLDLL_DefView` icon-list change) is a future refinement.

## Next-session entry point

**Two paths depending on user's verdict on slice #9:**

### If user signs off #9 visually → close #9 + start #10

1. `gh issue close 9 --repo xie-st/attention-wallpaper --comment "Verified by user."`
2. **Slice #10 (Editor Window rewrite)** — `ready-for-human`. Per HANDOFF:
   - Use `anthropics/skills@frontend-design` + `vercel-labs/agent-skills` (`web-design-guidelines`, `vercel-react-best-practices`, `vercel-composition-patterns`). Aesthetic directive is non-negotiable (light/clean/sage, line icons, no shadows/motion).
   - Replace stubbed `ContentSection.tsx` + `WallpaperSection.tsx` + the old two-section nav in `App.tsx` with the ADR-0019 layout: 内容 (article list + import button — depends on #4 if a real importer is wanted; otherwise seed with `bridge.createArticle({ id: crypto.randomUUID(), title, plainText, paragraphs, importedAt: Date.now() })`) and 设置 (background color picker + pet package + pet rate slider + pet pause toggle + 关于 footer).
   - HITL flow: verification gate → push WITHOUT `closes #10` → `gh issue comment 10` with visual-verification checklist → wait for user → `gh issue close 10`.

### If user reports z-order / hit-test / visibility issues on #9 → diagnose

Per `diagnose` skill: build feedback loop (the `tauri:dev` console + user observation is the loop), reproduce, hypothesise, instrument, fix, regression-test. Common failure modes I anticipate:
- **WM_NCHITTEST subclass doesn't intercept on Tauri's window** — Tauri's webview host may have its own WndProc installed after ours. Symptom: clicks either fully absorbed or fully pass-through; pet double-click doesn't work. Fix: use `SetWindowLongPtrW(GWL_WNDPROC, ...)` instead of `SetWindowSubclass` (more invasive, can chain to previous). Document in ADR-0025 amendment.
- **WinEventHook callback doesn't fire** — Tauri's message loop may not pump the right events. Symptom: overlay never auto-hides. Fix: `PeekMessage` filter, or fall back to polling `GetForegroundWindow` on a timer in Rust.
- **Alpha tween visible but pet doesn't pause** — frontend `shouldStepPet` not respected. Symptom: pet keeps walking at alpha=0. Fix: check `vis.shouldStepPet` gating in `onFrame` (already there, but verify).

If a non-trivial z-order redesign surfaces again, re-load the `brainstorming` skill first.

### After #10 + #9 signed-off: #11 (tray + wiring + build smoke)

After completing #11, follow `finishing-a-development-branch` skill (adapted for direct-to-main workflow). Run `npx pnpm tauri:build` for smoke. Update this HANDOFF to "10/10 slices done". Close #1 manually.

## Skills to use next session

(Same set as previous handoff, with deltas from this session:)
- `verification-before-completion` — IRON LAW. Fresh typecheck + tests + tauri:dev smoke before every commit/push. Re-run after push for HITL slices.
- `tdd` — vertical red-green for pure logic. This session used it for `visibility.ts` (13 tests, ~30 min). Reuse for #4 importer (sentence segmentation), editor UI logic (#10), tray logic (#11).
- `diagnose` — if #9 HITL surfaces z-order/hit-test issues, or any test red is unexpected. Don't skip Phase 1 (build feedback loop); the user's observation + devtools console is the loop for visual bugs.
- `brainstorming` — HARD-GATE before any non-trivial design change. Used this session for the z-order pivot → ADR-0025.
- `prototype` — used this session for `prototype/overlay-zorder/` (4 HITL rounds to disprove ADR-0024 + validate ADR-0025 mechanism). Reuse for any "does this Win32/web API actually behave as documented" question. Skill rule: throwaway, one-command-run, delete or absorb verdict.
- `grill-with-docs` — for any new architectural question. Use ADR-FORMAT.md (1-3 sentences + optional Considered Options/Consequences). Only offer ADR when (a) hard to reverse, (b) surprising without context, (c) real trade-off.
- `anthropics/skills@frontend-design` + `vercel-labs/agent-skills` — load before #10 (Editor UI rewrite).
- `finishing-a-development-branch` — after #11.
- `handoff` — update this file at session end.

## Conventions established (this session + prior)

(Same as previous handoff. Key delta this session:)

- **ADR-0025 powershell-vs-cargo**: when running `cargo` from PowerShell, the cmdlet's stderr-from-cargo-warning-channels triggers PowerShell's "NativeCommandError" red noise. It's harmless — the `:104...` is a category ID, not an error. Read the actual cargo output line-by-line for `error[E...]` and `warning:`.
- **`tauri.conf.json` second window entry**: window `label` is now required (was implicit before). Editor window has `label: "editor"`, overlay has `label: "overlay"`. The Rust side `app.get_webview_window("overlay")` relies on this label to fetch the HWND for subclass.
- **Window routing via URL query**: `index.html?window=overlay` is read by `src/main.tsx` to dispatch to `OverlayWindow` vs `App`. Works in both dev (`vite` serves `/index.html?window=overlay`) and build (`tauri build` bundles the same html). No Vite multi-entry config needed.
- **`@/*` path alias now in tsconfig.app.json** too (was only in vite/vitest configs). Future `@/...` imports will now typecheck.
- **Two stale aliases dropped from `vite.config.ts`**: `@attention` and `@ai-client` (packages deleted in earlier sessions; the aliases were dead but harmless until they broke something). Now removed.
- **Prototype build artifacts**: `prototypes/*/target/` should be gitignored. `prototype/overlay-zorder/.gitignore` with `/target` is the pattern. Future prototypes should include this from the start.

## Specific gotchas the next agent should know

(Same as previous handoff, items 1-14 unchanged. New items this session:)

15. **The z-order strategy pivoted (ADR-0025)**. Pre-ADR-0025 references (in code comments, ADRs, or the codex pet analogy) to "desktop layer" / "below normal windows" / "WorkerW parent" should be read as historical. The actual implementation is topmost + selective WM_NCHITTEST + foreground-window auto-hide. ADR-0024 is superseded but kept as historical record.

16. **`install_overlay_hooks` must run after `app.get_webview_window("overlay")` exists**. The frontend calls it on mount via `invoke("install_overlay_hooks")`. If you restructure setup, ensure it is called once, after the overlay webview is created; not idempotent across HWND reinstalls (the `SetWindowSubclass` will technically re-install but the static `OVERLAY_APP_HANDLE` `OnceLock` will hold a stale handle if the app is restarted in-process).

17. **`OVERLAY_ALPHA` is `AtomicU8` in [0, 255], not [0, 1]**. Frontend `set_overlay_alpha` command takes `u8`. The visibility reducer's `nextAlpha` is in [0, 1]; the frontend converts `Math.round(nextAlpha * 255)` before calling. `WM_NCHITTEST` gates on `OVERLAY_ALPHA.load() == 0` — full transparency threshold.

18. **`PET_RECT` is in **screen** coordinates (not window-client)**. `WM_NCHITTEST`'s `lparam` packs screen coords as LOWORD(x), HIWORD(y). The frontend publishes pet rect via `invoke("update_pet_rect", { left, top, w, h })` where left/top are the on-screen pixel positions of the Canvas (which fills the screen, so they equal the canvas-relative coords). If the overlay window is ever moved off (0,0), the pet-rect-to-screen conversion must be re-evaluated.

19. **The codex pet on Windows is not a Tauri app**. ADR-0020 cited "CoPet (Tauri 2 + Rust + React) demonstrates the architecture works" — that reference was inaccurate for Windows; the actual Windows codex pet (`ziyan-codex-usage-pet`) is C# WinForms with `TopMost = true`. ADR-0025's reference to it is the corrected version. Don't quote ADR-0020's CoPet-as-Windows-precedent again.

20. **WinEventHook fires on the calling thread's message loop** (Tauri main thread, since we call from a Tauri command). The callback must not block. The current closure does one Tauri `emit` (thread-safe + non-blocking). If you add heavier work, move it to a separate thread or use `app_handle.run_on_main_thread`.

21. **The prototype `prototype/overlay-zorder/` is a separate Cargo project**, not part of the workspace. `cargo build` from `src-tauri/` won't touch it. To rebuild it: `cargo build --manifest-path prototype/overlay-zorder/Cargo.toml`. To run: `cargo run --manifest-path prototype/overlay-zorder/Cargo.toml -- --hittest|workerw`. Don't add it to the workspace — it's throwaway.

## Suggested commit cadence for next session

(Same as previous handoff. For HITL slice #10, follow the #9 pattern: verification gate → push WITHOUT `closes #N` → `gh issue comment <N> --body-file <verify-checklist.md>` → wait for user → `gh issue close <N> --comment "Verified by user."`.)
