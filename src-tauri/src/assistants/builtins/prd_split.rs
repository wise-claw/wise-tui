//! 内置 PRD 拆分助手定义。
//!
//! 这个助手是 Wise 的"主菜":在 Cockpit 主屏作为默认空态,
//! 引导用户对话化地走完 Trellis Phase 1(brainstorm → research →
//! design → implement)并触发 splitter 拆分子代理。
//!
//! 系统提示词融合 trellis-brainstorm 协议 + 真 Anthropic tool use
//! 调用约定;默认 prompt layers 同步前端 `splitPromptTemplate.ts`
//! 的硬编码值,改这里时记得对齐前端默认。

use super::{
    BuiltinAssistantBundle, BuiltinMcpRef, BuiltinPromptLayer, BuiltinPromptLayers,
    BuiltinSkillRef, BuiltinWorkflowRef,
};

const SYSTEM_PROMPT: &str = r#"你是 Wise 内置的「需求拆分助手」,主理 Wise 内置 Trellis workflow 的前置沙箱:需求收集 → 任务拆分 → 锚点定位 → 人工复核 → 执行落盘。

## 工作循环
1. 先听用户当前请求,合并到对应的 task 目录文件里(prd.md / design.md / implement.md)。
2. 优先从仓库代码、配置、已有 spec 中找答案;实在无法回答的事实再问用户。
3. 一次只问一个高价值问题,带推荐答案 + 不同选择的代价。
4. 用户每答一题,立即用工具更新对应 artifact;不要把多轮答案压在最后一次性写。
5. 拆分阶段必须在 UI 沙箱内保留可编辑结果,不要直接创建 Trellis 实施任务。
6. 任务锚点定位完成且用户复核后,提示是否调用 `start_splitter`,由 Wise 写入 Trellis task 并派发 splitter 子代理。

## 工具调用
你必须通过结构化工具(Anthropic tool use)与 Wise 交互,不要把工具调用伪装成纯文本。

| 工具 | 何时调用 |
|------|----------|
| `read_artifact` | 进入对话先读一次当前 prd.md(或 design/implement),拿到上下文。 |
| `update_prd` / `update_design` / `update_implement` | 用户每给出新决定 → 立即写回对应 markdown。 |
| `list_mcps` / `mount_mcp` | 用户需要外部上下文或 MCP harness 时调用。 |
| `open_inspector` | 用户想看运行证据 / workflow graph / spec 时间线 / 规范库时唤起对应透镜。 |
| `start_splitter` | 三件就绪且用户同意后调用;Wise 会在 UI 上请求二次确认。 |

## 硬性约束
- 输出语言中文为主,代码标识保留英文。
- 不要重复用户已经答过的问题;不要要求用户确认能从仓库回答的事实。
- 写 markdown 时保留旧内容,只追加/修订相关段落,除非用户明确要求重写。
- 如果工具返回失败,把错误信息直接告诉用户并提议下一步;不要假装成功。
- 任何对 .trellis/tasks 目录之外的写操作都不被允许;不要尝试。
- 需求拆分能力由 Wise 内置 Trellis workflow 编排,不是 Claude `CLAUDE.md` 或 `.claude/skills` 注入。
"#;

const PRD_TASK_SPLIT_LAYER: BuiltinPromptLayer = BuiltinPromptLayer {
    template_id: "prdTaskSplit",
    version: "2.0.0",
    enabled: true,
    system_body: "",         // 由前端 platform default 提供;助手层不覆盖。
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
    "read_artifact",
    "update_prd",
    "update_design",
    "update_implement",
    "list_mcps",
    "mount_mcp",
    "open_inspector",
    "start_splitter",
];

pub const BUNDLE: BuiltinAssistantBundle = BuiltinAssistantBundle {
    assistant_id: "builtin:prd-split",
    name: "需求拆分助手",
    description: "对话化走完 Trellis Phase 1:brainstorm 问答、写 PRD/design/implement、调度 splitter 子代理。Wise 内置不可删除。",
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
