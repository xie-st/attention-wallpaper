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
                IconRectsResult {
                    rects,
                    source: source.to_string(),
                    diagnostic: if source == "fallback" {
                        "Windows UI Automation returned no icon rectangles; using edge-safe conservative fallback.".to_string()
                    } else {
                        format!("UI Automation: {} icon rectangles", source)
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
