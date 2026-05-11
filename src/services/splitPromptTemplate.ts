/**
 * 拆分提示词模板（spec §3）：占位符由渲染器替换，缺失变量视为装配失败。
 */

import type { SplitPromptTemplateLayers } from "../types/splitPromptLayers";
import { SPLIT_PROMPT_STANDARD_VARIABLES } from "../types/splitPromptLayers";
import {
  PROMPT_SLOT_PRD_TASK_SPLIT,
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1,
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2,
} from "./splitPromptBundle";

export interface SplitPromptTemplate {
  id: string;
  version: string;
  /** 系统/角色层：约束输出形态与语言 */
  systemBody: string;
  /** 用户层：可含 {PRD_MARKDOWN} 等占位符（已含可选前置的仓库策略正文） */
  userBody: string;
  enabled: boolean;
}

export type SplitPromptRenderVars = {
  PRD_MARKDOWN: string;
  REQUIREMENTS_INDEX_JSON: string;
  REPO_CONTEXT_JSON: string;
  OUTPUT_SCHEMA_REF: string;
};

const PLACEHOLDER_RE = /\{(PRD_MARKDOWN|REQUIREMENTS_INDEX_JSON|REPO_CONTEXT_JSON|OUTPUT_SCHEMA_REF)\}/g;

/**
 * 平台默认「PRD 任务拆分」分层稿（用途槽位 `prdTaskSplit`）。
 * 与迁移写入的 `app_settings.split_prompt_layers:platform_default` 应保持语义一致；
 * 修改后请运行 `bun run emit:platform-split-prompt-seed` 并提交生成的 seed JSON。
 */
export const DEFAULT_SPLIT_PROMPT_LAYERS: SplitPromptTemplateLayers = {
  templateId: "prd-task-split-platform-v2",
  version: "2.0.0",
  enabled: true,
  systemBody: [
    "你是资深技术负责人，负责基于最新需求内容与需求索引，将工作拆成结构化研发任务（单一 JSON 输出）。",
    "",
    "硬性约束：",
    "- 从第一字节起输出单一 JSON 对象，禁止使用 markdown 代码围栏或任何前后缀说明文字。",
    "- 任务拆分必须以「最新需求内容（PRD Markdown）」为唯一主依据；禁止将仓库实现现状、历史上下文或主观经验作为拆分前提。",
    "- 严禁编造需求：每条任务必须能追溯到下发的 requirements-index 中的 id（在 description 或 scope 中写明所覆盖的 requirement id 集合）。",
    "- 每个任务都必须给出 taskAnchors，且 contextBefore/contextAfter 至少一项可在对应 requirement 原文中定位到；禁止生成无法回溯原文的锚点。",
    "- taskAnchors.from/to 必须是可验证区间（from>=0 且 to>from），不得用拍脑袋坐标占位。",
    "- 字段名、枚举值必须与用户消息中的 OUTPUT_SCHEMA 完全一致；任务 status 仅允许 executable 或 not_executable（勿使用其它拼写）。",
    "- 禁止依赖仓库上下文推断未出现在需求中的实现细节；若需求信息不足，必须通过 missing_prerequisites 明确缺口，不得臆测补全。",
    "",
    "拆分质量：",
    "- 原子化：一任务一交付目标，可独立完成与验收；禁止把多个无关目标塞进同一任务。",
    "- 依赖：depends_on 仅引用同输出内其它任务的 id；整体依赖无环；execution_order 与 DAG 拓扑兼容且覆盖全部任务 id。",
    "- 可执行性：当且仅当（任务边界清晰 + acceptance_criteria 可被客观验证 + test_plan 可落地执行 + 需求信息足以开工）时标记 executable，且 missing_prerequisites 必须为空数组。否则必须标记 not_executable，且 missing_prerequisites 为非空数组，列出可行动的前置（例如「需补充订单状态流转规则」「需明确退款触发条件」），禁止泛泛的「待确认」。",
    "- 验收与测试：acceptance_criteria、test_plan 各自至少一条，且与任务 scope 对齐；不可测试的表述须改写或标为 not_executable 并说明缺口。",
    "- 迭代优化：若用户消息或附加上下文中包含「上一轮拆分结果、评审意见、缺口列表或批评家反馈」，必须在本次输出中吸收：修正错误依赖、补全缺口、合并过度碎片化任务，并避免重复已知问题。",
    "",
    "语言：说明性字符串使用中文，专有名词与代码标识可保留英文。",
  ].join("\n"),
  repoStrategyBody: "",
  userBody: [
    "在生成最终 JSON 前，请在内心自检：依赖无环、execution_order 合理、executable 与 missing_prerequisites 符合 schema、每条任务可追溯至需求索引 id、且所有任务均直接来源于最新需求内容。",
    "",
    "## PRD（Markdown）",
    "",
    "{PRD_MARKDOWN}",
    "",
    "## 需求索引（JSON）",
    "",
    "{REQUIREMENTS_INDEX_JSON}",
    "",
    "## 输出 schema 引用",
    "",
    "{OUTPUT_SCHEMA_REF}",
    "",
    "请基于以上内容输出满足 OUTPUT_SCHEMA 的拆分结果 JSON。",
  ].join("\n"),
  variables: SPLIT_PROMPT_STANDARD_VARIABLES,
};

