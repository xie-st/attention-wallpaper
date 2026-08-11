use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

pub struct Database {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentRow {
    pub id: String,
    pub kind: String,
    pub body: String,
    pub priority: String,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub frequency: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsRow {
    pub rotation_interval_minutes: i64,
    pub model_manifest_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotationRow {
    pub last_rotated_at: Option<String>,
    pub paused_until: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperProfileRow {
    pub monitor_id: String,
    pub original_path: Option<String>,
    pub original_position: Option<String>,
    pub last_composited_path: Option<String>,
    pub saved_at: String,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, DbError> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self { conn })
    }

    pub fn init_schema(&self) -> Result<(), DbError> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS content (\
                id TEXT PRIMARY KEY,\
                kind TEXT NOT NULL,\
                body TEXT NOT NULL,\
                priority TEXT NOT NULL,\
                starts_at TEXT,\
                ends_at TEXT,\
                frequency TEXT NOT NULL,\
                enabled INTEGER NOT NULL DEFAULT 1\
            );\
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);\
            CREATE TABLE IF NOT EXISTS rotation_state (\
                id INTEGER PRIMARY KEY CHECK (id = 1),\
                last_rotated_at TEXT,\
                paused_until TEXT\
            );\
            CREATE TABLE IF NOT EXISTS wallpaper_profiles (\
                monitor_id TEXT PRIMARY KEY,\
                original_path TEXT,\
                original_position TEXT,\
                last_composited_path TEXT,\
                saved_at TEXT NOT NULL\
            );\
            INSERT OR IGNORE INTO rotation_state (id, last_rotated_at, paused_until) VALUES (1, NULL, NULL);",
        )?;
        Ok(())
    }

    pub fn list_content(&self) -> Result<Vec<ContentRow>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, body, priority, starts_at, ends_at, frequency, enabled FROM content ORDER BY rowid",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ContentRow {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    body: r.get(2)?,
                    priority: r.get(3)?,
                    starts_at: r.get(4)?,
                    ends_at: r.get(5)?,
                    frequency: r.get(6)?,
                    enabled: r.get::<_, i64>(7)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn save_content(&self, row: &ContentRow) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO content (id, kind, body, priority, starts_at, ends_at, frequency, enabled) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
             ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, body=excluded.body, \
             priority=excluded.priority, starts_at=excluded.starts_at, ends_at=excluded.ends_at, \
             frequency=excluded.frequency, enabled=excluded.enabled",
            params![row.id, row.kind, row.body, row.priority, row.starts_at, row.ends_at, row.frequency, row.enabled as i64],
        )?;
        Ok(())
    }

    pub fn delete_content(&self, id: &str) -> Result<(), DbError> {
        self.conn
            .execute("DELETE FROM content WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_settings_json(&self) -> Result<String, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = 'settings'")?;
        let row: Option<String> = stmt.query_row([], |r| r.get(0)).ok();
        Ok(row.unwrap_or_else(|| "{}".to_string()))
    }

    pub fn set_settings_json(&self, json: &str) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES ('settings', ?1) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![json],
        )?;
        Ok(())
    }

    pub fn get_rotation(&self) -> Result<RotationRow, DbError> {
        self.conn
            .query_row(
                "SELECT last_rotated_at, paused_until FROM rotation_state WHERE id = 1",
                [],
                |r| {
                    Ok(RotationRow {
                        last_rotated_at: r.get(0)?,
                        paused_until: r.get(1)?,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn set_rotation(&self, last: Option<&str>, paused: Option<&str>) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE rotation_state SET last_rotated_at = ?1, paused_until = ?2 WHERE id = 1",
            params![last, paused],
        )?;
        Ok(())
    }

    pub fn get_profile(&self, monitor_id: &str) -> Result<Option<WallpaperProfileRow>, DbError> {
        let row = self.conn.query_row(
            "SELECT monitor_id, original_path, original_position, last_composited_path, saved_at \
             FROM wallpaper_profiles WHERE monitor_id = ?1",
            params![monitor_id],
            |r| {
                Ok(WallpaperProfileRow {
                    monitor_id: r.get(0)?,
                    original_path: r.get(1)?,
                    original_position: r.get(2)?,
                    last_composited_path: r.get(3)?,
                    saved_at: r.get(4)?,
                })
            },
        );
        match row {
            Ok(r) => Ok(Some(r)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn set_profile(&self, row: &WallpaperProfileRow) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO wallpaper_profiles (monitor_id, original_path, original_position, last_composited_path, saved_at) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(monitor_id) DO UPDATE SET \
             original_path=excluded.original_path, original_position=excluded.original_position, \
             last_composited_path=excluded.last_composited_path, saved_at=excluded.saved_at",
            params![row.monitor_id, row.original_path, row.original_position, row.last_composited_path, row.saved_at],
        )?;
        Ok(())
    }

    pub fn list_profiles(&self) -> Result<Vec<WallpaperProfileRow>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT monitor_id, original_path, original_position, last_composited_path, saved_at FROM wallpaper_profiles",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(WallpaperProfileRow {
                    monitor_id: r.get(0)?,
                    original_path: r.get(1)?,
                    original_position: r.get(2)?,
                    last_composited_path: r.get(3)?,
                    saved_at: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

impl Default for SettingsRow {
    fn default() -> Self {
        Self {
            rotation_interval_minutes: 25,
            model_manifest_dir: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_db() -> Database {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("aw-test-{}.db", uuid::Uuid::new_v4()));
        let db = Database::open(&path).unwrap();
        db.init_schema().unwrap();
        db
    }

    #[test]
    fn content_crud() {
        let db = tmp_db();
        let item = ContentRow {
            id: "t1".into(),
            kind: "goal".into(),
            body: "test body".into(),
            priority: "high".into(),
            starts_at: None,
            ends_at: None,
            frequency: "normal".into(),
            enabled: true,
        };
        db.save_content(&item).unwrap();
        let list = db.list_content().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].body, "test body");
        db.delete_content("t1").unwrap();
        assert_eq!(db.list_content().unwrap().len(), 0);
    }

    #[test]
    fn content_ipc_uses_camel_case() {
        let item = ContentRow {
            id: "t1".into(),
            kind: "goal".into(),
            body: "test".into(),
            priority: "normal".into(),
            starts_at: Some("2026-01-01T00:00:00Z".into()),
            ends_at: None,
            frequency: "normal".into(),
            enabled: true,
        };
        let value = serde_json::to_value(&item).unwrap();
        assert_eq!(value["startsAt"], "2026-01-01T00:00:00Z");
        assert!(value.get("starts_at").is_none());
        let decoded: ContentRow = serde_json::from_value(value).unwrap();
        assert_eq!(decoded.starts_at.as_deref(), Some("2026-01-01T00:00:00Z"));
    }

    #[test]
    fn settings_roundtrip() {
        let db = tmp_db();
        db.set_settings_json(r#"{"rotationIntervalMinutes":15,"modelManifestDir":null}"#)
            .unwrap();
        let json = db.get_settings_json().unwrap();
        assert!(json.contains("rotationIntervalMinutes"));
        assert!(json.contains("15"));
    }

    #[test]
    fn rotation_roundtrip() {
        let db = tmp_db();
        db.set_rotation(Some("2026-01-01T00:00:00Z"), None).unwrap();
        let row = db.get_rotation().unwrap();
        assert_eq!(row.last_rotated_at.as_deref(), Some("2026-01-01T00:00:00Z"));
        assert!(row.paused_until.is_none());
    }

    #[test]
    fn profile_upsert() {
        let db = tmp_db();
        let p = WallpaperProfileRow {
            monitor_id: "m1".into(),
            original_path: Some("/orig.jpg".into()),
            original_position: Some("fill".into()),
            last_composited_path: Some("/tmp/c1.png".into()),
            saved_at: "2026-01-01T00:00:00Z".into(),
        };
        db.set_profile(&p).unwrap();
        let got = db.get_profile("m1").unwrap().unwrap();
        assert_eq!(got.original_path.as_deref(), Some("/orig.jpg"));
        let p2 = WallpaperProfileRow {
            monitor_id: "m1".into(),
            original_path: Some("/orig.jpg".into()),
            original_position: Some("fill".into()),
            last_composited_path: Some("/tmp/c2.png".into()),
            saved_at: "2026-01-02T00:00:00Z".into(),
        };
        db.set_profile(&p2).unwrap();
        let got2 = db.get_profile("m1").unwrap().unwrap();
        assert_eq!(got2.last_composited_path.as_deref(), Some("/tmp/c2.png"));
    }
}
