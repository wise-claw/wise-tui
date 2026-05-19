use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssistantSource {
    /// 内置预设：v1 ship 一个默认 Claude assistant。
    Builtin,
    /// 用户在 AssistantsPanel 中创建并持久化到 SQLite 的条目。
    Custom,
    /// 来自扩展贡献，read-only。
    Extension,
}
