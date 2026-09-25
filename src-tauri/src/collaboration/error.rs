//! 协作命令统一错误：`code, message, retryable, currentRevision?, affectedTaskIds, suggestedAction`。

use serde::Serialize;

pub mod codes {
    pub const AMBIGUOUS_TARGET: &str = "AMBIGUOUS_TARGET";
    pub const REVISION_CONFLICT: &str = "REVISION_CONFLICT";
    pub const AGENT_DISABLED: &str = "AGENT_DISABLED";
    pub const REQUIRED_CAPABILITY_MISSING: &str = "REQUIRED_CAPABILITY_MISSING";
    pub const DEPENDENCY_NOT_READY: &str = "DEPENDENCY_NOT_READY";
    pub const STOP_PENDING: &str = "STOP_PENDING";
    pub const BUDGET_EXHAUSTED: &str = "BUDGET_EXHAUSTED";
    pub const STALE_ACCEPTANCE: &str = "STALE_ACCEPTANCE";
    pub const NOT_FOUND: &str = "NOT_FOUND";
    pub const INVALID_PAYLOAD: &str = "INVALID_PAYLOAD";
    pub const INVALID_PLAN: &str = "INVALID_PLAN";
    pub const INVALID_CHANGE_PAYLOAD: &str = "INVALID_CHANGE_PAYLOAD";
    pub const SCOPE_NOT_AUTHORIZED: &str = "SCOPE_NOT_AUTHORIZED";
    pub const STALE_ATTEMPT: &str = "STALE_ATTEMPT";
    pub const STALE_ROUND: &str = "STALE_ROUND";
    pub const REQUEST_ID_REUSED: &str = "REQUEST_ID_REUSED";
    pub const REQUIREMENT_CANCELLED: &str = "REQUIREMENT_CANCELLED";
    pub const INVALID_STATE: &str = "INVALID_STATE";
    pub const FORBIDDEN: &str = "FORBIDDEN";
    pub const STORAGE_ERROR: &str = "STORAGE_ERROR";
    pub const IO_ERROR: &str = "IO_ERROR";
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollabError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_revision: Option<i64>,
    pub affected_task_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

pub type CResult<T> = Result<T, CollabError>;

impl CollabError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            retryable: false,
            current_revision: None,
            affected_task_ids: Vec::new(),
            suggested_action: None,
            details: None,
        }
    }

    pub fn not_found(what: &str, id: &str) -> Self {
        Self::new(codes::NOT_FOUND, format!("未找到{what}：{id}"))
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(codes::INVALID_PAYLOAD, message)
    }

    pub fn state(message: impl Into<String>) -> Self {
        Self::new(codes::INVALID_STATE, message)
    }

    pub fn revision_conflict(current: i64) -> Self {
        Self::new(codes::REVISION_CONFLICT, "数据已被其他操作更新，请刷新后重试")
            .with_revision(current)
            .retryable()
            .suggest("refresh")
    }

    pub fn with_revision(mut self, revision: i64) -> Self {
        self.current_revision = Some(revision);
        self
    }

    pub fn with_tasks(mut self, ids: Vec<String>) -> Self {
        self.affected_task_ids = ids;
        self
    }

    pub fn retryable(mut self) -> Self {
        self.retryable = true;
        self
    }

    pub fn suggest(mut self, action: &str) -> Self {
        self.suggested_action = Some(action.to_string());
        self
    }

    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }
}

impl std::fmt::Display for CollabError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl From<rusqlite::Error> for CollabError {
    fn from(e: rusqlite::Error) -> Self {
        let retryable = matches!(
            e,
            rusqlite::Error::SqliteFailure(ref err, _)
                if err.code == rusqlite::ErrorCode::DatabaseBusy
                    || err.code == rusqlite::ErrorCode::DatabaseLocked
        );
        let mut out = Self::new(codes::STORAGE_ERROR, format!("协作数据读写失败：{e}"));
        out.retryable = retryable;
        out
    }
}

impl From<serde_json::Error> for CollabError {
    fn from(e: serde_json::Error) -> Self {
        Self::new(codes::INVALID_PAYLOAD, format!("JSON 无效：{e}"))
    }
}

impl From<String> for CollabError {
    fn from(message: String) -> Self {
        Self::new(codes::STORAGE_ERROR, message)
    }
}
