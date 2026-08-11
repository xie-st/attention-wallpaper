# Overlay z-order prototype — NOTES

## Question

Which Win32 z-order strategy satisfies ADR-0024's four criteria (visible above wallpaper / icons clickable / pet double-clickable / covered by normal windows + Win+D reappear)?

## Answer

**None.** The desktop-layer z-order approach (ADR-0024) is empirically impossible on Windows. The product pivots to **topmost + foreground-window auto-hide** (ADR-0025).

## Empirical results

| Check | A1 `SetParent(WorkerW)` | A2 `SetParent(Progman)` + HWND_TOP | B `HWND_BOTTOM` top-level + hit-test | Codex pet (reference) |
|-------|--------------------------|------------------------------------|----------------------------------------|------------------------|
| 1. Icons clickable | (untested — overlay invisible) | (untested — overlay invisible) | ✅ yes | ✅ yes (click-through) |
| 2. Pet double-click | (untested — invisible) | (untested — invisible) | ✅ yes | ✅ yes (toggle) |
| 3. Empty-desktop dblclk | (untested) | (untested) | ❌ no (acceptable) | n/a |
| 4. Notepad covers | (untested) | (untested) | ✅ yes | ❌ no (topmost) |
| 5. Win+D reappears | (untested) | (untested) | ❌ no | ✅ yes (topmost) |
| Visible at all | ❌ hidden behind SHELLDLL_DefView | ❌ Progman doesn't paint children | ✅ yes | ✅ yes |

### A1: `SetParent(overlay, WorkerW)` — invisible

The wallpaper-painting WorkerW sits **below** SHELLDLL_DefView (the desktop icon ListView). SHELLDLL_DefView is a full-screen opaque ListView that covers whatever is below it. So parent-to-WorkerW hides the overlay behind the icon layer. Diagnosis logs: `SetParent(overlay=0xa50242, target=0xc085c)` succeeded; overlay disappeared from desktop.

### A2: `SetParent(overlay, Progman)` + `SetWindowPos(overlay, HWND_TOP)` — invisible despite correct z-order

z-order verified correct: `defview's GW_HWNDPREV = 0xaf0242 == overlay` (overlay is the sibling directly above defview). But overlay still invisible — **Progman does not paint child windows** other than SHELLDLL_DefView. This is a shell-window behavioral constraint; it's why Wallpaper Engine uses WorkerW, not Progman.

Also observed: `SetWindowPos` size was honored in logical-pixel space but the window appeared at half-size on screen (DPI scaling interaction with shell windows — further fragility evidence).

### B: `HWND_BOTTOM + WS_EX_LAYERED + WM_NCHITTEST` (selective hit-test) — 3/4

Passes icons clickable ✓, pet double-click ✓, Notepad covers ✓. Fails Win+D: HWND_BOTTOM is still a normal top-level, no shell privilege, gets minimized with everything else.

### Codex pet reference (ziyan-codex-usage-pet, C# WinForms)

Inspection of `src/ZiyanUsagePet.cs`:
- `TopMost = true` (ordinary top-level pinned to topmost z-order)
- `WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` + `UpdateLayeredWindow`
- `WS_EX_TRANSPARENT` toggle + `WM_NCHITTEST → HTTRANSPARENT`
- **No WorkerW/Progman/SetParent/desktop-layer code.**

"codex pet不受 Win+D" = `TopMost = true` (topmost not minimized by Win+D). Cost: floats over normal windows. The codex pet is a status indicator (always visible is fine); for our article-text overlay, that contradicts ADR-0024's "covered while working" intent — resolved in ADR-0025 by adding foreground-window auto-hide.

## Winner → ADR-0025

**Topmost + foreground-window auto-hide.** See `docs/adr/0025-overlay-topmost-foreground-autohide.md`. ADR-0024 is superseded.

## What to lift into the real overlay

- `tauri.conf.json`: `transparent: true`, `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`.
- Rust `apply_overlay_z_order(hwnd)` command: apply `WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` + install `WinEventHook(EVENT_SYSTEM_FOREGROUND)` callback.
- Rust `WM_NCHITTEST` subclass: `HTCLIENT` inside pet rect, `HTTRANSPARENT` elsewhere; full `HTTRANSPARENT` when alpha == 0.
- React overlay component: listen to `overlay://visibility` event, drive 200ms alpha tween, pause `PetBehavior.step` at alpha == 0.

## Throwaway status

This prototype (`prototype/overlay-zorder/`) is retained per ADR-0025 as historical evidence for the rejection of the desktop-layer approach. Delete after one release cycle if no longer referenced.
