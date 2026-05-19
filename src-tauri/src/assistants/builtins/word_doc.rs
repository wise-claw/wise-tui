//! Wise 内置 Word 文档助手定义。

use super::{
    BuiltinAssistantBundle, BuiltinMcpRef, BuiltinPromptLayer, BuiltinPromptLayers,
    BuiltinSkillRef, BuiltinWorkflowRef,
};

const SYSTEM_PROMPT: &str = r#"你是 Wise 内置的「Word 文档助手」,专门使用 officecli 创建、编辑和分析专业 Word 文档。

## 当用户打招呼或询问你能做什么时
简短介绍自己:你可以从零创建报告、方案、信函、备忘录等 .docx 文件,也能编辑和优化现有文档;你使用 officecli 控制格式、样式、表格、图表、页眉页脚等,不要求用户安装 Office。

## 当用户想要创建或编辑文档时
- 严格按照 `officecli-docx` 技能执行;技能中包含读取、构建、格式化和交付验证流程。
- 开工前提醒用户:文档生成到 Wise 工作空间后可以预览,但制作期间不要用系统应用打开目标文件,避免文件占用。
- 输出应尊重用户在助手设置中配置的格式偏好、模板要求、技能和 MCP 挂载。
- 生成完成后明确告知用户文档已完成,请检查格式和内容。
"#;

const PRD_TASK_SPLIT_LAYER: BuiltinPromptLayer = BuiltinPromptLayer {
    template_id: "prdTaskSplit",
    version: "1.0.0",
    enabled: false,
    system_body: "",
    repo_strategy_body: "",
    user_body: "",
};

const PHASE1_LAYER: BuiltinPromptLayer = BuiltinPromptLayer {
    template_id: "prdTaskSplitPhase1",
    version: "1.0.0",
    enabled: false,
    system_body: "",
    repo_strategy_body: "",
    user_body: "",
};

const PHASE2_LAYER: BuiltinPromptLayer = BuiltinPromptLayer {
    template_id: "prdTaskSplitPhase2",
    version: "1.0.0",
    enabled: false,
    system_body: "",
    repo_strategy_body: "",
    user_body: "",
};

const DEFAULT_SKILLS: &[BuiltinSkillRef] = &[BuiltinSkillRef {
    id: "officecli-docx",
    source_path: "src-tauri/resources/skills/officecli-docx",
    label: "OfficeCLI DOCX",
}];

const DEFAULT_WORKFLOWS: &[BuiltinWorkflowRef] = &[];
const DEFAULT_MCPS: &[BuiltinMcpRef] = &[];
const TOOLS: &[&str] = &[];

pub const BUNDLE: BuiltinAssistantBundle = BuiltinAssistantBundle {
    assistant_id: "builtin:word-doc",
    name: "Word 文档助手",
    description: "创建、编辑和分析 .docx 文档,默认挂载 Wise 内置 OfficeCLI DOCX 技能。",
    avatar_color: "#2F6BFF",
    engine_id: "claude",
    model: None,
    system_prompt: SYSTEM_PROMPT,
    tools: TOOLS,
    default_workflows: DEFAULT_WORKFLOWS,
    default_skills: DEFAULT_SKILLS,
    default_mcps: DEFAULT_MCPS,
    default_prompt_layers: BuiltinPromptLayers {
        prd_task_split: PRD_TASK_SPLIT_LAYER,
        phase1: PHASE1_LAYER,
        phase2: PHASE2_LAYER,
    },
};
