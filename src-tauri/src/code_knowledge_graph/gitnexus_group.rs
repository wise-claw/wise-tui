//! GitNexus **repository groups**（CLI `gitnexus group`，与上游 README 一致）：
//! 多仓场景下 `group create` → `group add` → `group sync`，由 GitNexus 维护 Contract Registry 与跨仓 bridge graph。
//! 文档：<https://github.com/abhigyanpatwari/GitNexus>（Repository groups / `group_sync`）。

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use super::gitnexus_cli_index::{
    command_output_with_timeout, gitnexus_executable, run_gitnexus_analyze_repo_root,
};

const GROUP_SYNC_TIMEOUT: Duration = Duration::from_secs(900);
const LIST_TIMEOUT: Duration = Duration::from_secs(120);

fn run_gitnexus_args(args: &[&str], timeout: Duration) -> Result<String, String> {
    let exe = gitnexus_executable();
    let mut cmd = Command::new(&exe);
    for a in args {
        cmd.arg(a);
    }
    let out = command_output_with_timeout(cmd, timeout, None)?;
    let mut s = String::new();
    if !out.stdout.is_empty() {
        s.push_str(&String::from_utf8_lossy(&out.stdout));
    }
    if !out.stderr.is_empty() {
        if !s.is_empty() {
            s.push('\n');
        }
        s.push_str(&String::from_utf8_lossy(&out.stderr));
    }
    if !out.status.success() {
        return Err(format!(
            "gitnexus {} 失败（exit {:?}）：\n{}",
            args.join(" "),
            out.status.code(),
            s.trim()
        ));
    }
    Ok(s)
}

/// 稳定组名：`wise-grp-<hash>`，由参与仓库 id 集合（排序后）决定。
pub fn stable_wise_group_name(repo_ids: &[i64]) -> String {
    let mut s = repo_ids.to_vec();
    s.sort_unstable();
    let mut h = DefaultHasher::new();
    for id in s {
        id.hash(&mut h);
    }
    format!("wise-grp-{:x}", h.finish())
}

fn normalize_host_path(p: &str) -> String {
    let p = p.trim().replace('\\', "/");
    p.trim_end_matches('/').to_string()
}

fn paths_match(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    a.eq_ignore_ascii_case(b)
}

fn line_is_registry_title(line: &str) -> Option<&str> {
    let line = line.trim_end();
    if !line.starts_with("  ") || line.starts_with("    ") {
        return None;
    }
    let body = line[2..].trim();
    if body.is_empty() || body.contains(' ') || body.contains(':') {
        return None;
    }
    if body.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        Some(body)
    } else {
        None
    }
}

/// 解析 `gitnexus list` 输出，将磁盘上的 Git 根路径映射为 **registry 名称**（`gitnexus group add` 的第三参）。
pub fn resolve_registry_name(repo_root: &Path) -> Result<String, String> {
    let canon = repo_root
        .canonicalize()
        .map_err(|e| format!("无法 canonicalize 仓库路径 {}：{}", repo_root.display(), e))?;
    let list_out = run_gitnexus_args(&["list"], LIST_TIMEOUT)?;
    let needle = normalize_host_path(&canon.to_string_lossy());
    let mut pending_name: Option<String> = None;
    for line in list_out.lines() {
        if let Some(title) = line_is_registry_title(line) {
            pending_name = Some(title.to_string());
            continue;
        }
        let trimmed = line.trim();
        if trimmed.starts_with("Path:") {
            let p = normalize_host_path(trimmed.trim_start_matches("Path:").trim());
            if paths_match(&p, &needle) {
                return pending_name.ok_or_else(|| {
                    format!(
                        "gitnexus list 已匹配路径 {}，但未解析到仓库名；请在该目录执行 gitnexus analyze",
                        needle
                    )
                });
            }
            pending_name = None;
        }
    }
    Err(format!(
        "未在 gitnexus list 中找到已索引仓库 {}。请先在仓库根目录执行 gitnexus analyze。",
        needle
    ))
}

/// 与 [`resolve_registry_name`] 相同；若仓尚未出现在 `gitnexus list` 中，会先执行一次 `gitnexus analyze . --force` 再重试解析（用于「生成项目级索引」等多仓仓库组同步）。
pub fn resolve_registry_name_or_analyze(repo_root: &Path) -> Result<String, String> {
    match resolve_registry_name(repo_root) {
        Ok(n) => Ok(n),
        Err(e0) => {
            eprintln!(
                "[code-graph] GitNexus list miss for {}; running gitnexus analyze --force …\n{}",
                repo_root.display(),
                e0.trim()
            );
            run_gitnexus_analyze_repo_root(repo_root)?;
            resolve_registry_name(repo_root).map_err(|e1| {
                format!(
                    "{}；已自动执行 gitnexus analyze 后仍失败：{}",
                    e0.trim(),
                    e1.trim()
                )
            })
        }
    }
}

fn validate_group_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 120 {
        return Err("group name length invalid".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!(
            "非法组名 {name:?}：仅允许 ASCII 字母数字、连字符与下划线"
        ));
    }
    Ok(())
}

/// `gitnexus group create --force` → 对每个成员 `group add` → `group sync`。
pub fn recreate_and_sync_repository_group(
    group_name: &str,
    members: &[(String /* group_path */, String /* registry */)],
) -> Result<serde_json::Value, String> {
    if members.len() < 2 {
        return Ok(serde_json::json!({
            "skipped": true,
            "reason": "少于 2 个成员，跳过 GitNexus 仓库组"
        }));
    }
    validate_group_name(group_name)?;

    run_gitnexus_args(
        &["group", "create", group_name, "--force"],
        Duration::from_secs(120),
    )
    .map_err(|e| {
        if e.contains("unknown command") || e.contains("Unknown command") {
            format!(
                "当前 gitnexus 可执行文件不支持 `group` 子命令。请升级 GitNexus：在终端执行 `npm install -g gitnexus`（不要在包名后写 `@` 与版本号，即安装注册表当前最新），或设置 GITNEXUS_BIN。详情：{e}"
            )
        } else {
            e
        }
    })?;

    for (gp, reg) in members {
        run_gitnexus_args(
            &["group", "add", group_name, gp.as_str(), reg.as_str()],
            Duration::from_secs(180),
        )?;
    }

    let sync_log = run_gitnexus_args(&["group", "sync", group_name], GROUP_SYNC_TIMEOUT)?;
    let sync_tail = if sync_log.len() > 6000 {
        sync_log[sync_log.len() - 6000..].to_string()
    } else {
        sync_log
    };

    Ok(serde_json::json!({
        "groupName": group_name,
        "memberCount": members.len(),
        "syncLogTail": sync_tail,
    }))
}

#[cfg(test)]
mod tests {
    use super::stable_wise_group_name;

    #[test]
    fn stable_group_name_order_independent() {
        assert_eq!(stable_wise_group_name(&[2, 1, 3]), stable_wise_group_name(&[3, 1, 2]));
    }
}