export const DEFAULT_SPLIT_PROMPT_PHASE1_LAYERS: SplitPromptTemplateLayers = {
  templateId: "prd-task-split-phase1-platform-v1",
  version: "1.0.0",
  enabled: true,
  systemBody: [
    "你是资深技术负责人，当前只执行第 1 阶段：把 PRD 完整拆分为任务列表。",
    "",
    "硬性约束：",
    "- 只做任务拆分，不做 requirement 映射，不做锚点定位。",
    "- 输出必须为单一 JSON 对象（首字节为 {）。",
    "- 任务列表需覆盖需求 100% 范围，避免遗漏。",
    "- executionStatus 仅允许 executable 或 not_executable。",
  ].join("\n"),
  repoStrategyBody: "",
  userBody: [
    "请基于以下输入仅输出阶段1拆分结果 JSON。",
    "",
    "## PRD（Markdown）",
    "",
    "{PRD_MARKDOWN}",
    "",
    "## 需求索引（JSON）",
    "",
    "{REQUIREMENTS_INDEX_JSON}",
    "",
    "## 仓库上下文（JSON）",
    "",
    "{REPO_CONTEXT_JSON}",
  ].join("\n"),
  variables: SPLIT_PROMPT_STANDARD_VARIABLES,
};

export const DEFAULT_SPLIT_PROMPT_PHASE2_LAYERS: SplitPromptTemplateLayers = {
  templateId: "prd-task-split-phase2-platform-v1",
  version: "1.0.0",
  enabled: true,
  systemBody: [
    "你是资深技术负责人，当前只执行第 2 阶段：基于既有任务列表做需求溯源映射和锚点定位。",
    "",
    "硬性约束：",
    "- 不得新增、删除或改写任务定义；仅补充映射与锚点。",
    "- 输出必须为单一 JSON 对象（首字节为 {）。",
    "- 每个任务至少映射 1 个 requirement id；当任务覆盖多个需求项时，必须映射多个 id（允许 1..N）。",
    "- 每个任务必须提供可回溯到 requirement 原文的 taskAnchors。",
  ].join("\n"),
  repoStrategyBody: "",
  userBody: [
    "请基于以下输入仅输出阶段2映射结果 JSON。",
    "",
    "## PRD（Markdown）",
    "",
    "{PRD_MARKDOWN}",
    "",
    "## 需求索引（JSON）",
    "",
    "{REQUIREMENTS_INDEX_JSON}",
  ].join("\n"),
  variables: SPLIT_PROMPT_STANDARD_VARIABLES,
};

