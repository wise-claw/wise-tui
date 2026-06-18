import type { WorkflowGraphNode, WorkflowGraphNodeData } from "../types";
import type {
  WorkflowKnowledgeNodeKindFilter,
  WorkflowKnowledgeOutputMode,
  WorkflowKnowledgeRetrievalConfig,
  WorkflowKnowledgeSearchMode,
  WorkflowKnowledgeSubgraphDirection,
} from "../types/workflowKnowledge";
import { DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG } from "../types/workflowKnowledge";
import type { BranchEvaluationContext } from "./workflowBranchEvaluation";
import { substitutePromptContent } from "./workflowPromptTemplate";

const VALID_SEARCH_MODES = new Set<WorkflowKnowledgeSearchMode>(["keyword", "hybrid", "path_focus"]);
const VALID_OUTPUT_MODES = new Set<WorkflowKnowledgeOutputMode>(["summary", "structured", "verbatim"]);
const VALID_NODE_KINDS = new Set<WorkflowKnowledgeNodeKindFilter>(["file", "folder", "symbol", "api_operation", "schema"]);
const VALID_DIRECTIONS = new Set<WorkflowKnowledgeSubgraphDirection>(["both", "upstream", "downstream"]);

export const WORKFLOW_KNOWLEDGE_BUILTIN_VARIABLES = [
  { name: "task_content", label: "任务正文（开始输入）" },
  { name: "last_output", label: "上阶段输出" },
  { name: "acceptance", label: "验收结论" },
] as const;

export const WORKFLOW_KNOWLEDGE_SEARCH_MODE_OPTIONS: { value: WorkflowKnowledgeSearchMode; label: string; hint: string }[] = [
  { value: "hybrid", label: "混合检索", hint: "关键词 + 同义词扩展，适合自然语言问题" },
  { value: "keyword", label: "关键词", hint: "精确匹配节点 label / path" },
  { value: "path_focus", label: "路径聚焦", hint: "优先在指定路径前缀下检索" },
];

export const WORKFLOW_KNOWLEDGE_NODE_KIND_OPTIONS: { value: WorkflowKnowledgeNodeKindFilter; label: string }[] = [
  { value: "symbol", label: "符号（函数/类/变量）" },
  { value: "file", label: "文件" },
  { value: "folder", label: "目录" },
  { value: "api_operation", label: "API 操作" },
  { value: "schema", label: "Schema" },
];

export const WORKFLOW_KNOWLEDGE_OUTPUT_MODE_OPTIONS: { value: WorkflowKnowledgeOutputMode; label: string }[] = [
  { value: "structured", label: "结构化摘要（推荐）" },
  { value: "summary", label: "简要概述" },
  { value: "verbatim", label: "保留原文片段" },
];

function searchModeLabel(mode: WorkflowKnowledgeSearchMode): string {
  return WORKFLOW_KNOWLEDGE_SEARCH_MODE_OPTIONS.find((item) => item.value === mode)?.label ?? mode;
}

function outputModeLabel(mode: WorkflowKnowledgeOutputMode): string {
  return WORKFLOW_KNOWLEDGE_OUTPUT_MODE_OPTIONS.find((item) => item.value === mode)?.label ?? mode;
}

function nodeKindLabels(kinds: WorkflowKnowledgeNodeKindFilter[]): string {
  if (kinds.length === 0) return "全部类型";
  return kinds
    .map((kind) => WORKFLOW_KNOWLEDGE_NODE_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? kind)
    .join("、");
}

function directionLabel(direction: WorkflowKnowledgeSubgraphDirection): string {
  if (direction === "upstream") return "上卷（调用方/依赖）";
  if (direction === "downstream") return "下钻（被调用/引用）";
  return "双向扩展";
}

function normalizeNodeKinds(raw: unknown): WorkflowKnowledgeNodeKindFilter[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.nodeKinds];
  const out = raw
    .filter((item): item is WorkflowKnowledgeNodeKindFilter => typeof item === "string" && VALID_NODE_KINDS.has(item as WorkflowKnowledgeNodeKindFilter))
    .filter((item, index, arr) => arr.indexOf(item) === index);
  return out.length > 0 ? out : [...DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.nodeKinds];
}

