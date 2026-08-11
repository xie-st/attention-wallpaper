#![cfg(windows)]

//! Windows-native wallpaper adapter. Desktop icon geometry deliberately uses
//! the conservative fallback until a real UI Automation provider is wired.

use std::ffi::{c_void, OsStr};
use std::os::windows::ffi::OsStrExt;
use std::ptr;

use windows_sys::core::GUID;
use windows_sys::Win32::Foundation::{BOOL, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows_sys::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_APARTMENTTHREADED,
};

use super::{MonitorInfo, Rect};

// CLSID_DesktopWallpaper: {C2CF3110-460E-4FC1-B9C0-CA5005005003}
const CLSID_DESKTOP_WALLPAPER: GUID = GUID {
    data1: 0xC2CF3110,
    data2: 0x460E,
    data3: 0x4FC1,
    data4: [0xB9, 0xC0, 0xCA, 0x50, 0x05, 0x00, 0x50, 0x03],
};

// IID_IDesktopWallpaper: {B92B56A9-8B55-4E14-9A89-0199BBB6F93B}
const IID_IDESKTOP_WALLPAPER: GUID = GUID {
    data1: 0xB92B56A9,
    data2: 0x8B55,
    data3: 0x4E14,
    data4: [0x9A, 0x89, 0x01, 0x99, 0xBB, 0xB6, 0xF9, 0x3B],
};

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

unsafe fn take_pwstr(value: *mut u16) -> String {
    if value.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *value.add(len) != 0 {
        len += 1;
    }
    let result = String::from_utf16_lossy(std::slice::from_raw_parts(value, len));
    CoTaskMemFree(value as *const c_void);
    result
}

#[repr(C)]
struct IDesktopWallpaperVtbl {
    query_interface: usize,
    add_ref: usize,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    set_wallpaper: unsafe extern "system" fn(*mut c_void, *const u16, *const u16) -> i32,
    get_wallpaper: unsafe extern "system" fn(*mut c_void, *const u16, *mut *mut u16) -> i32,
    get_monitor_device_path_at: unsafe extern "system" fn(*mut c_void, u32, *mut *mut u16) -> i32,
    get_monitor_device_path_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    get_monitor_rect: unsafe extern "system" fn(*mut c_void, *const u16, *mut RECT) -> i32,
}

#[repr(C)]
struct ComObj {
    vtable: *const IDesktopWallpaperVtbl,
}

struct DesktopWallpaper {
    ptr: *mut c_void,
    should_uninitialize: bool,
}

impl DesktopWallpaper {
    unsafe fn create() -> Result<Self, String> {
        let init_hr = CoInitializeEx(ptr::null(), COINIT_APARTMENTTHREADED as u32);
        let mut object: *mut c_void = ptr::null_mut();
        let hr = CoCreateInstance(
            &CLSID_DESKTOP_WALLPAPER,
            ptr::null_mut(),
            CLSCTX_ALL,
            &IID_IDESKTOP_WALLPAPER,
            &mut object,
        );
        if hr < 0 || object.is_null() {
            if init_hr >= 0 {
                CoUninitialize();
            }
            return Err(format!(
                "CoCreateInstance(IDesktopWallpaper) failed: 0x{:08X}",
                hr as u32
            ));
        }
        Ok(Self {
            ptr: object,
            should_uninitialize: init_hr >= 0,
        })
    }

    unsafe fn vtable(&self) -> &IDesktopWallpaperVtbl {
        &*(*(self.ptr as *const ComObj)).vtable
    }
}

impl Drop for DesktopWallpaper {
    fn drop(&mut self) {
        unsafe {
            (self.vtable().release)(self.ptr);
            if self.should_uninitialize {
                CoUninitialize();
            }
        }
    }
}

fn monitor_pointer(monitor_id: &str, storage: &mut Vec<u16>) -> *const u16 {
    if monitor_id.starts_with(r"\\?\") {
        *storage = wide(monitor_id);
        storage.as_ptr()
    } else {
        ptr::null()
    }
}

pub fn list_monitors() -> Result<Vec<MonitorInfo>, String> {
    match list_desktop_wallpaper_monitors() {
        Ok(monitors) if !monitors.is_empty() => Ok(monitors),
        _ => list_gdi_monitors(),
    }
}

