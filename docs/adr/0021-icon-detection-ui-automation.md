# Desktop icon detection via UI Automation

The overlay window's text layout adapts to actual desktop icon positions. To enable this, the app detects icon rectangles via the **Windows UI Automation API** (the `uiautomation` Rust crate, or equivalent windows-sys COM calls into `IUIAutomation`), enumerating the desktop's SysListView32 child elements and reading each item's `BoundingRectangle` property. The result is a list of screen-space rects the layout engine must avoid.

## Why

The user's vision is dynamic text-column placement: scan which vertical columns of the desktop are free of icons, group adjacent free columns into text regions, and pad around stray icons inside otherwise-empty regions. This requires real icon positions — the prior stub (`platform/windows.rs:223-225` returning a hard `Err`) is now load-bearing. UI Automation is Microsoft's recommended modern path for reading another window's logical tree, is stable across Windows 10/11, and has a pure-Rust crate (`uiautomation`) that bundles cleanly. The legacy `SendMessage(LVM_GETITEMRECT)` alternative is fragile under UIPI and dodgy across process boundaries; screenshot-based detection is heavy and unreliable; manual user selection loses the "auto-adapt" property that motivates the whole feature.

## Considered options

- **UI Automation API** (accepted) — Microsoft-recommended, stable, Rust crate available, gives logical rects without pixel scraping.
- **SendMessage LVM_GETITEMRECT** (rejected) — fragile under UIPI; Windows-version-dependent.
- **Screenshot + icon detection** (rejected) — heavy, unreliable, requires CV.
- **User picks text regions manually** (rejected) — loses auto-adapt, the feature's whole point.

## Consequences

- New Cargo dep: `uiautomation` (or equivalent windows-sys COM wiring into `IUIAutomation`).
- `src-tauri/src/platform/windows.rs` `get_desktop_icon_rects` is implemented; the README limitation #4 ("UI Automation adapter not wired") is now resolved for MVP.
- `src-tauri/src/platform/mod.rs` fallback path (empty rects when detection fails) stays as defensive behavior — layout degrades to "no avoidance" rather than crashing.
- A new layout module (working name: `packages/layout-region/` or under `packages/pretext-layout/`) consumes `(iconRects[], screenRect)` → produces `(textRegions[])` for the column layout. Algorithm details deferred to a follow-up grilling round.
- The previous assumption "icons on the left, two fixed columns on the right" is void; column count and position are now data-driven.
- Cross-platform dev (non-Windows) — icon detection unavailable; layout falls back to "no icons to avoid" (full-screen columns).
- `packages/attention` is still deleted (ADR-0019); this module is independent of saliency analysis.