function normalizeSupplementQueries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function clampTopK(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.topK;
  return Math.min(200, Math.max(1, Math.floor(value)));
}

function clampSubgraphHop(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.subgraphHop;
  return Math.min(10, Math.max(0, Math.floor(value)));
}

export function knowledgeConfigFromNodeData(data: WorkflowGraphNodeData): WorkflowKnowledgeRetrievalConfig {
  const legacyQuery = typeof data.knowledgeQuery === "string" ? data.knowledgeQuery.trim() : "";
  const hasExtended =
    data.knowledgeSearchMode != null ||
    Array.isArray(data.knowledgeNodeKinds) ||
    data.knowledgeTopK != null ||
    typeof data.knowledgePathPrefix === "string" ||
    Array.isArray(data.knowledgeSupplementQueries);

  if (!hasExtended && legacyQuery) {
    return {
      ...DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG,
      query: legacyQuery,
    };
  }

  const query =
    typeof data.knowledgeQuery === "string" && data.knowledgeQuery.trim()
      ? data.knowledgeQuery
      : legacyQuery || DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.query;
  const searchMode =
    typeof data.knowledgeSearchMode === "string" && VALID_SEARCH_MODES.has(data.knowledgeSearchMode as WorkflowKnowledgeSearchMode)
      ? (data.knowledgeSearchMode as WorkflowKnowledgeSearchMode)
      : DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.searchMode;
  const outputMode =
    typeof data.knowledgeOutputMode === "string" && VALID_OUTPUT_MODES.has(data.knowledgeOutputMode as WorkflowKnowledgeOutputMode)
      ? (data.knowledgeOutputMode as WorkflowKnowledgeOutputMode)
      : DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.outputMode;
  const subgraphDirection =
    typeof data.knowledgeSubgraphDirection === "string" &&
    VALID_DIRECTIONS.has(data.knowledgeSubgraphDirection as WorkflowKnowledgeSubgraphDirection)
      ? (data.knowledgeSubgraphDirection as WorkflowKnowledgeSubgraphDirection)
      : DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.subgraphDirection;
  const pathPrefix = typeof data.knowledgePathPrefix === "string" ? data.knowledgePathPrefix.trim() : undefined;
  const outputVariable =
    typeof data.knowledgeOutputVariable === "string" ? data.knowledgeOutputVariable.trim() : undefined;

  return {
    query,
    searchMode,
    nodeKinds: normalizeNodeKinds(data.knowledgeNodeKinds),
    topK: clampTopK(data.knowledgeTopK),
    subgraphHop: clampSubgraphHop(data.knowledgeSubgraphHop),
    subgraphDirection,
    outputMode,
    requireCitation:
      typeof data.knowledgeRequireCitation === "boolean"
        ? data.knowledgeRequireCitation
        : DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.requireCitation,
    supplementQueries: normalizeSupplementQueries(data.knowledgeSupplementQueries),
    ...(pathPrefix ? { pathPrefix } : {}),
    ...(outputVariable ? { outputVariable } : {}),
  };
}

export function serializeKnowledgeConfigToNodeData(
  config: WorkflowKnowledgeRetrievalConfig,
): Pick<
  WorkflowGraphNodeData,
  | "knowledgeQuery"
  | "knowledgeSearchMode"
  | "knowledgeNodeKinds"
  | "knowledgeTopK"
  | "knowledgeSubgraphHop"
  | "knowledgeSubgraphDirection"
  | "knowledgePathPrefix"
  | "knowledgeOutputMode"
  | "knowledgeRequireCitation"
  | "knowledgeOutputVariable"
  | "knowledgeSupplementQueries"
> {
  const pathPrefix = config.pathPrefix?.trim();
  const outputVariable = config.outputVariable?.trim();
  return {
    knowledgeQuery: config.query.trim(),
    knowledgeSearchMode: config.searchMode,
    knowledgeNodeKinds: config.nodeKinds,
    knowledgeTopK: config.topK,
    knowledgeSubgraphHop: config.subgraphHop,
    knowledgeSubgraphDirection: config.subgraphDirection,
    knowledgeOutputMode: config.outputMode,
    knowledgeRequireCitation: config.requireCitation,
    knowledgeSupplementQueries: config.supplementQueries,
    ...(pathPrefix ? { knowledgePathPrefix: pathPrefix } : {}),
    ...(outputVariable ? { knowledgeOutputVariable: outputVariable } : {}),
  };
}

