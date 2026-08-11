#![cfg(windows)]

//! Windows-native wallpaper adapter. Desktop icon geometry deliberately uses
//! the conservative fallback until a real UI Automation provider is wired.

use std::ffi::{c_void, OsStr};
use std::os::windows::ffi::OsStrExt;
use std::ptr;

use windows_sys::core::GUID;
use windows_sys::Win32::Foundation::{BOOL, LPARAM, RECT};
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
    Err("desktop icon UI Automation adapter is not available in this build".to_string())
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
