#[cfg(windows)]
pub mod windows;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IconRectsResult {
    pub rects: Vec<Rect>,
    pub source: String,
    pub diagnostic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyResult {
    pub ok: bool,
    pub applied_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStatus {
    pub subject: ComponentStatus,
    pub face: ComponentStatus,
    pub text: ComponentStatus,
    pub onnx_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentStatus {
    pub available: bool,
    pub source: String,
    pub reason: Option<String>,
}

/// Enumerate monitors. On non-Windows or on failure, returns a single
/// 1920×1080 dev monitor so the rest of the pipeline stays testable.
pub fn list_monitors() -> Vec<MonitorInfo> {
    #[cfg(windows)]
    {
        match windows::list_monitors() {
            Ok(m) if !m.is_empty() => return m,
            Ok(_) => return fallback_monitors(),
            Err(e) => {
                eprintln!("[platform] list_monitors failed: {e}");
                return fallback_monitors();
            }
        }
    }
    #[cfg(not(windows))]
    {
        fallback_monitors()
    }
}

fn fallback_monitors() -> Vec<MonitorInfo> {
    vec![MonitorInfo {
        id: "fallback-1".to_string(),
        name: "Fallback Display".to_string(),
        width: 1920,
        height: 1080,
        is_primary: true,
    }]
}

/// Get desktop icon rectangles. Always returns a result with diagnostics,
/// never panics.
pub fn get_desktop_icon_rects(_monitor_id: &str) -> IconRectsResult {
    #[cfg(windows)]
    {
        match windows::get_desktop_icon_rects() {
            Ok(rects) => {
                let source = if rects.is_empty() {
                    "fallback"
                } else {
                    "uiautomation"
                };
                let count = rects.len();
                IconRectsResult {
                    rects,
                    source: source.to_string(),
                    diagnostic: if source == "fallback" {
                        "Windows UI Automation returned no icon rectangles; using edge-safe conservative fallback.".to_string()
                    } else {
                        format!("UI Automation: {} icon rectangles", count)
                    },
                }
            }
            Err(e) => {
                eprintln!("[platform] get_desktop_icon_rects failed: {e}");
                IconRectsResult {
                    rects: vec![],
                    source: "fallback".to_string(),
                    diagnostic: format!(
                        "UI Automation unavailable ({e}); using edge-safe conservative fallback."
                    ),
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        IconRectsResult {
            rects: vec![],
            source: "fallback".to_string(),
            diagnostic: "Non-Windows platform; desktop icon enumeration unavailable.".to_string(),
        }
    }
}

/// Apply a wallpaper PNG to a monitor. On non-Windows, returns an honest
/// error.
pub fn apply_wallpaper(monitor_id: &str, png_bytes: &[u8]) -> ApplyResult {
    #[cfg(windows)]
    {
        match windows::apply_wallpaper(monitor_id, png_bytes) {
            Ok(path) => ApplyResult {
                ok: true,
                applied_path: Some(path),
                error: None,
            },
            Err(e) => {
                eprintln!("[platform] apply_wallpaper failed: {e}");
                ApplyResult {
                    ok: false,
                    applied_path: None,
                    error: Some(format!("{e}")),
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (monitor_id, png_bytes);
        ApplyResult {
            ok: false,
            applied_path: None,
            error: Some(
                "Wallpaper application requires Windows IDesktopWallpaper COM API.".to_string(),
            ),
        }
    }
}

/// Read the current native wallpaper path so it can be restored later.
pub fn current_wallpaper_path(monitor_id: &str) -> Result<String, String> {
    #[cfg(windows)]
    {
        windows::current_wallpaper_path(monitor_id)
    }
    #[cfg(not(windows))]
    {
        let _ = monitor_id;
        Err("Current wallpaper lookup requires Windows.".to_string())
    }
}

/// Restore the original wallpaper from a saved profile.
pub fn restore_wallpaper(_monitor_id: Option<&str>, original_path: Option<&str>) -> ApplyResult {
    #[cfg(windows)]
    {
        match windows::restore_wallpaper(_monitor_id, original_path) {
            Ok(path) => ApplyResult {
                ok: true,
                applied_path: Some(path),
                error: None,
            },
            Err(e) => {
                eprintln!("[platform] restore_wallpaper failed: {e}");
                ApplyResult {
                    ok: false,
                    applied_path: None,
                    error: Some(format!("{e}")),
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = original_path;
        ApplyResult {
            ok: false,
            applied_path: None,
            error: Some(
                "Wallpaper restore requires Windows IDesktopWallpaper COM API.".to_string(),
            ),
        }
    }
}

/// Query model manifest status honestly. Without a native ONNX bridge active,
/// all components are reported as unavailable with conservative fallback.
pub fn get_models_status() -> ModelStatus {
    ModelStatus {
        subject: ComponentStatus {
            available: false,
            source: "heuristic".to_string(),
            reason: Some("no_valid_manifest".to_string()),
        },
        face: ComponentStatus {
            available: false,
            source: "heuristic".to_string(),
            reason: Some("no_valid_manifest".to_string()),
        },
        text: ComponentStatus {
            available: false,
            source: "heuristic".to_string(),
            reason: Some("no_valid_manifest".to_string()),
        },
        onnx_active: false,
    }
}

// ===========================================================================
// Overlay window hooks (ADR-0025). Cross-platform facade; Windows has a real
// implementation in `windows.rs`, other platforms are no-ops so the crate
// still typechecks/tests in CI.
// ===========================================================================

#[cfg(windows)]
pub use windows::{install_overlay_hooks, update_overlay_alpha, update_pet_rect};

/// Cross-platform HWND-ish handle. On Windows this is a real HWND (pointer);
/// on non-Windows it's a meaningless placeholder so the API keeps its shape.
#[cfg(windows)]
pub type OverlayHwnd = windows_sys::Win32::Foundation::HWND;
#[cfg(not(windows))]
pub type OverlayHwnd = *mut std::ffi::c_void;

#[cfg(not(windows))]
pub fn install_overlay_hooks<F>(_hwnd: OverlayHwnd, _on_visibility: F) -> Result<(), String>
where
    F: Fn(bool) + Send + Sync + 'static,
{
    Ok(())
}

#[cfg(not(windows))]
pub fn update_pet_rect(_left: f64, _top: f64, _w: f64, _h: f64) {}

#[cfg(not(windows))]
pub fn update_overlay_alpha(_alpha_0_255: u8) {}