function substituteQueryList(queries: string[], ctx: BranchEvaluationContext): string[] {
  return queries.map((item) => substitutePromptContent(item, ctx).trim()).filter(Boolean);
}

export function renderKnowledgeRetrievalBlock(config: WorkflowKnowledgeRetrievalConfig, ctx: BranchEvaluationContext): string {
  const mainQuery = substitutePromptContent(config.query, ctx).trim();
  const supplements = substituteQueryList(config.supplementQueries, ctx);
  if (!mainQuery && supplements.length === 0) return "";

  const lines = ["【知识检索 · 代码库上下文】"];

  lines.push(
    "",
    "请在当前工作区仓库中检索相关代码、符号与依赖关系，并将结果用于后续任务。",
    "可使用 Codegraph MCP、代码搜索工具或等价方式定位文件、符号与调用关系。",
  );

  lines.push("", "### 检索策略");
  lines.push(`- 模式：${searchModeLabel(config.searchMode)}`);
  lines.push(`- 节点类型：${nodeKindLabels(config.nodeKinds)}`);
  lines.push(`- Top K：${config.topK}`);
  if (config.pathPrefix?.trim()) {
    lines.push(`- 路径前缀：${config.pathPrefix.trim()}`);
  }
  if (config.subgraphHop > 0) {
    lines.push(`- 子图扩展：hop ${config.subgraphHop} · ${directionLabel(config.subgraphDirection)}`);
  } else {
    lines.push("- 子图扩展：不扩展（仅种子节点）");
  }

  lines.push("", "### 检索语句");
  if (mainQuery) {
    lines.push(`- 主查询：${mainQuery}`);
  }
  supplements.forEach((item, index) => {
    lines.push(`- 补充 ${index + 1}：${item}`);
  });

  lines.push("", "### 输出要求");
  lines.push(`- 格式：${outputModeLabel(config.outputMode)}`);
  if (config.requireCitation) {
    lines.push("- 必须引用：`仓库相对路径` + 符号名（如有）+ 行号范围（如已知）");
  }
  if (config.outputVariable?.trim()) {
    lines.push(`- 将检索结论写入变量 \`${config.outputVariable.trim()}\`，供下游节点引用`);
  }

  if (config.outputMode === "structured") {
    lines.push(
      "",
      "请用以下结构组织检索结果：",
      "1. **相关文件/符号**（列表，含路径）",
      "2. **关键关系**（调用链、依赖、API 关联）",
      "3. **与当前任务的关联说明**",
    );
  } else if (config.outputMode === "verbatim") {
    lines.push("", "请保留与检索意图最相关的源码片段（适当截断），并标注出处。");
  } else {
    lines.push("", "请用 3～8 句话概括检索结论，避免堆砌无关文件。");
  }

  return lines.join("\n").trim();
}

export function formatKnowledgePassthroughBlockFromNode(node: WorkflowGraphNode, ctx: BranchEvaluationContext): string {
  const config = knowledgeConfigFromNodeData(node.data);
  const label = (node.data.label || node.id).trim() || node.id;
  const body = renderKnowledgeRetrievalBlock(config, ctx);
  if (!body) {
    return [`【知识检索】`, `节点「${label}」：未配置检索语句。`].join("\n");
  }
  return [`节点「${label}」`, "", body].join("\n");
}

export function previewKnowledgeConfig(config: WorkflowKnowledgeRetrievalConfig, ctx: BranchEvaluationContext): string {
  return renderKnowledgeRetrievalBlock(config, ctx) || "（未配置检索语句）";
}

export function summarizeKnowledgeConfig(config: WorkflowKnowledgeRetrievalConfig): string {
  const query = config.query.trim();
  if (!query) return "未配置检索";
  const preview = query.length > 32 ? `${query.slice(0, 32)}…` : query;
  const mode = searchModeLabel(config.searchMode);
  return `${mode} · Top ${config.topK} · ${preview}`;
}
