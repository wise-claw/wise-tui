//! Per-engine wiring for the ACP-based execution engines (OpenCode, DeepSeek Harness).
//!
//! Both agents speak the standard Agent Client Protocol over stdio, so the transport,
//! session, and stream-adaptation layers are shared; only the binary, argv, resume
//! method, event channel names, and bind-line type differ.

use crate::{dsh_binary, opencode_binary};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AcpEngine {
    OpenCode,
    DeepSeek,
}

impl AcpEngine {
    pub(crate) fn kind(self) -> &'static str {
        match self {
            AcpEngine::OpenCode => "opencode",
            AcpEngine::DeepSeek => "deepseek",
        }
    }

    pub(crate) fn display_name(self) -> &'static str {
        match self {
            AcpEngine::OpenCode => "OpenCode",
            AcpEngine::DeepSeek => "DeepSeek Harness",
        }
    }

    /// Extra argv after the resolved binary that starts the ACP stdio server.
    pub(crate) fn spawn_args(self) -> &'static [&'static str] {
        match self {
            AcpEngine::OpenCode => &["acp"],
            AcpEngine::DeepSeek => &["--profile", "acp"],
        }
    }

    /// ACP method used to attach an existing persisted session.
    pub(crate) fn resume_method(self) -> &'static str {
        match self {
            AcpEngine::OpenCode => "session/load",
            AcpEngine::DeepSeek => "session/resume",
        }
    }

    pub(crate) fn debug_env(self) -> &'static str {
        match self {
            AcpEngine::OpenCode => "WISE_OPENCODE_ACP_DEBUG",
            AcpEngine::DeepSeek => "WISE_DEEPSEEK_ACP_DEBUG",
        }
    }

    /// Stream bind-line `type` the frontend maps to `session.claudeSessionId`.
    pub(crate) fn session_bind_type(self) -> &'static str {
        match self {
            AcpEngine::OpenCode => "opencode_session",
            AcpEngine::DeepSeek => "deepseek_session",
        }
    }

    pub(crate) fn permission_request_event(self) -> &'static str {
        match self {
            AcpEngine::OpenCode => "opencode-acp:permission-request",
            AcpEngine::DeepSeek => "deepseek-acp:permission-request",
        }
    }

    pub(crate) fn permission_resolved_event(self) -> &'static str {
        match self {
            AcpEngine::OpenCode => "opencode-acp:permission-resolved",
            AcpEngine::DeepSeek => "deepseek-acp:permission-resolved",
        }
    }

    pub(crate) fn interrupted_event(self) -> &'static str {
        match self {
            AcpEngine::OpenCode => "opencode-acp:interrupted",
            AcpEngine::DeepSeek => "deepseek-acp:interrupted",
        }
    }

    pub(crate) fn question_resolved_event(self) -> &'static str {
        match self {
            AcpEngine::OpenCode => "opencode-acp:ask-question-resolved",
            AcpEngine::DeepSeek => "deepseek-acp:ask-question-resolved",
        }
    }

    pub(crate) fn plan_resolved_event(self) -> &'static str {
        match self {
            AcpEngine::OpenCode => "opencode-acp:create-plan-resolved",
            AcpEngine::DeepSeek => "deepseek-acp:create-plan-resolved",
        }
    }

    pub(crate) fn find_binary(self) -> Result<String, String> {
        match self {
            AcpEngine::OpenCode => opencode_binary::find_opencode_binary(),
            AcpEngine::DeepSeek => dsh_binary::find_dsh_binary(),
        }
    }

    pub(crate) fn merged_path_env(self) -> String {
        match self {
            AcpEngine::OpenCode => opencode_binary::opencode_merged_path_env(),
            AcpEngine::DeepSeek => dsh_binary::dsh_merged_path_env(),
        }
    }

    pub(crate) fn apply_child_env(self, cmd: &mut tokio::process::Command, path_env: &str) {
        match self {
            AcpEngine::OpenCode => opencode_binary::apply_opencode_child_env(cmd, path_env),
            AcpEngine::DeepSeek => dsh_binary::apply_dsh_child_env(cmd, path_env),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deepseek_uses_acp_profile_and_resume_method() {
        assert_eq!(AcpEngine::DeepSeek.spawn_args(), &["--profile", "acp"]);
        assert_eq!(AcpEngine::DeepSeek.resume_method(), "session/resume");
        assert_eq!(AcpEngine::DeepSeek.session_bind_type(), "deepseek_session");
        assert_eq!(
            AcpEngine::DeepSeek.permission_request_event(),
            "deepseek-acp:permission-request"
        );
    }

    #[test]
    fn opencode_keeps_legacy_acp_wiring() {
        assert_eq!(AcpEngine::OpenCode.spawn_args(), &["acp"]);
        assert_eq!(AcpEngine::OpenCode.resume_method(), "session/load");
        assert_eq!(AcpEngine::OpenCode.session_bind_type(), "opencode_session");
    }
}
