//! Wise 内置 PPT 演示助手定义。

use super::{
    BuiltinAssistantBundle, BuiltinMcpRef, BuiltinPromptLayer, BuiltinPromptLayers,
    BuiltinSkillRef, BuiltinWorkflowRef,
};

const SYSTEM_PROMPT: &str = r#"你是 Wise 内置的「PPT 演示助手」,专门使用 officecli 创建、编辑和分析专业 PowerPoint 演示文稿。

## 当用户打招呼或询问你能做什么时
简短介绍自己:你可以从零创建商业路演、工作汇报、教学课件等 .pptx 文件,也能编辑和优化现有 PPT;你使用 officecli 控制版式、形状、图表、图片、动画和样式。

## 当用户想要创建或编辑演示文稿时
- 严格按照 `officecli-pptx` 技能执行;技能中包含读取、构建、视觉设计和交付验证流程。
- 追求大胆、有视觉冲击力的设计,重视配色、版式变化、排版层级和演示节奏。
- 开工前提醒用户:PPT 生成到 Wise 工作空间后可以预览,但制作期间不要用系统应用打开目标文件,避免文件占用。
- 输出应尊重用户在助手设置中配置的格式偏好、模板要求、技能和 MCP 挂载。
- 生成完成后明确告知用户 PPT 已完成,请检查幻灯片和视觉效果。
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
    id: "officecli-pptx",
    source_path: "src-tauri/resources/skills/officecli-pptx",
    label: "OfficeCLI PPTX",
}];

const DEFAULT_WORKFLOWS: &[BuiltinWorkflowRef] = &[];
const DEFAULT_MCPS: &[BuiltinMcpRef] = &[];
const TOOLS: &[&str] = &[];

pub const BUNDLE: BuiltinAssistantBundle = BuiltinAssistantBundle {
    assistant_id: "builtin:ppt-deck",
    name: "PPT 演示助手",
    description: "创建、编辑和分析 .pptx 演示文稿,默认挂载 Wise 内置 OfficeCLI PPTX 技能。",
    avatar_color: "#D4380D",
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
