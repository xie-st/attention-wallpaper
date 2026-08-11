# Auto multi-monitor; merge 显示器 into 壁纸 section

Every detected monitor automatically gets one **Passage** applied — no manual target selection. The separate "显示器" UI section is removed; its concerns (per-monitor preview, apply, restore) fold into the "壁纸" section. The MVP has **2 top-level UI sections**: **内容** and **壁纸**.

## Why

ADR-0001 made each monitor show exactly one Passage with no cross-monitor repeats, so "which monitor?" is no longer a user decision — it's automatic. A standalone 显示器 tab with no decision to make is dead UI. Merging into 壁纸 keeps the wallpaper lifecycle in one place: import image → (auto multi-monitor) → preview per monitor → apply → restore. Manual target selection (option B) adds controls for a choice the user doesn't need to make under ADR-0001.

## Consequences

- UI sections: 3 → 2 (内容 / 壁纸); 设置 remains as a separate page.
- 壁纸 section gains per-monitor preview thumbnails and apply/restore-all actions.
- `IDesktopWallpaper::SetWallpaper` per-device-path application stays; GDI fallback for enumeration stays (per README limitation #5).
- README's "显示器" section references merge into "壁纸".
- App startup lands on the 壁纸 tab by default (no persisted last-tab). Opening the app is usually a "what's on the wall / next set" intent, not a "go read articles" intent.