fn list_desktop_wallpaper_monitors() -> Result<Vec<MonitorInfo>, String> {
    unsafe {
        let api = DesktopWallpaper::create()?;
        let mut count = 0u32;
        let hr = (api.vtable().get_monitor_device_path_count)(api.ptr, &mut count);
        if hr < 0 {
            return Err(format!(
                "GetMonitorDevicePathCount failed: 0x{:08X}",
                hr as u32
            ));
        }

        let mut monitors = Vec::with_capacity(count as usize);
        for index in 0..count {
            let mut raw_path: *mut u16 = ptr::null_mut();
            let hr = (api.vtable().get_monitor_device_path_at)(api.ptr, index, &mut raw_path);
            if hr < 0 || raw_path.is_null() {
                continue;
            }
            let path = take_pwstr(raw_path);
            let path_wide = wide(&path);
            let mut rect: RECT = std::mem::zeroed();
            let hr = (api.vtable().get_monitor_rect)(api.ptr, path_wide.as_ptr(), &mut rect);
            if hr < 0 || rect.right <= rect.left || rect.bottom <= rect.top {
                continue;
            }
            monitors.push(MonitorInfo {
                id: path,
                name: format!("Display {}", index + 1),
                width: (rect.right - rect.left) as u32,
                height: (rect.bottom - rect.top) as u32,
                is_primary: rect.left <= 0 && rect.top <= 0 && rect.right > 0 && rect.bottom > 0,
            });
        }
        Ok(monitors)
    }
}

fn list_gdi_monitors() -> Result<Vec<MonitorInfo>, String> {
    let mut monitors: Vec<MonitorInfo> = Vec::new();
    unsafe {
        let ok = EnumDisplayMonitors(
            ptr::null_mut(),
            ptr::null(),
            Some(enum_proc),
            &mut monitors as *mut _ as isize,
        );
        if ok == 0 {
            return Err("EnumDisplayMonitors failed".to_string());
        }
    }
    Ok(monitors)
}

unsafe extern "system" fn enum_proc(
    hmon: HMONITOR,
    _hdc: HDC,
    lprect: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let monitors = &mut *(lparam as *mut Vec<MonitorInfo>);
    let mut info: MONITORINFOEXW = std::mem::zeroed();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(hmon, &mut info as *mut _ as *mut MONITORINFO) != 0 {
        let rect = if lprect.is_null() {
            info.monitorInfo.rcMonitor
        } else {
            *lprect
        };
        let name_len = info
            .szDevice
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(info.szDevice.len());
        monitors.push(MonitorInfo {
            id: format!("fallback-{}", hmon as usize),
            name: String::from_utf16_lossy(&info.szDevice[..name_len]),
            width: (rect.right - rect.left) as u32,
            height: (rect.bottom - rect.top) as u32,
            is_primary: (info.monitorInfo.dwFlags & 1) != 0,
        });
    }
    1
}

pub fn get_desktop_icon_rects() -> Result<Vec<Rect>, String> {
    let raw = walk_uia_desktop_icons()?;
    Ok(collect_icon_rects(&raw))
}

/// Pure conversion from raw `(x, y, w, h)` tuples to `Rect` records.
/// Factored out so it can be unit-tested with a mock fixture without
/// standing up a real UIA tree (per issue #6 acceptance criteria).
pub fn collect_icon_rects(raw: &[(f64, f64, f64, f64)]) -> Vec<Rect> {
    raw.iter()
        .map(|&(x, y, w, h)| Rect { x, y, w, h })
        .collect()
}

