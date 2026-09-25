//! 多仓库需求协作的协调层。
//!
//! 所有需求、任务、依赖、交付包、修正单、消息、决策与验收状态都由这里的
//! SQLite 事务推进；前端只负责展示、发起命令和作为执行桥启动会话。
//! 设计见 `design/multi-repository-collaboration/`。

pub mod acceptance;
pub mod agents;
pub mod artifacts;
pub mod bridge;
pub mod changes;
pub mod commands;
pub mod context;
pub mod decisions;
pub mod error;
pub mod events;
pub mod legacy;
pub mod memory;
pub mod model;
pub mod plans;
pub mod requirements;
pub mod resources;
pub mod runtime;
pub mod runtime_resources;
pub mod scheduler;
pub mod usage;
pub mod util;
pub mod verification;

#[cfg(test)]
mod tests;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Repository facts the coordination layer needs; sourced from `~/.wise/repositories.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RepoInfo {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub role_tags: Vec<String>,
}

pub type RepoDirectory = HashMap<i64, RepoInfo>;

pub fn repo_directory(items: impl IntoIterator<Item = RepoInfo>) -> RepoDirectory {
    items.into_iter().map(|r| (r.id, r)).collect()
}
