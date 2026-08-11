# Tray actions reduced to four

The system tray context menu has four items: **打开编辑器** / **下一组** / **暂停一小时** / **退出**. "重新布局", "恢复原壁纸", "设置" are removed from the tray — they require seeing state and belong inside the editor (壁纸 section / 壁纸 section / 设置 page respectively).

## Why

The tray's real value is rotation control without opening the window: "下一组" advances the current set, "暂停一小时" pauses cadence. "打开编辑器" and "退出" are universal. The removed three ("重新布局" / "恢复原壁纸" / "设置") are stateful actions better performed with full visual context inside the app. Seven items overloads a single right-click menu and contradicts 简洁美观; four items are legible at a glance. Submenus (C) hide functionality behind an extra layer for no gain in a single-user MVP.

## Consequences

- `src-tauri/src/tray.rs` menu shrinks from 7 → 4 items.
- "重新布局" lives in 壁纸 section as a button.
- "恢复原壁纸" lives in 壁纸 section as a button (next to apply).
- "设置" is reachable only via the editor's settings entry (gear icon in title bar or similar).
- "暂停一小时" remains a tray one-shot; its state is surfaced inside 设置 or 壁纸 section.
