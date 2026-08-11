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
pub struct SourceArticleRow {
    pub id: String,
    pub title: String,
    pub plain_text: String,
    pub paragraphs: Vec<String>,
    pub imported_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsRow {
    pub background_color: String,
    pub pet_package_id: Option<String>,
    pub pet_rate: i64,
    pub pet_paused: bool,
}

impl Default for SettingsRow {
    fn default() -> Self {
        Self {
            background_color: "#FAFBFC".to_string(),
            pet_package_id: None,
            pet_rate: 50,
            pet_paused: false,
        }
    }
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
            "CREATE TABLE IF NOT EXISTS source_articles (\
                id TEXT PRIMARY KEY,\
                title TEXT NOT NULL,\
                plain_text TEXT NOT NULL,\
                paragraphs_json TEXT NOT NULL,\
                imported_at INTEGER NOT NULL\
            );\
            CREATE TABLE IF NOT EXISTS settings (\
                id INTEGER PRIMARY KEY CHECK (id = 1),\
                background_color TEXT NOT NULL DEFAULT '#FAFBFC',\
                pet_package_id TEXT,\
                pet_rate INTEGER NOT NULL DEFAULT 50,\
                pet_paused INTEGER NOT NULL DEFAULT 0\
            );\
            INSERT OR IGNORE INTO settings (id) VALUES (1);\
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

    pub fn list_source_articles(&self) -> Result<Vec<SourceArticleRow>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, plain_text, paragraphs_json, imported_at \
             FROM source_articles ORDER BY imported_at ASC, rowid ASC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let json: String = r.get(3)?;
                let paragraphs: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
                Ok(SourceArticleRow {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    plain_text: r.get(2)?,
                    paragraphs,
                    imported_at: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn create_source_article(&self, row: &SourceArticleRow) -> Result<(), DbError> {
        let json = serde_json::to_string(&row.paragraphs).unwrap_or_else(|_| "[]".to_string());
        self.conn.execute(
            "INSERT INTO source_articles (id, title, plain_text, paragraphs_json, imported_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![row.id, row.title, row.plain_text, json, row.imported_at],
        )?;
        Ok(())
    }

    pub fn delete_source_article(&self, id: &str) -> Result<bool, DbError> {
        let affected = self
            .conn
            .execute("DELETE FROM source_articles WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    pub fn get_settings(&self) -> Result<SettingsRow, DbError> {
        self.conn
            .query_row(
                "SELECT background_color, pet_package_id, pet_rate, pet_paused \
                 FROM settings WHERE id = 1",
                [],
                |r| {
                    Ok(SettingsRow {
                        background_color: r.get(0)?,
                        pet_package_id: r.get(1)?,
                        pet_rate: r.get(2)?,
                        pet_paused: r.get::<_, i64>(3)? != 0,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn set_settings(&self, row: &SettingsRow) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE settings SET \
             background_color = ?1, pet_package_id = ?2, pet_rate = ?3, pet_paused = ?4 \
             WHERE id = 1",
            params![
                row.background_color,
                row.pet_package_id,
                row.pet_rate,
                row.pet_paused as i64
            ],
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

    fn article(id: &str, title: &str, text: &str, imported_at: i64) -> SourceArticleRow {
        SourceArticleRow {
            id: id.into(),
            title: title.into(),
            plain_text: text.into(),
            paragraphs: text.split("\n\n").map(str::to_string).collect(),
            imported_at,
        }
    }

    #[test]
    fn schema_creates_source_articles_table() {
        let db = tmp_db();
        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM source_articles", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn schema_drops_legacy_content_table() {
        let db = tmp_db();
        let exists: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='content'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 0, "legacy content table should not exist");
    }

    #[test]
    fn list_source_articles_empty_on_fresh_db() {
        let db = tmp_db();
        assert_eq!(db.list_source_articles().unwrap().len(), 0);
    }

    #[test]
    fn create_and_list_source_article_roundtrip() {
        let db = tmp_db();
        let row = article("a1", "First", "para1\n\npara2", 1000);
        db.create_source_article(&row).unwrap();
        let list = db.list_source_articles().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "a1");
        assert_eq!(list[0].title, "First");
        assert_eq!(list[0].plain_text, "para1\n\npara2");
        assert_eq!(list[0].paragraphs, vec!["para1", "para2"]);
        assert_eq!(list[0].imported_at, 1000);
    }

    #[test]
    fn list_source_articles_returns_in_imported_at_order() {
        let db = tmp_db();
        db.create_source_article(&article("late", "Late", "x", 2000))
            .unwrap();
        db.create_source_article(&article("early", "Early", "y", 1000))
            .unwrap();
        db.create_source_article(&article("mid", "Mid", "z", 1500))
            .unwrap();
        let order: Vec<String> = db
            .list_source_articles()
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(order, vec!["early", "mid", "late"]);
    }

    #[test]
    fn delete_source_article_removes_row_and_returns_confirmation() {
        let db = tmp_db();
        db.create_source_article(&article("a1", "T", "body", 1))
            .unwrap();
        assert_eq!(db.delete_source_article("a1").unwrap(), true);
        assert_eq!(db.delete_source_article("a1").unwrap(), false);
        assert_eq!(db.list_source_articles().unwrap().len(), 0);
    }

    #[test]
    fn settings_default_values_on_fresh_db() {
        let db = tmp_db();
        let s = db.get_settings().unwrap();
        assert_eq!(s.background_color, "#FAFBFC");
        assert_eq!(s.pet_package_id, None);
        assert_eq!(s.pet_rate, 50);
        assert_eq!(s.pet_paused, false);
    }

    #[test]
    fn settings_roundtrip() {
        let db = tmp_db();
        let updated = SettingsRow {
            background_color: "#FFFEF0".into(),
            pet_package_id: Some("cat-pet".into()),
            pet_rate: 80,
            pet_paused: true,
        };
        db.set_settings(&updated).unwrap();
        let got = db.get_settings().unwrap();
        assert_eq!(got.background_color, "#FFFEF0");
        assert_eq!(got.pet_package_id.as_deref(), Some("cat-pet"));
        assert_eq!(got.pet_rate, 80);
        assert_eq!(got.pet_paused, true);
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
