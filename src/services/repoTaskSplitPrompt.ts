import type { PrdDocument, SplitResult, TaskSplitContext } from "../types";

const EMPTY_PRD_SOURCE: PrdDocument = {
  title: "",
  sourceType: "markdown",
  sourceRef: null,
  background: [],
  goals: [],
  scenarios: [],
  functional: [],
  nonFunctional: [],
  acceptance: [],
};

/** 尚无拆分结果时，仅按当前关联上下文生成「仓库感知」提示词段落预览用的占位结果。 */
export function buildSyntheticSplitResultForRepoPrompt(context: TaskSplitContext | null): SplitResult {
  return {
    source: EMPTY_PRD_SOURCE,
    context,
    splitTasks: [],
    executableTasks: [],
    criticalPath: [],
    parallelGroups: [],
    unmetPreconditions: [],
  };
}

export type RepoType = "frontend" | "backend" | "document";

function normalizeRepoType(context: TaskSplitContext | null): RepoType | null {
  const type = context?.repositoryType;
  return type === "frontend" || type === "backend" || type === "document" ? type : null;
}

function buildRepoSpecificRules(repoType: RepoType | null): string[] {
  if (repoType === "frontend") {
    return [
      "前端拆分重点：页面/路由、组件、状态管理、接口对接、交互反馈、样式主题、埋点、测试。",
      "每个任务需标注影响目录（如 src/pages、src/components、src/services、src/hooks）。",
      "验收至少包含：UI/交互结果、异常分支与空态、构建与类型检查通过。",
      "涉及后端联动时，必须列出接口契约作为前置条件（字段、错误码、分页/过滤语义）。",
    ];
  }
  if (repoType === "backend") {
    return [
      "后端拆分重点：领域模型、API、Service、Repository、鉴权、日志监控、迁移脚本、测试。",
      "每个任务需标注影响模块边界（API/Service/Repository/DB Migration）。",
      "验收至少包含：API 契约与错误码、一致性要求（幂等/事务/并发，按需）、测试覆盖。",
      "存在外部依赖时，必须列出前置条件与 mock/降级方案。",
    ];
  }
  if (repoType === "document") {
    return [
      "文档仓库拆分重点：PRD 章节、用户故事/验收、测试用例（含边界与数据）、UI/交互说明、设计稿/资产索引、评审结论与变更记录。",
      "每个任务需标注落盘路径或目录约定（如 docs/prd、docs/testcases、design/）。",
      "验收至少包含：文档结构完整、可追溯需求 id、与实现仓库的同步方式（链接/引用/发布流程）。",
      "任务角色应使用 document；不要混入前端/后端代码实现类子任务，除非明确列为跨仓协作前置条件。",
    ];
  }
  return [
    "仓库类型未知：请先按通用规则拆分，并把仓库类型缺失写入 missing_prerequisites。",
  ];
}

function buildContextSummaryLines(result: SplitResult): string[] {
  const context = result.context;
  const taskCount = result.splitTasks.length;
  const frontendCount = result.splitTasks.filter((task) => task.role === "frontend").length;
  const backendCount = result.splitTasks.filter((task) => task.role === "backend").length;
  const documentCount = result.splitTasks.filter((task) => task.role === "document").length;
  const lines: string[] = [
    `repo_type: ${normalizeRepoType(context) ?? "unknown"}`,
    `context_mode: ${context?.mode ?? "manual"}`,
    `repository_name: ${context?.repositoryName ?? "unknown"}`,
    `repository_path: ${context?.repositoryPath ?? "unknown"}`,
    `project_name: ${context?.projectName ?? "unknown"}`,
    `split_policy: ${context?.splitPolicyId ?? "unknown"}`,
    `task_count: ${taskCount}`,
    `task_role_distribution: frontend=${frontendCount}, backend=${backendCount}, document=${documentCount}`,
    `critical_path_length: ${result.criticalPath.length}`,
  ];
  if (result.unmetPreconditions.length > 0) {
    lines.push(`existing_unmet_preconditions: ${result.unmetPreconditions.length}`);
  }
  return lines;
}

export function buildRepoAwarePromptSection(result: SplitResult): string {
  const repoType = normalizeRepoType(result.context);
  const lines = [
    "## 仓库类型与上下文（必须基于此拆分）",
    ...buildContextSummaryLines(result).map((line) => `- ${line}`),
    "",
    "## 拆分硬约束（必须遵守）",
    "- 每个任务必须原子化：单任务单目标，可独立交付。",
    "- 每个任务必须包含可测试验收标准与 test_plan。",
    "- 必须显式给出 depends_on，并保证整体依赖无环。",
    "- 必须判定可执行状态：边界清晰 + 验收可测试 + 上下文完整 => executable，且 missing_prerequisites 为空。",
    "- 不满足可执行条件时必须标记 not_executable（与 OUTPUT_SCHEMA 枚举一致），并列出非空的 missing_prerequisites。",
    "",
    "## 分仓拆分补充规则",
    ...buildRepoSpecificRules(repoType).map((line) => `- ${line}`),
    "",
    "## 输出结构要求",
    "- 优先在正文给出问题分析、修订建议、依赖与并行组调整。",
    "- split-mapping.json 仍按当前 schema 输出用于自动合并。",
    "- 如正文输出额外结构化任务建议，字段需覆盖：title、scope、depends_on、acceptance_criteria、test_plan、status、missing_prerequisites。",
  ];
  return lines.join("\n");
}

