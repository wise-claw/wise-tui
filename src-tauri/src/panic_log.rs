//! Panics in background threads of a bundled `.app` only reach stderr, which
//! nobody sees. Keep a bounded on-disk record under `~/.wise/logs/`.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};

const MAX_LOG_BYTES: u64 = 1024 * 1024;

pub(crate) fn install() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(path) = panic_log_path() {
            let record = format_record(info);
            if let Err(e) = append_bounded(&path, &record, MAX_LOG_BYTES) {
                eprintln!("[panic_log] write {} failed: {e}", path.display());
            }
        }
        default_hook(info);
    }));
}

fn panic_log_path() -> Option<PathBuf> {
    crate::wise_paths::wise_dir()
        .ok()
        .map(|dir| dir.join("logs").join("panic.log"))
}

fn format_record(info: &PanicHookInfo<'_>) -> String {
    let payload = info
        .payload()
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "<non-string panic payload>".to_string());
    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "<unknown>".to_string());
    let thread = std::thread::current();
    let backtrace = std::backtrace::Backtrace::force_capture();
    format!(
        "=== {} thread={} at {}\n{}\n{}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f %z"),
        thread.name().unwrap_or("<unnamed>"),
        location,
        payload,
        backtrace
    )
}

/// Appends `record`, first moving a file that already exceeds `max_bytes` to `<name>.1`.
fn append_bounded(path: &Path, record: &str, max_bytes: u64) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    if fs::metadata(path).map(|m| m.len() >= max_bytes).unwrap_or(false) {
        let mut rotated = path.as_os_str().to_owned();
        rotated.push(".1");
        fs::rename(path, PathBuf::from(rotated))?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(record.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::append_bounded;

    #[test]
    fn append_bounded_rotates_once_limit_is_reached() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("logs").join("panic.log");

        append_bounded(&path, "first\n", 10).expect("first append");
        append_bounded(&path, "second\n", 10).expect("second append");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first\nsecond\n");

        append_bounded(&path, "third\n", 10).expect("rotating append");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "third\n");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("logs").join("panic.log.1")).unwrap(),
            "first\nsecond\n"
        );
    }
}
