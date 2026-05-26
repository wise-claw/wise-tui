//! Shared JSON config read/write for extension library installs.

use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::wise_paths;

pub fn read_json_root(path: &Path) -> Result<Value, String> {
    if !path.is_file() {
        return Ok(serde_json::json!({}));
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
    let v: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("解析 {} 失败: {e}", path.display()))?;
    if v.is_object() {
        Ok(v)
    } else {
        Err(format!("{} 根须为 JSON 对象", path.display()))
    }
}

pub fn write_json_root(path: &Path, root: &Value) -> Result<(), String> {
    let out = serde_json::to_string_pretty(root).map_err(|e| e.to_string())?;
    let body = format!("{out}\n");
    wise_paths::write_file_atomic(path, &body)
}

/// 递归合并 JSON 对象；标量/数组由 overlay 覆盖。
pub fn deep_merge_json(base: Value, overlay: Value) -> Value {
    match (base, overlay) {
        (Value::Object(mut b), Value::Object(o)) => {
            for (k, v) in o {
                let next = match b.remove(&k) {
                    Some(existing) => deep_merge_json(existing, v),
                    None => v,
                };
                b.insert(k, next);
            }
            Value::Object(b)
        }
        (_, overlay) => overlay,
    }
}