/** 将分层稿折叠为渲染器使用的单对象（仓库策略插入在用户模板前）。 */
export function splitPromptLayersToFlatTemplate(layers: SplitPromptTemplateLayers): SplitPromptTemplate {
  const strategy = layers.repoStrategyBody.trim();
  const user = layers.userBody.trim();
  const userBody = strategy
    ? ["## 仓库策略层", "", strategy, "", "---", "", user].filter((block) => block.length > 0).join("\n")
    : user;
  return {
    id: layers.templateId,
    version: layers.version,
    enabled: layers.enabled,
    systemBody: layers.systemBody.trim(),
    userBody: userBody || user,
  };
}

export const DEFAULT_CLAUDE_SPLIT_PROMPT_TEMPLATE: SplitPromptTemplate = splitPromptLayersToFlatTemplate(
  DEFAULT_SPLIT_PROMPT_LAYERS,
);

export function getDefaultSplitPromptLayersBySlot(slotId: string): SplitPromptTemplateLayers {
  if (slotId === PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1) return DEFAULT_SPLIT_PROMPT_PHASE1_LAYERS;
  if (slotId === PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2) return DEFAULT_SPLIT_PROMPT_PHASE2_LAYERS;
  if (slotId === PROMPT_SLOT_PRD_TASK_SPLIT) return DEFAULT_SPLIT_PROMPT_LAYERS;
  return DEFAULT_SPLIT_PROMPT_LAYERS;
}

export type RenderSplitPromptResult =
  | {
    ok: true;
    renderedSystem: string;
    renderedUser: string;
    /** 合并送入单文件时的全文（spec 5.1 prompt.rendered.md） */
    renderedCombinedForExport: string;
  }
  | {
    ok: false;
    missing: string[];
  };

/** 安全替换占位符：仅允许预定义四个键；缺失则失败。 */
export function renderSplitPromptTemplate(
  template: SplitPromptTemplate,
  vars: SplitPromptRenderVars,
): RenderSplitPromptResult {
  const required: (keyof SplitPromptRenderVars)[] = [
    "PRD_MARKDOWN",
    "REQUIREMENTS_INDEX_JSON",
    "REPO_CONTEXT_JSON",
    "OUTPUT_SCHEMA_REF",
  ];
  const missing = required.filter((k) => !vars[k].trim());
  if (missing.length > 0) {
    return { ok: false, missing };
  }

  function fill(body: string): string {
    return body.replace(PLACEHOLDER_RE, (_, key: string) => {
      if (key in vars) return vars[key as keyof SplitPromptRenderVars];
      return _;
    });
  }

  const renderedSystem = fill(template.systemBody).trim();
  const renderedUser = fill(template.userBody).trim();

  const leftoverUser = renderedUser.match(PLACEHOLDER_RE) ?? [];
  const leftoverSystem = renderedSystem.match(PLACEHOLDER_RE) ?? [];
  const leftover = [...leftoverUser, ...leftoverSystem];
  if (leftover.length > 0) {
    return { ok: false, missing: [...new Set(leftover.map((x) => x.replace(/[{}]/g, "")))] };
  }

  const renderedCombinedForExport = [`# system\n\n${renderedSystem}`, "", `# user\n\n${renderedUser}`].join("\n");

  return { ok: true, renderedSystem, renderedUser, renderedCombinedForExport };
}

export interface BuildSplitPhase1PromptInput {
  systemInstruction: string;
  associatedPromptMarkdown: string;
  prdMarkdown: string;
  repoContextJson: string;
}

export interface BuildSplitPhase2PromptInput {
  systemInstruction: string;
  associatedPromptMarkdown: string;
  phase1Tasks: unknown[];
  prdMarkdown: string;
  requirementsIndexJson: string;
}

/** 阶段1输出 schema：仅任务拆分，不含映射与锚点。 */
export function buildSplitPhase1OutputSchemaJson(): string {
  return JSON.stringify(
    {
      version: 1,
      tasks: [
        {
          id: "task-1",
          ordinal: 1,
          title: "任务标题",
          description: "任务范围与实现目标",
          role: "frontend",
          executionStatus: "executable",
          missingPrerequisites: [],
          dependencies: [],
          subtasks: ["子任务1"],
          dod: ["验收标准1"],
        },
      ],
      criticalPath: ["task-1"],
      parallelGroups: [["task-1"]],
      unmetPreconditions: [],
    },
    null,
    2,
  );
}