/// Walk the desktop's `SHELLDLL_DefView > SysListView32` UIA subtree and
/// collect each icon's bounding rectangle as `(x, y, w, h)` in physical
/// screen coordinates. Returns an empty vec if the tree cannot be found
/// (empty desktop or shell not ready); errors only on UIA init failure.
fn walk_uia_desktop_icons() -> Result<Vec<(f64, f64, f64, f64)>, String> {
    use uiautomation::UIAutomation;
    use uiautomation::types::TreeScope;

    let uia = UIAutomation::new()
        .map_err(|e| format!("UIA init: {e}"))?;
    let root = uia
        .get_root_element()
        .map_err(|e| format!("UIA root: {e}"))?;

    // The desktop icon host lives under either Progman or WorkerW (when an
    // active wallpaper engine re-parents the icons). Find SHELLDLL_DefView
    // anywhere under the root, then its SysListView32 child.
    let condition = uia
        .create_true_condition()
        .map_err(|e| format!("UIA true condition: {e}"))?;
    let candidates = root
        .find_all(TreeScope::Descendants, &condition)
        .map_err(|e| format!("UIA descendents: {e}"))?;

    let mut def_view = None;
    for el in &candidates {
        if let Ok(name) = el.get_classname() {
            if name == "SHELLDLL_DefView" {
                def_view = Some(el.clone());
                break;
            }
        }
    }
    let def_view = match def_view {
        Some(v) => v,
        None => return Ok(Vec::new()),
    };

    let mut list_view = None;
    for el in def_view
        .find_all(TreeScope::Children, &condition)
        .map_err(|e| format!("UIA def_view children: {e}"))?
        .iter()
    {
        if let Ok(name) = el.get_classname() {
            if name == "SysListView32" {
                list_view = Some(el.clone());
                break;
            }
        }
    }
    let list_view = match list_view {
        Some(v) => v,
        None => return Ok(Vec::new()),
    };

    let items = list_view
        .find_all(TreeScope::Children, &condition)
        .map_err(|e| format!("UIA listview children: {e}"))?;
    let mut rects = Vec::new();
    for item in &items {
        if let Ok(r) = item.get_bounding_rectangle() {
            let (l, t, rr, b) = (
                r.get_left() as f64,
                r.get_top() as f64,
                r.get_right() as f64,
                r.get_bottom() as f64,
            );
            rects.push((l, t, rr - l, b - t));
        }
    }
    Ok(rects)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_icon_rects_returns_input_unmodified() {
        let fixture: Vec<(f64, f64, f64, f64)> = vec![
            (0.0, 0.0, 48.0, 48.0),
            (100.0, 200.0, 32.0, 32.0),
            (1920.0, 0.0, 48.0, 48.0),
        ];
        let out = collect_icon_rects(&fixture);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].x, 0.0);
        assert_eq!(out[0].y, 0.0);
        assert_eq!(out[0].w, 48.0);
        assert_eq!(out[0].h, 48.0);
        assert_eq!(out[1].x, 100.0);
        assert_eq!(out[1].y, 200.0);
        assert_eq!(out[2].x, 1920.0);
    }

    #[test]
    fn collect_icon_rects_empty_input_returns_empty() {
        let out = collect_icon_rects(&[]);
        assert!(out.is_empty());
    }

    #[test]
    fn collect_icon_rects_preserves_plausible_screen_coords() {
        let fixture = vec![(12.0, 24.0, 48.0, 48.0)];
        let out = collect_icon_rects(&fixture);
        assert_eq!(out.len(), 1);
        let r = &out[0];
        assert!(r.x >= 0.0 && r.x <= 4000.0);
        assert!(r.y >= 0.0 && r.y <= 4000.0);
        assert!(r.w > 0.0 && r.w <= 200.0);
        assert!(r.h > 0.0 && r.h <= 200.0);
    }
}

pub fn current_wallpaper_path(monitor_id: &str) -> Result<String, String> {
    unsafe {
        let api = DesktopWallpaper::create()?;
        let mut monitor_wide = Vec::new();
        let monitor = monitor_pointer(monitor_id, &mut monitor_wide);
        let mut raw_path: *mut u16 = ptr::null_mut();
        let hr = (api.vtable().get_wallpaper)(api.ptr, monitor, &mut raw_path);
        if hr < 0 || raw_path.is_null() {
            return Err(format!(
                "IDesktopWallpaper::GetWallpaper failed: 0x{:08X}",
                hr as u32
            ));
        }
        let path = take_pwstr(raw_path);
        if path.is_empty() {
            Err("current wallpaper path is empty".to_string())
        } else {
            Ok(path)
        }
    }
}

fn set_wallpaper_path(monitor_id: &str, path: &str) -> Result<(), String> {
    unsafe {
        let api = DesktopWallpaper::create()?;
        let mut monitor_wide = Vec::new();
        let monitor = monitor_pointer(monitor_id, &mut monitor_wide);
        let path_wide = wide(path);
        let hr = (api.vtable().set_wallpaper)(api.ptr, monitor, path_wide.as_ptr());
        if hr < 0 {
            Err(format!(
                "IDesktopWallpaper::SetWallpaper failed: 0x{:08X}",
                hr as u32
            ))
        } else {
            Ok(())
        }
    }
}

pub fn apply_wallpaper(monitor_id: &str, png_bytes: &[u8]) -> Result<String, String> {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("AttentionWallpaper")
        .join("generated");
    std::fs::create_dir_all(&base).map_err(|e| format!("create wallpaper cache: {e}"))?;
    let path = base.join(format!("{}.png", uuid::Uuid::new_v4()));
    std::fs::write(&path, png_bytes).map_err(|e| format!("write composed PNG: {e}"))?;
    let path_string = path.to_string_lossy().to_string();
    if let Err(error) = set_wallpaper_path(monitor_id, &path_string) {
        let _ = std::fs::remove_file(&path);
        return Err(error);
    }
    Ok(path_string)
}

