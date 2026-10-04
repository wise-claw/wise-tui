use crate::wise_db::WiseDb;
use std::collections::HashSet;
use std::path::Path;

const EXCLUDED_PATHS_SETTING: &str = "wise.repositoryDiscoveryExcludedPaths.v1";

fn path_key(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

pub(super) fn excluded_paths(db: &WiseDb) -> Result<HashSet<String>, String> {
    let Some(raw) = db.get_setting(EXCLUDED_PATHS_SETTING)? else {
        return Ok(HashSet::new());
    };
    let paths: Vec<String> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(paths.iter().map(|path| path_key(Path::new(path))).collect())
}

pub(super) fn is_excluded(paths: &HashSet<String>, path: &Path) -> bool {
    paths.contains(&path_key(path))
}

/// 用户移除只影响 Wise 自动发现；磁盘仓库和历史数据仍可手动重新打开。
/// 调用方持有 REPOSITORY_MUTATION_LOCK，避免扫描与移除读写交错。
pub(super) fn set_excluded(db: &WiseDb, path: &Path, excluded: bool) -> Result<(), String> {
    let mut paths = excluded_paths(db)?;
    let key = path_key(path);
    let changed = if excluded { paths.insert(key) } else { paths.remove(&key) };
    if !changed { return Ok(()); }
    let mut sorted: Vec<_> = paths.into_iter().collect();
    sorted.sort();
    db.set_setting(EXCLUDED_PATHS_SETTING, &serde_json::to_string(&sorted).map_err(|e| e.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::Mutex;

    fn db() -> WiseDb {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").unwrap();
        WiseDb(Mutex::new(connection))
    }

    #[test]
    fn removal_exclusions_survive_reload_and_skip_both_scopes() {
        let db = db();
        let parent = tempfile::tempdir().unwrap();
        let removed = parent.path().join("wise-doc");
        let flow = parent.path().join("wise-flow");
        let kept = parent.path().join("wise-tui");
        for path in [&removed, &flow, &kept] { std::fs::create_dir_all(path.join(".git")).unwrap(); }
        set_excluded(&db, &removed, true).unwrap();
        set_excluded(&db, &flow, true).unwrap();
        let reloaded = excluded_paths(&db).unwrap();
        let immediate: Vec<_> = std::fs::read_dir(parent.path()).unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.join(".git").exists() && !is_excluded(&reloaded, path)).collect();
        assert_eq!(immediate, vec![kept.clone()]);
        let recursive: Vec<_> = walkdir::WalkDir::new(parent.path()).into_iter()
            .map(|entry| entry.unwrap().into_path())
            .filter(|path| path.join(".git").exists() && !is_excluded(&reloaded, path)).collect();
        assert_eq!(recursive, vec![kept]);
        assert!(!is_excluded(&reloaded, parent.path()));
    }

    #[test]
    fn explicit_readd_clears_only_the_selected_repository() {
        let db = db();
        let removed = Path::new("/work/wise-doc");
        let sibling = Path::new("/work/wise-flow");
        set_excluded(&db, removed, true).unwrap();
        set_excluded(&db, sibling, true).unwrap();
        set_excluded(&db, removed, false).unwrap();
        let paths = excluded_paths(&db).unwrap();
        assert!(!is_excluded(&paths, removed));
        assert!(is_excluded(&paths, sibling));
        assert!(!is_excluded(&paths, Path::new("/work/wise-flow-other")));
    }

    #[test]
    fn exclusion_matches_canonical_alias_and_trailing_slash() {
        let db = db();
        let parent = tempfile::tempdir().unwrap();
        let repo = parent.path().join("repo");
        std::fs::create_dir(&repo).unwrap();
        set_excluded(&db, &repo.join("."), true).unwrap();
        let paths = excluded_paths(&db).unwrap();
        assert!(is_excluded(&paths, &repo));
        assert!(is_excluded(&paths, &repo.join("")));
        assert!(!is_excluded(&paths, &repo.join("nested")));
    }
}
