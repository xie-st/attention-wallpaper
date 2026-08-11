# Overlay z-order prototype

Throwaway prototype that empirically validates the Win32 z-order strategy for the Overlay Window (issue #9 / ADR-0024 / candidate ADR-0025). NOT production code. Delete after the verdict is folded into ADR-0025.

## Question

Which of two Win32 z-order strategies satisfies ALL of:
1. overlay renders above wallpaper (visible)
2. desktop icons remain clickable
3. the "pet" rect receives double-click (core rewind/advance gesture)
4. opening a normal window (Notepad) covers the overlay; Win+D reveals it

## Strategies

- **A `--workerw`** — `SetParent(overlay, WorkerW)`; overlay rendered BEHIND the desktop icon listview (`SHELLDLL_DefView`). Hypothesis: icons clickable but SHELLDLL_DefView eats empty-desktop clicks, so pet double-click never arrives.
- **B `--hittest`** (default) — top-level `HWND_BOTTOM` + `WS_EX_LAYERED` + `WM_NCHITTEST` returning `HTTRANSPARENT` everywhere except the pet rect. Classic desktop-pet technique. Overlay sits just above the desktop icons, forwards all non-pet clicks to them, captures pet clicks.

## Run

```
cargo run --manifest-path prototype/overlay-zorder/Cargo.toml -- --workerw
cargo run --manifest-path prototype/overlay-zorder/Cargo.toml -- --hittest
```

A translucent-green overlay covers the work area; a solid-red "pet" square sits at center-bottom. Watch the console for click logs.

## HITL checklist (fill NOTES.md with the verdict)

For each strategy, perform:
1. Click a desktop icon — does it open/select? (icons usable?)
2. Double-click the RED pet — does the console print `WM_LBUTTONDBLCLK`?
3. Double-click empty desktop — does the console log a click? (B=yes expected, A=no expected)
4. Open Notepad over the area — is the overlay hidden under Notepad?
5. Win+D — does the overlay reappear? are icons still usable?

Right-click the overlay (if reachable) or Ctrl+C in the console to quit.
