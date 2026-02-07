// persistence.rs
// 永続化ヘルパー: SQLite (rusqlite) と JSONL ファイル出力の両方をサポートします。
// 目的:
// - 恒久的に保存したいデータは SQLite に入れる（検索や集約が容易）。
// - 他の AI や人が編集・利用しやすい形でエクスポートするために JSONL も併用する。

use chrono::Utc;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;

/// 初期化: DB ファイルを作成しテーブルを準備する
/// `db_path` は例えば "data/inference.db" のようなパス
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

/// SQLite に推論結果を保存する
/// - `db_path`: DB ファイルパス
/// - `room_id`, `source_id`: メタデータ
/// - `payload`: JSON 値（シリアライズして保存）
pub fn save_inference_sqlite(db_path: &str, room_id: &str, source_id: &str, payload: &Value) -> rusqlite::Result<()> {
    let conn = Connection::open(db_path)?;
    let payload_text = serde_json::to_string(payload).unwrap_or_else(|_| "null".to_string());
    let ts = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO inference (room_id, source_id, payload, ts) VALUES (?1, ?2, ?3, ?4)",
        params![room_id, source_id, payload_text, ts],
    )?;
    Ok(())
}

/// 人や他のAIが読みやすく編集しやすい JSON Lines 形式で追記する
/// 1 行につき 1 レコードの JSON を書き、後で簡単に grep / jq / line-by-line parser で扱える
pub fn append_jsonl(jsonl_path: &str, room_id: &str, source_id: &str, payload: &Value) -> std::io::Result<()> {
    let record = serde_json::json!({
        "room_id": room_id,
        "source_id": source_id,
        "payload": payload,
        "ts": Utc::now().to_rfc3339()
    });

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(jsonl_path)?;

    writeln!(file, "{}", serde_json::to_string(&record).unwrap_or_else(|_| "null".to_string()))?;
    Ok(())
}