pub fn restore_wallpaper(
    monitor_id: Option<&str>,
    original_path: Option<&str>,
) -> Result<String, String> {
    let path = original_path
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "no original wallpaper path saved".to_string())?;
    set_wallpaper_path(monitor_id.unwrap_or_default(), path)?;
    Ok(path.to_string())
}

// ===========================================================================
// Overlay window z-order + visibility hooks (ADR-0025).
//
// Strategy: the overlay is a topmost top-level window (Tauri config sets
// `alwaysOnTop: true` + `transparent: true` + `decorations: false`). This
// module applies `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`, installs a
// `WinEventHook(EVENT_SYSTEM_FOREGROUND)` that emits a Tauri event when the
// foreground becomes / stops being the desktop (Progman/WorkerW), and
// subclasses the overlay HWND so `WM_NCHITTEST` returns `HTCLIENT` inside the
// current pet rect and `HTTRANSPARENT` elsewhere (full `HTTRANSPARENT` when
// the overlay alpha is 0).
// ===========================================================================

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::OnceLock;

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowLongPtrW, SetWindowLongPtrW, EVENT_SYSTEM_FOREGROUND,
    GWL_EXSTYLE, HTCLIENT, HTTRANSPARENT, WINEVENT_OUTOFCONTEXT, WM_NCHITTEST, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW,
};

/// Holds the Tauri AppHandle (set once at install time) so the WinEventHook
/// callback — which is a raw function pointer — can reach back into Tauri to
/// emit events. Tauri's AppHandle is Send+Sync + Clone.
pub static OVERLAY_APP_HANDLE: OnceLock<()> = OnceLock::new();

/// Static slot for a visibility-changed callback. Set by `install_overlay_hooks`.
/// The callback is invoked from the WinEventHook thread.
type VisibilityCb = Box<dyn Fn(bool) + Send + Sync + 'static>;
static VISIBILITY_CALLBACK: OnceLock<VisibilityCb> = OnceLock::new();

/// Tracks the last reported foreground-is-desktop state so the hook only fires
/// the callback on actual transitions (not on every foreground change).
static LAST_FOREGROUND_IS_DESKTOP: AtomicBool = AtomicBool::new(true);

/// Current overlay alpha in [0, 255]. When 0, WM_NCHITTEST returns
/// HTTRANSPARENT everywhere (including the pet rect) — no pet double-click on
/// an invisible pet, per ADR-0025.
static OVERLAY_ALPHA: AtomicU8 = AtomicU8::new(0);

/// Current pet rect in screen coordinates (left, top, right, bottom). Updated
/// by the overlay frontend every frame via `update_pet_rect`.
struct PetRectState {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}
static PET_RECT: std::sync::Mutex<PetRectState> = std::sync::Mutex::new(PetRectState {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
});

/// Install the overlay z-order hooks: extended styles + WinEventHook + WndProc
/// subclass for selective WM_NCHITTEST. `on_visibility` is fired on
/// foreground-is-desktop transitions (true when the user returns to desktop,
/// false when any non-desktop window comes to the foreground). Idempotent —
/// safe to call multiple times; the subclass install is a no-op after the first.
pub fn install_overlay_hooks<F>(hwnd: HWND, on_visibility: F) -> Result<(), String>
where
    F: Fn(bool) + Send + Sync + 'static,
{
    let _ = VISIBILITY_CALLBACK.set(Box::new(on_visibility));

    unsafe {
        // Apply WS_EX_TOOLWINDOW (hide from taskbar/Alt+Tab) + WS_EX_NOACTIVATE
        // (don't steal focus when the user clicks on/near the overlay).
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_ex = ex
            | (WS_EX_TOOLWINDOW as isize)
            | (WS_EX_NOACTIVATE as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex);
        eprintln!("[overlay] applied WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE to hwnd={:#x}", hwnd as usize);

        // Install subclass for WM_NCHITTEST on the top-level window AND its
        // child webview (Tauri 2's webview is a child HWND; WM_NCHITTEST on the
        // top-level only fires for the non-client area, child area messages go
        // to the child). Subclassing both is the safe option.
        let ok = SetWindowSubclass(hwnd, Some(overlay_subclass_proc), 0xA601, 0);
        eprintln!("[overlay] SetWindowSubclass top-level hwnd={:#x} ok={}", hwnd as usize, ok);
        if ok == 0 {
            return Err("SetWindowSubclass (top-level) failed".to_string());
        }
        // Walk immediate children to find the webview (class Chrome_WidgetWin_0
        // or similar). Subclass each child so hit-test works inside the webview area.
        let mut child = windows_sys::Win32::UI::WindowsAndMessaging::GetWindow(
            hwnd,
            windows_sys::Win32::UI::WindowsAndMessaging::GW_CHILD,
        );
        while !child.is_null() {
            let mut cls = [0u16; 64];
            let n = GetClassNameW(child, cls.as_mut_ptr(), 64);
            let name = if n > 0 {
                String::from_utf16_lossy(&cls[..n as usize])
            } else {
                String::new()
            };
            let ok = SetWindowSubclass(child, Some(overlay_subclass_proc), 0xA602, 0);
            eprintln!("[overlay] SetWindowSubclass child hwnd={:#x} class='{}' ok={}", child as usize, name, ok);
            child = windows_sys::Win32::UI::WindowsAndMessaging::GetWindow(
                child,
                windows_sys::Win32::UI::WindowsAndMessaging::GW_HWNDNEXT,
            );
        }

        // Install WinEventHook for foreground changes. WINEVENT_OUTOFCONTEXT
        // means the callback is delivered via the message loop on the calling
        // thread (Tauri's main thread), not synchronously inside the hook.
        let hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            std::ptr::null_mut(),
            Some(foreground_event_callback),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
        eprintln!("[overlay] SetWinEventHook ok={}", !hook.is_null());
        if hook.is_null() {
            return Err("SetWinEventHook failed".to_string());
        }
    }
    Ok(())
}

