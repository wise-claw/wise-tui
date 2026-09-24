//! Sync `#[tauri::command]` bodies run inline on the IPC thread (the macOS main
//! thread). Commands that walk directories, read/write user files of unbounded
//! size or wait on child processes wrap their blocking body with `run_blocking`.

pub(crate) async fn run_blocking<T, F>(label: &'static str, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("{label} 任务异常: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::run_blocking;

    #[tokio::test]
    async fn returns_inner_result_and_maps_panics_to_errors() {
        assert_eq!(run_blocking("ok", || Ok(7)).await, Ok(7));
        assert_eq!(
            run_blocking::<(), _>("err", || Err("boom".to_string())).await,
            Err("boom".to_string())
        );
        let panicked = run_blocking::<(), _>("walk", || panic!("bad entry")).await;
        assert!(panicked.unwrap_err().starts_with("walk 任务异常"));
    }
}
