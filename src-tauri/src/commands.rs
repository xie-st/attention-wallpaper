use crate::db::{SettingsRow, SourceArticleRow, WallpaperProfileRow};
use crate::platform;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfoDto {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

impl From<platform::MonitorInfo> for MonitorInfoDto {
    fn from(m: platform::MonitorInfo) -> Self {
        Self {
            id: m.id,
            name: m.name,
            width: m.width,
            height: m.height,
            is_primary: m.is_primary,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconRectsDto {
    pub rects: Vec<platform::Rect>,
    pub source: String,
    pub diagnostic: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyDto {
    pub ok: bool,
    pub applied_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub background_color: String,
    pub pet_package_id: Option<String>,
    pub pet_rate: i64,
    pub pet_paused: bool,
}

impl Default for SettingsDto {
    fn default() -> Self {
        Self {
            background_color: "#FAFBFC".into(),
            pet_package_id: None,
            pet_rate: 50,
            pet_paused: false,
        }
    }
}

impl From<SettingsRow> for SettingsDto {
    fn from(r: SettingsRow) -> Self {
        Self {
            background_color: r.background_color,
            pet_package_id: r.pet_package_id,
            pet_rate: r.pet_rate,
            pet_paused: r.pet_paused,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RotationDto {
    pub last_rotated_at: Option<String>,
    pub paused_until: Option<String>,
    pub next_at: Option<String>,
    pub pending_since: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatusDto {
    pub subject: ComponentDto,
    pub face: ComponentDto,
    pub text: ComponentDto,
    pub onnx_active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDto {
    pub available: bool,
    pub source: String,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperProfileDto {
    pub monitor_id: String,
    pub original_path: Option<String>,
    pub original_position: Option<String>,
    pub last_composited_path: Option<String>,
    pub saved_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateArticleInput {
    pub id: String,
    pub title: String,
    pub plain_text: String,
    pub paragraphs: Vec<String>,
    pub imported_at: i64,
}

impl From<CreateArticleInput> for SourceArticleRow {
    fn from(i: CreateArticleInput) -> Self {
        SourceArticleRow {
            id: i.id,
            title: i.title,
            plain_text: i.plain_text,
            paragraphs: i.paragraphs,
            imported_at: i.imported_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteArticleResult {
    pub removed: bool,
}

#[tauri::command]
pub fn list_monitors() -> Vec<MonitorInfoDto> {
    platform::list_monitors()
        .into_iter()
        .map(Into::into)
        .collect()
}

#[tauri::command]
pub fn get_desktop_icon_rects(monitor_id: String) -> IconRectsDto {
    let result = platform::get_desktop_icon_rects(&monitor_id);
    IconRectsDto {
        rects: result.rects,
        source: result.source,
        diagnostic: result.diagnostic,
    }
}

#[tauri::command]
pub fn apply_wallpaper(state: State<'_, AppState>, monitor_id: String, png: Vec<u8>) -> ApplyDto {
    let previous = {
        let db = state.db.lock().unwrap();
        db.get_profile(&monitor_id).ok().flatten()
    };
    let original_path = previous
        .as_ref()
        .and_then(|profile| profile.original_path.clone())
        .or_else(|| platform::current_wallpaper_path(&monitor_id).ok());
    let result = platform::apply_wallpaper(&monitor_id, &png);
    if result.ok {
        if let Some(applied_path) = result.applied_path.clone() {
            let profile = WallpaperProfileRow {
                monitor_id: monitor_id.clone(),
                original_path,
                original_position: previous.and_then(|profile| profile.original_position),
                last_composited_path: Some(applied_path),
                saved_at: chrono::Utc::now().to_rfc3339(),
            };
            let db = state.db.lock().unwrap();
            if let Err(error) = db.set_profile(&profile) {
                eprintln!("[platform] failed to save wallpaper profile: {error}");
            }
        }
    }
    ApplyDto {
        ok: result.ok,
        applied_path: result.applied_path,
        error: result.error,
    }
}

#[tauri::command]
pub fn restore_wallpaper(state: State<'_, AppState>, monitor_id: Option<String>) -> ApplyDto {
    let profiles = {
        let db = state.db.lock().unwrap();
        match monitor_id.as_deref() {
            Some(id) => db.get_profile(id).ok().flatten().into_iter().collect(),
            None => db.list_profiles().unwrap_or_default(),
        }
    };
    if profiles.is_empty() {
        return ApplyDto {
            ok: false,
            applied_path: None,
            error: Some("no original wallpaper snapshot has been saved yet".to_string()),
        };
    }
    let mut last_path = None;
    for profile in profiles {
        match platform::restore_wallpaper(
            Some(&profile.monitor_id),
            profile.original_path.as_deref(),
        ) {
            platform::ApplyResult {
                ok: true,
                applied_path,
                ..
            } => last_path = applied_path,
            platform::ApplyResult { error, .. } => {
                return ApplyDto {
                    ok: false,
                    applied_path: None,
                    error,
                };
            }
        }
    }
    ApplyDto {
        ok: true,
        applied_path: last_path,
        error: None,
    }
}

#[tauri::command]
pub fn list_source_articles(state: State<'_, AppState>) -> Result<Vec<SourceArticleRow>, String> {
    let db = state.db.lock().unwrap();
    db.list_source_articles().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_source_article(
    state: State<'_, AppState>,
    input: CreateArticleInput,
) -> Result<(), String> {
    if input.title.trim().is_empty() {
        return Err("title must not be empty".into());
    }
    if input.plain_text.trim().is_empty() {
        return Err("plainText must not be empty".into());
    }
    let db = state.db.lock().unwrap();
    db.create_source_article(&input.into()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_source_article(
    state: State<'_, AppState>,
    id: String,
) -> Result<DeleteArticleResult, String> {
    let db = state.db.lock().unwrap();
    db.delete_source_article(&id)
        .map(|removed| DeleteArticleResult { removed })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<SettingsDto, String> {
    let db = state.db.lock().unwrap();
    db.get_settings().map(SettingsDto::from).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_settings(
    state: State<'_, AppState>,
    patch: serde_json::Value,
) -> Result<SettingsDto, String> {
    let mut row = {
        let db = state.db.lock().unwrap();
        db.get_settings().map_err(|e| e.to_string())?
    };
    if let Some(v) = patch.get("backgroundColor").and_then(|v| v.as_str()) {
        row.background_color = v.to_string();
    }
    if let Some(v) = patch.get("petPackageId").and_then(|v| v.as_str()) {
        row.pet_package_id = Some(v.to_string());
    } else if patch.get("petPackageId").is_some() && patch["petPackageId"].is_null() {
        row.pet_package_id = None;
    }
    if let Some(v) = patch.get("petRate").and_then(|v| v.as_i64()) {
        row.pet_rate = v;
    }
    if let Some(v) = patch.get("petPaused").and_then(|v| v.as_bool()) {
        row.pet_paused = v;
    }
    {
        let db = state.db.lock().unwrap();
        db.set_settings(&row).map_err(|e| e.to_string())?;
    }
    Ok(SettingsDto::from(row))
}

#[tauri::command]
pub fn get_rotation_state(state: State<'_, AppState>) -> Result<RotationDto, String> {
    let db = state.db.lock().unwrap();
    let row = db.get_rotation().map_err(|e| e.to_string())?;
    Ok(RotationDto {
        last_rotated_at: row.last_rotated_at,
        paused_until: row.paused_until,
        next_at: None,
        pending_since: None,
    })
}

#[tauri::command]
pub fn set_rotation_state(
    state: State<'_, AppState>,
    patch: serde_json::Value,
) -> Result<RotationDto, String> {
    let db = state.db.lock().unwrap();
    let current = db.get_rotation().map_err(|e| e.to_string())?;
    let last_rotated_at = patch
        .get("lastRotatedAt")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or(current.last_rotated_at);
    let paused_until = patch
        .get("pausedUntil")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or(current.paused_until);
    db.set_rotation(last_rotated_at.as_deref(), paused_until.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(RotationDto {
        last_rotated_at,
        paused_until,
        next_at: None,
        pending_since: None,
    })
}

#[tauri::command]
pub fn get_models_status() -> ModelStatusDto {
    let s = platform::get_models_status();
    ModelStatusDto {
        subject: ComponentDto {
            available: s.subject.available,
            source: s.subject.source,
            reason: s.subject.reason,
        },
        face: ComponentDto {
            available: s.face.available,
            source: s.face.source,
            reason: s.face.reason,
        },
        text: ComponentDto {
            available: s.text.available,
            source: s.text.source,
            reason: s.text.reason,
        },
        onnx_active: s.onnx_active,
    }
}

#[tauri::command]
pub fn get_wallpaper_profile(
    state: State<'_, AppState>,
    monitor_id: String,
) -> Result<Option<WallpaperProfileDto>, String> {
    let db = state.db.lock().unwrap();
    let row = db.get_profile(&monitor_id).map_err(|e| e.to_string())?;
    Ok(row.map(|r| WallpaperProfileDto {
        monitor_id: r.monitor_id,
        original_path: r.original_path,
        original_position: r.original_position,
        last_composited_path: r.last_composited_path,
        saved_at: r.saved_at,
    }))
}

#[tauri::command]
pub fn set_wallpaper_profile(
    state: State<'_, AppState>,
    profile: WallpaperProfileDto,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let row = WallpaperProfileRow {
        monitor_id: profile.monitor_id,
        original_path: profile.original_path,
        original_position: profile.original_position,
        last_composited_path: profile.last_composited_path,
        saved_at: profile.saved_at,
    };
    db.set_profile(&row).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn next_set(state: State<'_, AppState>) -> Result<RotationDto, String> {
    let db = state.db.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    db.set_rotation(
        Some(&now),
        db.get_rotation()
            .ok()
            .and_then(|r| r.paused_until)
            .as_deref(),
    )
    .map_err(|e| e.to_string())?;
    Ok(RotationDto {
        last_rotated_at: Some(now),
        paused_until: db.get_rotation().ok().and_then(|r| r.paused_until),
        next_at: None,
        pending_since: None,
    })
}

#[tauri::command]
pub fn pause_one_hour(state: State<'_, AppState>) -> Result<RotationDto, String> {
    let db = state.db.lock().unwrap();
    let now = chrono::Utc::now();
    let until = (now + chrono::Duration::hours(1)).to_rfc3339();
    let current = db.get_rotation().map_err(|e| e.to_string())?;
    db.set_rotation(current.last_rotated_at.as_deref(), Some(&until))
        .map_err(|e| e.to_string())?;
    Ok(RotationDto {
        last_rotated_at: current.last_rotated_at,
        paused_until: Some(until),
        next_at: None,
        pending_since: None,
    })
}

// relayout command removed per ADR-0023; re-layout action will be a UI button
// in the 壁纸 section (slice #10). The frontend re-runs the composite pipeline
// directly without a backend call.

// ===========================================================================
// Overlay z-order + visibility hooks (ADR-0025). The overlay window is created
// by `tauri.conf.json` (label="overlay") and these commands are invoked from
// the overlay frontend after it mounts.
// ===========================================================================

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VisibilityEvent {
    pub visible: bool,
}

/// Install the overlay z-order hooks (extended styles + WinEventHook +
/// WndProc subclass for selective WM_NCHITTEST). Idempotent. The `on_visibility`
/// closure emits a Tauri event the frontend listens to for fade-in/out.
#[tauri::command]
pub fn install_overlay_hooks(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?;
    let app_for_cb = app.clone();
    platform::install_overlay_hooks(hwnd.0 as _, move |visible| {
        let _ = app_for_cb.emit("overlay://visibility", VisibilityEvent { visible });
    })
}

/// Update the pet hit-test rect (screen coordinates). Called every frame by
/// the overlay frontend so WM_NCHITTEST can decide whether the cursor is over
/// the pet.
#[tauri::command]
pub fn update_pet_rect(left: f64, top: f64, w: f64, h: f64) {
    platform::update_pet_rect(left, top, w, h);
}

/// Update the overlay alpha (0..=255). Drives WM_NCHITTEST gating: alpha=0 →
/// full HTTRANSPARENT (invisible pets can't be clicked); alpha>0 → selective
/// hit-test. Called every frame during the fade-in/out tween (~200ms).
#[tauri::command]
pub fn set_overlay_alpha(alpha: u8) {
    platform::update_overlay_alpha(alpha);
}
