# Overlay z-order: topmost + foreground-window auto-hide — supersedes ADR-0024

The Overlay Window is a **topmost** top-level window (`WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`) with **selective mouse hit-test** (pet rect returns `HTCLIENT`; everywhere else returns `HTTRANSPARENT` so clicks pass through to whatever is below — desktop icons or other windows). Visibility is driven by **foreground-window detection**: when the foreground window is NOT the desktop (Progman/WorkerW), the overlay fades out (~200ms alpha→0) and the PetBehavior loop pauses; when the user returns to the desktop (clicks empty desktop / Win+D), the overlay fades back in (~200ms alpha→1) and the loop resumes. When alpha=0 the hit-test returns `HTTRANSPARENT` everywhere (including the pet rect) so invisible pets can't be accidentally double-clicked.

## Why

The desktop-layer z-order approach (ADR-0024: `SetParent(WorkerW/Progman)`, "below normal windows, above wallpaper, survives Win+D") was empirically disproven by a throwaway prototype (`prototype/overlay-zorder/`). Three Windows desktop-layer techniques were tested:

- **A `SetParent(overlay, WorkerW)`** — overlay disappears entirely. The wallpaper-painting WorkerW sits *below* SHELLDLL_DefView (the desktop icon ListView), which is a full-screen opaque ListView that covers whatever is below it. So parent-to-WorkerW hides the overlay behind the icon layer.
- **Progman-child** (`SetParent(overlay, Progman)` + `SetWindowPos(overlay, HWND_TOP)` above defview) — z-order reorder succeeds (verified via `GW_HWNDPREV`), but **Progman does not paint child windows**. Shell windows only render SHELLDLL_DefView; other children stay invisible regardless of z-order. This is why Wallpaper Engine uses WorkerW, not Progman.
- **B `HWND_BOTTOM + WS_EX_TOOLWINDOW`** (no SetParent) — passes the three product-critical criteria (icons clickable ✓, pet double-click ✓, covered by Notepad ✓) but fails Win+D (Win+D minimizes all non-topmost top-level windows; `HWND_BOTTOM` is still a normal top-level, no shell privilege).

The codex pet on Windows (`993031749-design/ziyan-codex-usage-pet`, C# WinForms) avoids Win+D by using `TopMost = true` — topmost windows are not minimized by Win+D. But naive topmost contradicts ADR-0024's "covered by normal windows" intent (text would float over the editor/browser as a ghost overlay). The foreground-window auto-hide in this ADR resolves that contradiction: the overlay is topmost (so immune to Win+D) but visually retreats whenever the user is focused on a non-desktop window — restoring the "ritual exposure" semantics of ADR-0024 (text visible when at the desktop, invisible while working) through a different mechanism.

## Considered options

- **Topmost + foreground-window auto-hide** (accepted) — immune to Win+D; retreats when user focuses any non-desktop window; preserves pet double-click when visible; pet pauses while hidden (no invisible scrolling). Detection via `WinEventHook(EVENT_SYSTEM_FOREGROUND)` + `GetForegroundWindow()` classname check for `Progman`/`WorkerW`.
- **Desktop layer via `SetParent(WorkerW)`** (ADR-0024 original, rejected by prototype) — overlay invisible behind SHELLDLL_DefView.
- **`HWND_BOTTOM` top-level** (B, partial) — fails Win+D.
- **Topmost always-visible** (codex pet approach, rejected) — text floats over editor/browser, disturbs focused work (the original ADR-0024 objection).
- **Topmost + hide only on fullscreen/maximized windows** (rejected) — needs threshold tuning; maximized editor still shows ghost text at edges; non-maximized overlapping windows still covered confusingly. Foreground-window detection is simpler and matches the user's "上面一有东西就隐藏" intent exactly.

## Consequences

- `tauri.conf.json` overlay window config: `transparent: true`, `decorations: false`, `alwaysOnTop: true` (changed from ADR-0024's `false`), `skipTaskbar: true`, `resizable: false`, sized to primary monitor work area. (`alwaysOnTop: true` gets the Win+D immunity; auto-hide handles the visual-retreat concern.)
- Rust side (`src-tauri/src/platform/windows.rs`): one command `apply_overlay_z_order(hwnd)` that applies `WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` if not already, and installs a `WinEventHook(EVENT_SYSTEM_FOREGROUND)` callback. The callback emits a Tauri event `overlay://visibility` with `{ visible: bool }` (true if foreground classname ∈ {Progman, WorkerW}). The overlay React component listens, drives a 200ms alpha tween via `UpdateLayeredWindow`/Canvas alpha, and pauses/resumes `PetBehavior.step` at the alpha=0 / alpha>0 boundary.
- `WM_NCHITTEST` handler (Rust, subclass on the overlay HWND): returns `HTCLIENT` inside the current pet rect, `HTTRANSPARENT` elsewhere — but when overlay alpha == 0, returns `HTTRANSPARENT` everywhere. Pet rect is pushed from the frontend each frame via a Tauri command or a shared atomic.
- PetBehavior pauses while hidden: `step` is not called when `alpha == 0`. Pet position, article progress, and the `savedWalkingState`/`celebratedMs` round-trip state (per HANDOFF gotcha #9) are preserved across the pause; resuming replays them unchanged.
- Multi-monitor: overlay covers primary monitor work area only (ADR-0019 MVP scope). Foreground-window check is global (any non-desktop foreground hides the overlay), even if the foreground window is on a secondary monitor — acceptable for MVP.
- `EVENT_SYSTEM_FOREGROUND` fires on every foreground change (window switch, taskbar click, etc.) — cheap, no polling. One callback registration at app startup, unregistered at quit.
- The "ritual exposure" wording in ADR-0024 line 7 still holds in spirit (text visible when returning to desktop, invisible while working) — only the z-order mechanism changes. ADR-0024's "How (Tauri/Windows implementation)" section is voided by this ADR.
- `prototype/overlay-zorder/` is retained as historical evidence for the rejection of the desktop-layer approach; its `NOTES.md` documents the empirical verdicts. Delete after one release cycle if no longer referenced.

## Superseded

- **ADR-0024** — its z-order mechanism (`SetParent(WorkerW/Progman)`, "below normal windows, above wallpaper") is voided. The user intent (ritual exposure, covered while working, survives Win+D) is preserved via the topmost + auto-hide mechanism in this ADR. ADR-0024 stays in `docs/adr/` as historical record with a `Superseded by ADR-0025` note.
