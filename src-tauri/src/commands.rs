use crate::db::{ContentRow, WallpaperProfileRow};
use crate::platform;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub rotation_interval_minutes: i64,
    pub model_manifest_dir: Option<String>,
}

impl Default for SettingsDto {
    fn default() -> Self {
        Self {
            rotation_interval_minutes: 25,
            model_manifest_dir: None,
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
pub fn list_content(state: State<'_, AppState>) -> Result<Vec<ContentRow>, String> {
    let db = state.db.lock().unwrap();
    db.list_content().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_content(state: State<'_, AppState>, item: ContentRow) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.save_content(&item).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_content(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.delete_content(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<SettingsDto, String> {
    let db = state.db.lock().unwrap();
    let json = db.get_settings_json().map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
    let mut dto = SettingsDto::default();
    if let Some(v) = parsed
        .get("rotationIntervalMinutes")
        .and_then(|v| v.as_i64())
    {
        dto.rotation_interval_minutes = v;
    }
    if let Some(v) = parsed.get("modelManifestDir").and_then(|v| v.as_str()) {
        dto.model_manifest_dir = Some(v.to_string());
    }
    Ok(dto)
}

#[tauri::command]
pub fn set_settings(
    state: State<'_, AppState>,
    patch: serde_json::Value,
) -> Result<SettingsDto, String> {
    let db = state.db.lock().unwrap();
    let json = db.get_settings_json().map_err(|e| e.to_string())?;
    let mut current: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
    if let Some(obj) = current.as_object_mut() {
        if let Some(patch_obj) = patch.as_object() {
            for (k, v) in patch_obj {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    db.set_settings_json(&serde_json::to_string(&current).unwrap_or_default())
        .map_err(|e| e.to_string())?;
    drop(db);
    get_settings(state)
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
