//! 内置 PRD 拆分助手定义。
//!
//! 这个助手是 Wise 的"主菜":在 Cockpit 主屏作为默认空态,
//! 以 PRD 拆分面板承载 Trellis 需求沙箱、任务拆分、锚点定位与复核后执行。
//!
//! 默认 prompt layers 同步前端 `splitPromptTemplate.ts` 的硬编码值,
//! 改这里时记得对齐前端默认。

use super::{
    BuiltinAssistantBundle, BuiltinMcpRef, BuiltinPromptLayer, BuiltinPromptLayers,
    BuiltinSkillRef, BuiltinWorkflowRef,
};

const SYSTEM_PROMPT: &str = r#"你是 Wise 内置的「需求拆分助手」,主理 Wise 内置 Trellis workflow 的前置沙箱:需求收集 → 任务拆分 → 锚点定位 → 人工复核 → 执行落盘。

## 工作循环
1. 先把用户输入、导入 PRD、历史拆分和仓库上下文归一化成可编辑的需求条目。
2. 优先从仓库代码、配置、已有 spec 中找答案;实在无法回答的事实再问用户。
3. 拆分结果必须停留在 UI 沙箱内供用户编辑,不要直接创建 Trellis 实施任务。
4. 每个任务都要尽量映射回 PRD 原文锚点,无法定位时保留 unresolved 状态。
5. 只有用户在 UI 中确认后,Wise 才写入 `.trellis/tasks` 并进入执行派发。
6. 如果用户配置了 Skills / MCP / 工程偏好,拆分和派发提示词必须尊重这些运行态覆盖。

## 硬性约束
- 输出语言中文为主,代码标识保留英文。
- 不要重复用户已经答过的问题;不要要求用户确认能从仓库回答的事实。
- 如果运行态返回失败,把错误信息直接告诉用户并提议下一步;不要假装成功。
- 任何对 .trellis/tasks 目录之外的写操作都不被允许;不要尝试。
- 需求拆分能力由 Wise 内置 Trellis workflow 编排,不是 Claude `CLAUDE.md` 或 `.claude/skills` 注入。
"#;

const PRD_TASK_SPLIT_LAYER: BuiltinPromptLayer = BuiltinPromptLayer {
    template_id: "prdTaskSplit",
    version: "2.0.0",
    enabled: true,
    system_body: "", // 由前端 platform default 提供;助手层不覆盖。
    repo_strategy_body: "",
    user_body: "",
};

const PHASE1_LAYER: BuiltinPromptLayer = BuiltinPromptLayer {
    template_id: "prdTaskSplitPhase1",
    version: "1.0.0",
    enabled: true,
    system_body: "",
    repo_strategy_body: "",
    user_body: "",
};

const PHASE2_LAYER: BuiltinPromptLayer = BuiltinPromptLayer {
    template_id: "prdTaskSplitPhase2",
    version: "1.0.0",
    enabled: true,
    system_body: "",
    repo_strategy_body: "",
    user_body: "",
};

const DEFAULT_WORKFLOWS: &[BuiltinWorkflowRef] = &[
    BuiltinWorkflowRef {
        id: "trellis:requirement-intake",
        stage: "intake",
        label: "需求收集沙箱",
        description: "归一化手写 PRD、导入 PRD、历史需求与会话上下文,保留人工可编辑草稿。",
    },
    BuiltinWorkflowRef {
        id: "trellis:prd-task-split",
        stage: "split",
        label: "任务拆分",
        description: "按 Trellis 前置规则生成可审阅任务,不直接进入实现。",
    },
    BuiltinWorkflowRef {
        id: "trellis:anchor-mapping",
        stage: "anchor",
        label: "锚点定位",
        description: "把每个任务映射回 PRD 原文锚点,无法定位时保留 unresolved 状态。",
    },
    BuiltinWorkflowRef {
        id: "trellis:review-and-handoff",
        stage: "handoff",
        label: "复核后执行",
        description: "用户确认后才写入 .trellis/tasks 并进入 splitter dispatch pipeline。",
    },
];

const DEFAULT_SKILLS: &[BuiltinSkillRef] = &[];
const DEFAULT_MCPS: &[BuiltinMcpRef] = &[];

const TOOLS: &[&str] = &[
    "prd_material_intake",
    "prd_task_split",
    "prd_anchor_mapping",
    "trellis_materialize",
    "trellis_fanout",
];

pub const BUNDLE: BuiltinAssistantBundle = BuiltinAssistantBundle {
    assistant_id: "builtin:prd-split",
    name: "需求拆分助手",
    description: "在 Wise 沙箱内完成 PRD 需求整理、任务拆分、锚点复核与 Trellis 落盘执行。Wise 内置不可删除。",
    avatar_color: "#1677FF",
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
