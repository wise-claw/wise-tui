//! 按模型的简易熔断器（对齐 oc-go-cc：3 次失败后冷却 30 秒）。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const FAILURE_THRESHOLD: u32 = 3;
const COOLDOWN: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
struct Entry {
    consecutive_failures: u32,
    open_until: Option<Instant>,
}

static CIRCUIT: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();

fn cell() -> &'static Mutex<HashMap<String, Entry>> {
    CIRCUIT.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn is_open(model_id: &str) -> bool {
    let key = model_id.trim();
    if key.is_empty() {
        return false;
    }
    let Ok(guard) = cell().lock() else {
        return false;
    };
    let Some(entry) = guard.get(key) else {
        return false;
    };
    if let Some(until) = entry.open_until {
        if Instant::now() < until {
            return true;
        }
    }
    false
}

pub fn record_success(model_id: &str) {
    let key = model_id.trim();
    if key.is_empty() {
        return;
    }
    let Ok(mut guard) = cell().lock() else {
        return;
    };
    guard.remove(key);
}

pub fn record_failure(model_id: &str) {
    let key = model_id.trim();
    if key.is_empty() {
        return;
    }
    let Ok(mut guard) = cell().lock() else {
        return;
    };
    let entry = guard.entry(key.to_string()).or_insert(Entry {
        consecutive_failures: 0,
        open_until: None,
    });
    entry.consecutive_failures = entry.consecutive_failures.saturating_add(1);
    if entry.consecutive_failures >= FAILURE_THRESHOLD {
        entry.open_until = Some(Instant::now() + COOLDOWN);
        entry.consecutive_failures = 0;
    }
}

pub fn filter_available_models(models: Vec<String>) -> Vec<String> {
    models
        .into_iter()
        .filter(|m| !is_open(m))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_after_three_failures() {
        let model = "test-model-circuit-unique";
        record_success(model);
        record_failure(model);
        record_failure(model);
        assert!(!is_open(model));
        record_failure(model);
        assert!(is_open(model));
        record_success(model);
        assert!(!is_open(model));
    }
}
