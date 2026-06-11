//! Assistants —— 自定义 assistant 配置(custom)+ 扩展贡献的 assistant
//! (read-only)+ 内置 assistant(builtin)的统一目录。
//!
//! v1 覆盖配置层:保存 / 列出 / 删除 + 读取 system prompt + 解析覆盖层。
//! 助手与具体会话的绑定(启动 chat、切 model)由 cockpit / assistant
//! conversation 接入。

pub mod builtins;
pub mod commands;
pub mod hidden;
pub mod overrides;
pub mod runtime_resolver;
pub mod source;
pub mod storage;
