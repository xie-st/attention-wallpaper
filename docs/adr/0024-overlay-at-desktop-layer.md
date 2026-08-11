# Overlay window at desktop layer (below normal windows, above wallpaper)

**Status: superseded by [ADR-0025](0025-overlay-topmost-foreground-autohide.md)** — the desktop-layer z-order mechanism (`SetParent(WorkerW/Progman)`) was empirically disproven by the `prototype/overlay-zorder/` prototype: WorkerW-parent hides the overlay behind SHELLDLL_DefView (full-screen opaque icon ListView), and Progman does not paint child windows. ADR-0025 achieves the same user intent (ritual exposure, covered while working, survives Win+D) via a topmost window + foreground-window auto-hide. The "Why" section below still holds; the "How" section is voided.

The Overlay Window sits at the **desktop layer**: above the wallpaper and desktop icons, but **below normal application windows**. When the user has any ordinary window open (browser, editor, etc.), the overlay is covered and invisible. When the user returns to the desktop (minimizes all windows or Win+D), the article text + pet reappear.

## Why

The user's intent (original product motivation): "I have articles I deeply agree with that I want to be reminded of by looking at them every day." Concretely, this means seeing the text at moments like **when first turning on the computer in the morning**, or when deliberately returning to the desktop — *not* while working with other windows open. This matches the "ritual exposure" pattern: text is a backdrop you choose to see by going to the desktop, not an always-on-top layer that floats over your work. Option A (always-on-top + click-through) would put ghost-text over the user's editor/browser, contradicting the "doesn't disturb while working" intent.

## How (Tauri / Windows implementation)

- The Overlay Window is created as a normal Tauri window (not `always_on_top`), then its z-order is forced to the desktop layer via `SetWindowPos(HWND_BOTTOM)` or by setting `WS_EX_TOOLWINDOW` and parenting it to `Progman`/`WorkerW` (the same technique used by Wallpaper Engine and other desktop-replacement tools to render *behind* icons but *above* the wallpaper).
- Exact parenting strategy (Progman vs WorkerW vs HWND_BOTTOM) to be validated during implementation; the goal is "below normal windows, above wallpaper, survives Win+D show-desktop".
- The window is transparent (`transparent: true`, `decorations: false`, frameless) and covers the primary monitor's work area (excludes taskbar).
- Mouse behavior: click-through disabled in this mode — clicks land on the overlay (so double-click on pet works), but the overlay is rarely visible while another window is focused, so accidental interception is minimal. Pet double-click works when at desktop; harmless otherwise.

## Considered options

- **Desktop layer (below normal windows, above wallpaper)** (accepted) — ritual exposure model, matches "see when returning to desktop".
- **Always-on-top + click-through (WS_EX_LAYERED + WS_EX_TRANSPARENT)** (A, rejected) — text floats over editor/browser as ghost overlay; disturbs focused work.
- **Always-on-top + no click-through** (B, rejected) — overlay blocks interaction with desktop icons; unusable.
- **Smart show/hide based on foreground window** (C, rejected) — requires foreground-window monitoring; complex; unpredictable to the user.

## Consequences

- `tauri.conf.json` overlay window config: `transparent: true`, `decorations: false`, `alwaysOnTop: false`, `skipTaskbar: true`, resizable false, fixed to primary monitor work area.
- Rust side: window-handle manipulation via `windows-sys` (`SetWindowPos` / `SetParent` to `Progman` or `WorkerW`) to push the overlay below normal windows but above wallpaper. Implementation detail deferred to coding time.
- The pet's Canvas animation loop continues running whether the overlay is visible or not — when the user returns to desktop, pet is wherever it walked to. (Alternative: pause when covered — TBD, deferred to a follow-up sub-decision. Default: keep running, simpler.)
- The 8×11 v2 pet "mouse gaze follow" feature (ADR-0020) is mostly inert in this mode — when covered, no mouse-over events reach the overlay. Acceptable; feature engages when at desktop.
- Taskbar: the overlay's work area excludes the taskbar (using `SystemParametersInfoW(SPI_GETWORKAREA)`); pet does not walk over the taskbar.
- The "ghost text over work" concern of option A is avoided — text is purely a desktop backdrop.
