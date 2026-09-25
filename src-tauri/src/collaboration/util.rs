use rusqlite::{params, Connection, OptionalExtension};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::error::{codes, CResult, CollabError};

pub fn now_ms() -> i64 {
    crate::wise_db::unix_now_ms()
}

pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4().simple())
}

pub fn new_secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

pub fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Key-sorted JSON so hashes do not depend on map insertion order.
pub fn canonical_json(value: &Value) -> String {
    fn write(value: &Value, out: &mut String) {
        match value {
            Value::Object(map) => {
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort();
                out.push('{');
                for (i, key) in keys.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&serde_json::to_string(key).unwrap_or_default());
                    out.push(':');
                    write(&map[*key], out);
                }
                out.push('}');
            }
            Value::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write(item, out);
                }
                out.push(']');
            }
            other => out.push_str(&other.to_string()),
        }
    }
    let mut out = String::new();
    write(value, &mut out);
    out
}

pub fn hash_json(value: &Value) -> String {
    sha256_hex(&canonical_json(value))
}

pub fn to_json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

pub fn parse_json_or<T: DeserializeOwned>(raw: &str, fallback: T) -> T {
    serde_json::from_str(raw).unwrap_or(fallback)
}

pub fn parse_value(raw: &str) -> Value {
    serde_json::from_str(raw).unwrap_or(Value::Null)
}

/// Runs `f` inside `BEGIN IMMEDIATE`, or joins an already-open transaction.
pub fn tx<T>(conn: &Connection, f: impl FnOnce(&Connection) -> CResult<T>) -> CResult<T> {
    if !conn.is_autocommit() {
        return f(conn);
    }
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = f(conn);
    let end = if result.is_ok() { "COMMIT" } else { "ROLLBACK" };
    if let Err(e) = conn.execute_batch(end) {
        if result.is_ok() {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(e.into());
        }
    }
    result
}

pub fn next_counter(conn: &Connection, name: &str) -> CResult<i64> {
    conn.execute(
        "INSERT INTO collab_counters (name, value) VALUES (?1, 1)
         ON CONFLICT(name) DO UPDATE SET value = value + 1",
        params![name],
    )?;
    Ok(conn.query_row(
        "SELECT value FROM collab_counters WHERE name = ?1",
        params![name],
        |r| r.get(0),
    )?)
}

/// Returns the stored result for a replayed `requestId`; rejects reuse with a different payload.
pub fn request_replay(
    conn: &Connection,
    request_id: &str,
    command: &str,
    payload_hash: &str,
) -> CResult<Option<Value>> {
    let request_id = request_id.trim();
    if request_id.is_empty() {
        return Ok(None);
    }
    let row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT command, payload_hash, result_json FROM collab_request_log WHERE request_id = ?1",
            params![request_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    match row {
        None => Ok(None),
        Some((cmd, hash, result)) => {
            if cmd != command || hash != payload_hash {
                return Err(CollabError::new(
                    codes::REQUEST_ID_REUSED,
                    "requestId 已用于不同的请求内容；修改意图后请使用新的 requestId",
                ));
            }
            Ok(Some(parse_value(&result)))
        }
    }
}

pub fn request_record(
    conn: &Connection,
    request_id: &str,
    command: &str,
    payload_hash: &str,
    result: &Value,
) -> CResult<()> {
    let request_id = request_id.trim();
    if request_id.is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT OR IGNORE INTO collab_request_log (request_id, command, payload_hash, result_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![request_id, command, payload_hash, result.to_string(), now_ms()],
    )?;
    Ok(())
}

/// Lowercased keyword tokens for simple retrieval (CJK runs are kept whole and bigram-split).
pub fn keyword_tokens(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |t: String| {
        if t.chars().count() >= 2 && !out.contains(&t) {
            out.push(t);
        }
    };
    let mut ascii = String::new();
    let mut cjk: Vec<char> = Vec::new();
    let flush_cjk = |cjk: &mut Vec<char>, push: &mut dyn FnMut(String)| {
        if cjk.len() >= 2 {
            for w in cjk.windows(2) {
                push(w.iter().collect());
            }
        }
        cjk.clear();
    };
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            flush_cjk(&mut cjk, &mut push);
            ascii.push(ch.to_ascii_lowercase());
        } else if ch as u32 >= 0x4E00 && ch as u32 <= 0x9FFF {
            if !ascii.is_empty() {
                push(std::mem::take(&mut ascii));
            }
            cjk.push(ch);
        } else {
            if !ascii.is_empty() {
                push(std::mem::take(&mut ascii));
            }
            flush_cjk(&mut cjk, &mut push);
        }
    }
    if !ascii.is_empty() {
        push(ascii);
    }
    flush_cjk(&mut cjk, &mut push);
    out
}

pub fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

pub fn derive_title(body: &str) -> String {
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() || (t.starts_with("![") && t.ends_with(')')) {
            continue;
        }
        let t = t.trim_start_matches('#').trim();
        let t = t.trim_start_matches(|c: char| c == '@').trim();
        if !t.is_empty() {
            return truncate_chars(t, 80);
        }
    }
    "无标题需求".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_json_is_order_independent() {
        let a = json!({"b": 1, "a": {"y": [1, 2], "x": null}});
        let b: Value = serde_json::from_str(r#"{"a":{"x":null,"y":[1,2]},"b":1}"#).unwrap();
        assert_eq!(hash_json(&a), hash_json(&b));
    }

    #[test]
    fn keyword_tokens_split_ascii_and_cjk() {
        let tokens = keyword_tokens("订单优惠 discountAmount API");
        assert!(tokens.contains(&"订单".to_string()));
        assert!(tokens.contains(&"优惠".to_string()));
        assert!(tokens.contains(&"discountamount".to_string()));
        assert!(tokens.contains(&"api".to_string()));
    }

    #[test]
    fn request_replay_rejects_changed_payload() {
        let conn = crate::wise_db::open_migrated_test_connection();
        request_record(&conn, "r1", "cmd", "h1", &json!({"ok": 1})).unwrap();
        assert_eq!(request_replay(&conn, "r1", "cmd", "h1").unwrap(), Some(json!({"ok": 1})));
        let err = request_replay(&conn, "r1", "cmd", "h2").unwrap_err();
        assert_eq!(err.code, codes::REQUEST_ID_REUSED);
    }
}
