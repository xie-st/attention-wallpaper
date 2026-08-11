# Wallpaper section: local file import only

The "壁纸" section imports wallpapers via a single mechanism: a file picker that accepts PNG/JPG from the local filesystem. No built-in image gallery, no URL download, no folder-watch auto-rotation. The imported image is copied into the app's local data directory and referenced from SQLite.

## Why

The Passage is the product; the wallpaper is a carrier. A single-user local-first app has no need for a curated built-in gallery (B), which just adds bundle size and curation effort. URL download (C) introduces a network surface and copyright questions that contradict the README's no-network-sneakiness spirit. Folder-watch auto-rotation (D) is a nice future feature but out of MVP scope — the user imports one image and uses it until they choose another.

## Considered options

- **Local file import only** (accepted) — simplest, local-first-honest.
- **Local file + built-in gallery** (B) — product-padding; rejected.
- **Local file + URL paste** (C) — network + copyright surface; rejected.
- **Folder-watch** (D) — future nice-to-have; deferred.

## Consequences

- `src/sections/壁纸/` gains a single import button (Tauri file dialog) → copies PNG/JPG to app data dir → stores path in SQLite.
- Import and apply are decoupled: import stores the image and shows a preview; a separate "应用到桌面" button runs the attention analysis → Passage selection → composite → `IDesktopWallpaper::SetWallpaper` pipeline. Users don't accidentally mutate the desktop by importing.
- Single current wallpaper: importing a new image replaces the stored current wallpaper. No wallpaper library/gallery UI in the MVP. The previous image file is deleted from the data dir on replacement (or overwritten in place).
- No network code in the wallpaper section.
- Folder-watch / wallpaper library remain clean future additions.