/** 阶段2输出 schema：按任务回填需求映射与锚点。 */
export function buildSplitPhase2OutputSchemaJson(): string {
  return JSON.stringify(
    {
      version: 1,
      taskMappings: [
        {
          taskId: "task-1",
          sourceRequirementIds: ["req-functional-1", "req-acceptance-1"],
          taskAnchors: {
            from: 0,
            to: 10,
            textHash: "anchor-task-1",
            contextBefore: "前文",
            contextAfter: "后文",
          },
        },
      ],
    },
    null,
    2,
  );
}

/** 组装阶段1提示词：只做任务拆分。 */
export function buildSplitPhase1PromptMessage(input: BuildSplitPhase1PromptInput): string {
  const systemSection = ["# system", "", input.systemInstruction.trim()].join("\n");
  return [
    systemSection,
    "",
    "# user",
    "",
    "## 阶段 1：只做需求拆分（禁止映射与锚点）",
    "你只负责把需求拆成完整任务列表，确保任务覆盖 100% 需求范围。",
    "本阶段禁止输出 sourceRequirementIds / taskAnchors / taskRequirementLinks。",
    "",
    "## 需求拆分关联提示词",
    "```markdown",
    input.associatedPromptMarkdown.trim() || "（未提供提示词）",
    "```",
    "",
    "## 最新需求内容（PRD Markdown）",
    "```markdown",
    input.prdMarkdown.trim(),
    "```",
    "",
    "## 输入文件内容：repo-context.json",
    "```json",
    input.repoContextJson.trim(),
    "```",
    "",
    "## 输出 schema（阶段1）",
    "```json",
    buildSplitPhase1OutputSchemaJson(),
    "```",
    "",
    "## 输出约束",
    "- 仅输出 JSON 对象（第一字节即为 {）。",
    "- 仅生成任务拆分字段，不要输出映射和锚点字段。",
    "- 保证任务覆盖完整需求，避免遗漏。",
  ].join("\n");
}

/** 组装阶段2提示词：按阶段1任务回填映射与锚点。 */
export function buildSplitPhase2PromptMessage(input: BuildSplitPhase2PromptInput): string {
  const systemSection = ["# system", "", input.systemInstruction.trim()].join("\n");
  return [
    systemSection,
    "",
    "# user",
    "",
    "## 阶段 2：逐任务溯源映射 requirement 并标注锚点",
    "你只能基于阶段1任务列表 + PRD + requirements-index 进行映射与锚点定位，不得新增/删除/改写任务。",
    "",
    "## 阶段2溯源关联提示词",
    "```markdown",
    input.associatedPromptMarkdown.trim() || "（未提供提示词）",
    "```",
    "",
    "## 阶段1任务列表（只读）",
    "```json",
    JSON.stringify({ version: 1, tasks: input.phase1Tasks }, null, 2),
    "```",
    "",
    "## 最新需求内容（PRD Markdown）",
    "```markdown",
    input.prdMarkdown.trim(),
    "```",
    "",
    "## 输入文件内容：requirements-index.json",
    "```json",
    input.requirementsIndexJson.trim(),
    "```",
    "",
    "## 输出 schema（阶段2）",
    "```json",
    buildSplitPhase2OutputSchemaJson(),
    "```",
    "",
    "## 输出约束",
    "- 仅输出 JSON 对象（第一字节即为 {）。",
    "- taskMappings 必须覆盖阶段1的全部 taskId。",
    "- 每个 taskId 至少映射 1 个 sourceRequirementIds；若任务覆盖多个需求项，必须返回多个 requirement id（允许 1..N）。",
    "- 每个 taskAnchors 的 contextBefore/contextAfter 至少一项可在对应 requirement 原文中定位，from/to 为有效区间。",
  ].join("\n");
}
