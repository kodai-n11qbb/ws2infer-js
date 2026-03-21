// persistence.rs
// 永続化ヘルパー: SQLite (rusqlite) と JSONL ファイル出力の両方をサポートします。

use chrono::Utc;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;

/// 推論結果の保存方法を抽象化するTrait (Dependency Injection用)
pub trait InferenceStorage: Send + Sync {
    fn save_inference(&self, room_id: &str, source_id: &str, payload: &Value) -> anyhow::Result<()>;
}

/// 実ファイル（SQLite + JSONL）に保存する実装
pub struct FileStorage {
    pub db_path: String,
    pub jsonl_path: String,
}

impl FileStorage {
    pub fn new(db_path: String, jsonl_path: String) -> anyhow::Result<Self> {
        let conn = Connection::open(&db_path)?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS inference (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                ts TEXT NOT NULL
            )",
            [],
        )?;
        Ok(Self { db_path, jsonl_path })
    }
}

impl InferenceStorage for FileStorage {
    fn save_inference(&self, room_id: &str, source_id: &str, payload: &Value) -> anyhow::Result<()> {
        // SQLite
        let conn = Connection::open(&self.db_path)?;
        let payload_text = serde_json::to_string(payload).unwrap_or_else(|_| "null".to_string());
        let ts = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO inference (room_id, source_id, payload, ts) VALUES (?1, ?2, ?3, ?4)",
            params![room_id, source_id, payload_text, ts],
        )?;

        // JSONL
        let record = serde_json::json!({
            "room_id": room_id,
            "source_id": source_id,
            "payload": payload,
            "ts": ts
        });
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.jsonl_path)?;
        writeln!(file, "{}", serde_json::to_string(&record).unwrap_or_else(|_| "null".to_string()))?;

        Ok(())
    }
}

/// テスト用の何もしない実装 (Mock用)
pub struct MockStorage;

impl InferenceStorage for MockStorage {
    fn save_inference(&self, _room_id: &str, _source_id: &str, _payload: &Value) -> anyhow::Result<()> {
        Ok(())
    }
}

// 互換性のための古い関数 (リファクタリングが進むまでのブリッジ)
pub fn init_db(db_path: &str) -> rusqlite::Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS inference (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            ts TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}
