# Tray reduced to two actions: open editor + quit

Supersedes ADR-0014's four-action tray. Under the pivot (ADR-0019: pet-driven scroll, no time-based rotation), "下一组" and "暂停一小时" have no referent — there is no rotation set to advance and no cadence to pause. The tray's only purpose now is app lifecycle: showing the editor window and quitting the app. All pet/scroll control lives in the desktop overlay (pet gestures: double-click = rewind or advance-to-next-article) or in the editor window (pause pet, jump to article start, switch article buttons).

## Why

Pet-driven scroll interaction happens on the desktop surface (double-click the pet), not in the system tray. Splitting pet control between the tray menu and the pet gestures creates two interaction paradigms for the same concern. Editor-window buttons can cover any management action (pause, jump-to-start, next-article) without the tray competing. A two-item tray is the minimum informative set — life-cycle only.

## Consequences

- `src-tauri/src/tray.rs` menu shrinks from 4 → 2 items: `打开编辑器` + `退出`.
- `tray://next-set` and `tray://pause-one-hour` listeners removed from `App.tsx`.
- Editor window gains management buttons: 暂停宠物, 回到文章开头, 跳到下一篇 (exact set to be grilled in editor-UI round).
- ADR-0014 is superseded by this ADR-0023.
