//! Codex 用户级全局技能（`~/.codex/skills`、`~/.agents/skills`、`$CODEX_HOME/skills`）。
//!
//! 与 Claude 的 `list_claude_user_skills` 对齐，供斜杠菜单 / `/skills` 命令在
//! Codex（CLI 与 RPC）执行环境下识别全局技能。行格式复用 `ClaudeProjectSkill`，
//! 字段本身与引擎无关（name / hasSkillMd / description / skillRootPath 等）。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::claude_commands::project_skills::{
    count_skill_files_recursive, read_claude_skill_entry, skill_dir_root_path,
    validate_claude_skill_name, ClaudeProjectSkill,
};

/// Codex 用户级技能根目录集合（按 `$CODEX_HOME`、`~/.codex`、`~/.agents` 顺序，去重）。
fn codex_user_skill_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("CODEX_HOME") {
        let home = home.trim();
        if !home.is_empty() {
            roots.push(PathBuf::from(home).join("skills"));
        }
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".codex").join("skills"));
        roots.push(home.join(".agents").join("skills"));
    }
    let mut seen = HashSet::new();
    roots.retain(|p| seen.insert(p.clone()));
    roots
}

/// 枚举单个用户级技能目录下的技能（目录名即技能名；无 `SKILL.md` 的目录不视为技能，
/// 避免空目录 / 临时目录占位。符号链接目录同样识别）。
fn list_codex_skills_under_dir(skills_dir: &Path) -> Result<Vec<ClaudeProjectSkill>, String> {
    if !skills_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(skills_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if !ft.is_dir() && !ft.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if validate_claude_skill_name(&name).is_err() {
            continue;
        }
        let path = entry.path();
        let (has_skill_md, description) = read_claude_skill_entry(&path);
        if !has_skill_md {
            continue;
        }
        let (skill_source, _) = crate::skills::source::classify(&path);
        out.push(ClaudeProjectSkill {
            name,
            entry_kind: Some("skill".to_string()),
            command_rel_path: None,
            has_skill_md,
            description,
            file_count: count_skill_files_recursive(&path),
            plugin_cache_rel_path: None,
            plugin_cache_root: None,
            source: Some(skill_source),
            is_symlink: crate::skills::source::is_symlink(&path),
            skill_scope: Some("user".to_string()),
            skill_root_path: Some(skill_dir_root_path(&path)),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// 枚举 Codex 用户级全局技能（`~/.codex/skills`、`~/.agents/skills`、`$CODEX_HOME/skills`）。
/// 多根同名技能只保留首个来源，跨根排序后返回。
#[tauri::command]
pub(crate) fn list_codex_user_skills() -> Result<Vec<ClaudeProjectSkill>, String> {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for root in codex_user_skill_roots() {
        for skill in list_codex_skills_under_dir(&root)? {
            let key = skill.name.to_lowercase();
            if seen.insert(key) {
                out.push(skill);
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn user_skill_roots_respects_codex_home_and_dedups() {
        let dir = tempdir().unwrap();
        let prev = std::env::var("CODEX_HOME").ok();
        std::env::set_var("CODEX_HOME", dir.path());
        let roots = codex_user_skill_roots();
        match prev {
            Some(v) => std::env::set_var("CODEX_HOME", v),
            None => std::env::remove_var("CODEX_HOME"),
        }
        let codex_home = roots
            .iter()
            .any(|p| p == &dir.path().join("skills"));
        let codex_default = roots
            .iter()
            .any(|p| p.ends_with(Path::new(".codex").join("skills")));
        let agents = roots
            .iter()
            .any(|p| p.ends_with(Path::new(".agents").join("skills")));
        assert!(codex_home, "CODEX_HOME/skills should be included");
        assert!(codex_default, "~/.codex/skills should be included");
        assert!(agents, "~/.agents/skills should be included");
    }

    #[test]
    fn skips_dirs_without_skill_md_and_keeps_symlinked_skills() {
        let dir = tempdir().unwrap();
        let skills_root = dir.path().join("skills");
        fs::create_dir_all(skills_root.join("good")).unwrap();
        fs::write(skills_root.join("good").join("SKILL.md"), "---\ndescription: hi\n---\n").unwrap();
        fs::create_dir_all(skills_root.join("empty")).unwrap();
        fs::create_dir_all(skills_root.join(".system")).unwrap();
        fs::write(skills_root.join(".system").join("SKILL.md"), "x").unwrap();

        #[cfg(unix)]
        {
            let target = dir.path().join("target-skill");
            fs::create_dir_all(&target).unwrap();
            fs::write(target.join("SKILL.md"), "---\ndescription: linked\n---\n").unwrap();
            std::os::unix::fs::symlink(&target, skills_root.join("linked")).unwrap();
        }

        let rows = list_codex_skills_under_dir(&skills_root).unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert!(names.contains(&"good"));
        assert!(!names.contains(&"empty"));
        assert!(!names.contains(&".system"));
        #[cfg(unix)]
        {
            assert!(rows.iter().any(|r| r.name == "linked" && r.is_symlink));
        }
    }

    #[test]
    fn scan_merges_multiple_roots_deduplicated_by_name() {
        let dir = tempdir().unwrap();
        let root_a = dir.path().join("a");
        let root_b = dir.path().join("b");
        for root in [&root_a, &root_b] {
            fs::create_dir_all(root.join("shared")).unwrap();
            fs::write(root.join("shared").join("SKILL.md"), "x").unwrap();
        }
        fs::create_dir_all(root_b.join("unique")).unwrap();
        fs::write(root_b.join("unique").join("SKILL.md"), "y").unwrap();

        let mut out = Vec::new();
        for root in [root_a, root_b] {
            out.extend(list_codex_skills_under_dir(&root).unwrap());
        }
        let mut seen = HashSet::new();
        let mut deduped = Vec::new();
        for skill in out {
            if seen.insert(skill.name.to_lowercase()) {
                deduped.push(skill.name);
            }
        }
        assert_eq!(deduped, ["shared", "unique"]);
    }
}
