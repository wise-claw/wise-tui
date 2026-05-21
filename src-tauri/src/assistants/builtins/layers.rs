//! 非 PRD 内置助手共用的空 prompt layer 占位。

use super::{BuiltinPromptLayer, BuiltinPromptLayers};

pub const EMPTY_PROMPT_LAYERS: BuiltinPromptLayers = BuiltinPromptLayers {
    prd_task_split: BuiltinPromptLayer {
        template_id: "prdTaskSplit",
        version: "1.0.0",
        enabled: false,
        system_body: "",
        repo_strategy_body: "",
        user_body: "",
    },
    phase1: BuiltinPromptLayer {
        template_id: "prdTaskSplitPhase1",
        version: "1.0.0",
        enabled: false,
        system_body: "",
        repo_strategy_body: "",
        user_body: "",
    },
    phase2: BuiltinPromptLayer {
        template_id: "prdTaskSplitPhase2",
        version: "1.0.0",
        enabled: false,
        system_body: "",
        repo_strategy_body: "",
        user_body: "",
    },
};