/// Update the shared pet rect (screen coords). Called by the frontend every
/// frame, via the `update_pet_rect` Tauri command. Cheap (single Mutex lock).
pub fn update_pet_rect(left: f64, top: f64, w: f64, h: f64) {
    if let Ok(mut r) = PET_RECT.lock() {
        r.left = left as i32;
        r.top = top as i32;
        r.right = (left + w) as i32;
        r.bottom = (top + h) as i32;
    }
}

/// Update the shared overlay alpha (0..=255). Drives the WM_NCHITTEST gating:
/// alpha==0 → full HTTRANSPARENT; alpha>0 → selective (pet rect HTCLIENT).
pub fn update_overlay_alpha(alpha_0_255: u8) {
    OVERLAY_ALPHA.store(alpha_0_255, Ordering::Relaxed);
}

unsafe extern "system" fn foreground_event_callback(
    _h: HWINEVENTHOOK,
    _event: u32,
    _hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    // (signature matches WINEVENTPROC; body below)
    let is_desktop = foreground_is_desktop();
    let prev = LAST_FOREGROUND_IS_DESKTOP.swap(is_desktop, Ordering::SeqCst);
    if prev != is_desktop {
        if let Some(cb) = VISIBILITY_CALLBACK.get() {
            cb(is_desktop);
        }
    }
}

/// Return true iff the current foreground window's class is `Progman` or
/// `WorkerW` (the desktop windows).
unsafe fn foreground_is_desktop() -> bool {
    let fg = GetForegroundWindow();
    if fg.is_null() {
        return false;
    }
    let mut cls = [0u16; 64];
    let n = GetClassNameW(fg, cls.as_mut_ptr(), 64);
    if n <= 0 {
        return false;
    }
    let name = String::from_utf16_lossy(&cls[..n as usize]);
    name == "Progman" || name == "WorkerW"
}

/// Subclass procedure for the overlay HWND. Handles WM_NCHITTEST selectively:
/// pet rect → HTCLIENT (pet double-click reaches the overlay), elsewhere →
/// HTTRANSPARENT (clicks pass through to whatever is below). When overlay
/// alpha is 0, returns HTTRANSPARENT everywhere (invisible pets cannot be
/// double-clicked, per ADR-0025).
unsafe extern "system" fn overlay_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if msg == WM_NCHITTEST as u32 {
        let alpha = OVERLAY_ALPHA.load(Ordering::Relaxed);
        if alpha == 0 {
            return HTTRANSPARENT as LRESULT;
        }
        // lparam packs screen coords as LOWORD(x), HIWORD(y).
        let x = (lparam as u32 & 0xFFFF) as i16 as i32;
        let y = ((lparam as u32 >> 16) & 0xFFFF) as i16 as i32;
        let in_pet = PET_RECT
            .lock()
            .map(|r| x >= r.left && x < r.right && y >= r.top && y < r.bottom)
            .unwrap_or(false);
        if _id == 0xA602 {
            // child-level: log occasionally. (Log only when in pet for noise control.)
            if in_pet {
                eprintln!("[overlay] WM_NCHITTEST child hwnd={:#x} at ({},{}) in_pet=true -> HTCLIENT", hwnd as usize, x, y);
            }
        }
        if in_pet {
            return HTCLIENT as LRESULT;
        }
        return HTTRANSPARENT as LRESULT;
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}
