//! Import flows: copy a skill directory into wise's home, or create a
//! symlink pointing at it.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::source::wise_skills_home;

const COPY_SIZE_CAP_BYTES: u64 = 200 * 1024 * 1024; // 200 MB

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSkill {
    pub name: String,
    pub location: String,
    pub is_symlink: bool,
}

fn ensure_home() -> Result<PathBuf, String> {
    let home = wise_skills_home().ok_or_else(|| "could not resolve home dir".to_string())?;
    fs::create_dir_all(&home).map_err(|e| format!("create {}: {e}", home.display()))?;
    Ok(home)
}

fn validate_source_dir(source: &Path) -> Result<PathBuf, String> {
    let canonical = source
        .canonicalize()
        .map_err(|e| format!("source path '{}' resolution: {e}", source.display()))?;
    let meta = fs::metadata(&canonical)
        .map_err(|e| format!("source path stat: {e}"))?;
    if !meta.is_dir() {
        return Err(format!("source path '{}' is not a directory", canonical.display()));
    }
    Ok(canonical)
}

fn destination_for(source: &Path) -> Result<(PathBuf, String), String> {
    let home = ensure_home()?;
    let name = source
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("source path '{}' has no name", source.display()))?
        .to_string();
    let dest = home.join(&name);
    if dest.exists() {
        return Err(format!("destination already exists: {}", dest.display()));
    }
    Ok((dest, name))
}

pub fn import_copy(source: &Path) -> Result<ImportedSkill, String> {
    let canonical = validate_source_dir(source)?;
    let total = directory_size_bytes(&canonical, 0)?;
    if total > COPY_SIZE_CAP_BYTES {
        return Err(format!(
            "skill directory exceeds {}MB cap; refusing to copy",
            COPY_SIZE_CAP_BYTES / 1024 / 1024
        ));
    }
    let (dest, name) = destination_for(&canonical)?;
    copy_dir_recursive(&canonical, &dest)?;
    Ok(ImportedSkill {
        name,
        location: dest.to_string_lossy().to_string(),
        is_symlink: false,
    })
}

pub fn import_symlink(source: &Path) -> Result<ImportedSkill, String> {
    let canonical = validate_source_dir(source)?;
    let (dest, name) = destination_for(&canonical)?;
    create_symlink(&canonical, &dest)?;
    Ok(ImportedSkill {
        name,
        location: dest.to_string_lossy().to_string(),
        is_symlink: true,
    })
}

pub fn delete_imported(name: &str) -> Result<(), String> {
    let home = ensure_home()?;
    let target = home.join(name);
    if !target.exists() {
        return Err(format!("skill '{name}' not found in {}", home.display()));
    }
    let meta = fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        fs::remove_file(&target).map_err(|e| e.to_string())?;
    } else {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn export_symlink(source: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        return Err(format!("destination already exists: {}", dest.display()));
    }
    let canonical = validate_source_dir(source)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
    }
    create_symlink(&canonical, dest)
}

fn directory_size_bytes(path: &Path, depth: usize) -> Result<u64, String> {
    if depth > 32 {
        return Err("directory too deep".to_string());
    }
    let mut total: u64 = 0;
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_symlink() {
            // Skip symlinks: don't follow into possibly-large external trees.
            continue;
        }
        if ft.is_dir() {
            total = total.saturating_add(directory_size_bytes(&entry.path(), depth + 1)?);
            if total > COPY_SIZE_CAP_BYTES {
                return Ok(total);
            }
        } else if ft.is_file() {
            total = total.saturating_add(
                entry.metadata().map_err(|e| e.to_string())?.len(),
            );
            if total > COPY_SIZE_CAP_BYTES {
                return Ok(total);
            }
        }
    }
    Ok(total)
}

fn copy_dir_recursive(source: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("mkdir {}: {e}", dest.display()))?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        let s = entry.path();
        let d = dest.join(entry.file_name());
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            copy_dir_recursive(&s, &d)?;
        } else if ft.is_file() {
            fs::copy(&s, &d).map_err(|e| format!("copy {}: {e}", s.display()))?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn create_symlink(source: &Path, dest: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(source, dest)
        .map_err(|e| format!("symlink {} -> {}: {e}", dest.display(), source.display()))
}

#[cfg(windows)]
fn create_symlink(_source: &Path, _dest: &Path) -> Result<(), String> {
    Err("symlink import requires elevated privileges on Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::tempdir;

    // env::set_var("HOME", ...) is process-global. Serialize tests that
    // rely on a redirected HOME so they don't race in cargo's parallel
    // runner.
    static HOME_LOCK: Mutex<()> = Mutex::new(());

    fn make_skill(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        fs::create_dir_all(p.join("nested")).unwrap();
        fs::write(p.join("SKILL.md"), "# hi").unwrap();
        fs::write(p.join("nested").join("more.txt"), "x").unwrap();
        p
    }

    fn redirect_home(test_home: &Path) {
        std::env::set_var("HOME", test_home);
        std::env::set_var("USERPROFILE", test_home);
    }

    #[test]
    fn import_copy_writes_into_wise_skills_home() {
        let _g = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let outer = tempdir().unwrap();
        redirect_home(outer.path());
        let source_root = tempdir().unwrap();
        let src = make_skill(source_root.path(), "hello");
        let result = import_copy(&src).unwrap();
        assert_eq!(result.name, "hello");
        let dest = PathBuf::from(&result.location);
        assert!(dest.join("SKILL.md").exists(), "dest = {}", dest.display());
        assert!(dest.join("nested/more.txt").exists());
        assert!(!result.is_symlink);
    }

    #[cfg(unix)]
    #[test]
    fn import_symlink_creates_symlink() {
        let _g = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let outer = tempdir().unwrap();
        redirect_home(outer.path());
        let source_root = tempdir().unwrap();
        let src = make_skill(source_root.path(), "linkme");
        let result = import_symlink(&src).unwrap();
        assert!(result.is_symlink);
        let dest = PathBuf::from(&result.location);
        let meta = fs::symlink_metadata(&dest).unwrap();
        assert!(meta.file_type().is_symlink());
    }

    #[test]
    fn duplicate_destination_rejected() {
        let _g = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let outer = tempdir().unwrap();
        redirect_home(outer.path());
        let source_root = tempdir().unwrap();
        let src = make_skill(source_root.path(), "dupe");
        import_copy(&src).unwrap();
        let err = import_copy(&src).unwrap_err();
        assert!(err.contains("already exists"));
    }

    #[test]
    fn delete_imported_removes_directory() {
        let _g = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let outer = tempdir().unwrap();
        redirect_home(outer.path());
        let source_root = tempdir().unwrap();
        let src = make_skill(source_root.path(), "togo");
        import_copy(&src).unwrap();
        delete_imported("togo").unwrap();
        assert!(!outer.path().join(".wise/skills/togo").exists());
    }

    #[cfg(unix)]
    #[test]
    fn delete_imported_removes_symlink_only() {
        let _g = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let outer = tempdir().unwrap();
        redirect_home(outer.path());
        let source_root = tempdir().unwrap();
        let src = make_skill(source_root.path(), "linktogo");
        import_symlink(&src).unwrap();
        delete_imported("linktogo").unwrap();
        assert!(src.join("SKILL.md").exists());
    }
}
