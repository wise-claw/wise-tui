import type { TaskItem, TaskSplitContext } from "../types";

function isApiProtocolTask(task: TaskItem): boolean {
  return task.title.includes("接口协议");
}

function apiSpecIssues(task: TaskItem): string[] {
  const issues: string[] = [];
  if (!task.apiSpec) {
    issues.push("本任务为接口协议类任务，但缺少结构化接口定义（路径/方法/请求/响应/错误码）。");
    return issues;
  }
  if (!task.apiSpec.endpoint.trim()) issues.push("接口路径为空。");
  if (!task.apiSpec.requestSchema.trim()) issues.push("请求定义为空。");
  if (!task.apiSpec.responseSchema.trim()) issues.push("响应定义为空。");
  if (task.apiSpec.errorCodes.length === 0) issues.push("错误码未填写。");
  return issues;
}

function dependencyIssues(task: TaskItem, byId: Map<string, TaskItem>): string[] {
  const issues: string[] = [];
  for (const depId of task.dependencies) {
    const dep = byId.get(depId);
    if (!dep) {
      issues.push(`前置依赖「${depId}」在可执行任务中不存在，请修正依赖或补全任务。`);
      continue;
    }
    if (isApiProtocolTask(dep)) {
      const apiIssues = apiSpecIssues(dep);
      if (apiIssues.length > 0) {
        issues.push(`前置任务 ${depId}（接口协议）尚未就绪：${apiIssues.join("")}`);
      }
    }
    if ((dep.dod ?? []).length === 0) {
      issues.push(`前置任务 ${depId} 缺少 DoD，可能影响本任务启动条件。`);
    }
  }
  return issues;
}

/** 整条拆分结果共用的上下文/方案级缺口（只展示一次，写入 `SplitResult.unmetPreconditions`）。 */
export function collectSplitContextGapLines(context: TaskSplitContext | null, tasks: TaskItem[]): string[] {
  const lines: string[] = [];
  const hasFrontend = tasks.some((t) => t.role === "frontend");
  const hasBackend = tasks.some((t) => t.role === "backend");
  const hasDocument = tasks.some((t) => t.role === "document");
  const hasApiTask = tasks.some((t) => t.title.includes("接口协议"));

  if (!context) {
    lines.push("未关联项目/仓库上下文，无法确认任务归属范围。");
    return lines;
  }
  if (context.mode === "project") {
    if (!context.projectId) lines.push("项目级拆分缺少关联项目。");
    if (!context.repositoryId) lines.push("项目级拆分缺少关联仓库。");
    if (!hasFrontend) lines.push("项目级拆分缺少前端任务。");
    if (!hasBackend) lines.push("项目级拆分缺少后端任务。");
    if (!hasApiTask) lines.push("项目级拆分缺少接口协议任务。");
  } else if (context.mode === "repository") {
    if (!context.repositoryId) lines.push("仓库级拆分缺少关联仓库。");
    if (!context.repositoryType) {
      lines.push("仓库级拆分缺少仓库类型（前端/后端/文档）。");
    } else if (context.repositoryType === "frontend" && hasBackend) {
      lines.push("当前为前端仓库，不应包含后端任务。");
    } else if (context.repositoryType === "backend" && hasFrontend) {
      lines.push("当前为后端仓库，不应包含前端任务。");
    } else if (context.repositoryType === "document" && (hasFrontend || hasBackend)) {
      lines.push("当前为文档仓库，拆分任务应使用文档类角色，不应混入前端/后端实现任务。");
    } else if (context.repositoryType === "document" && !hasDocument && tasks.length > 0) {
      lines.push("当前为文档仓库，建议任务角色统一为 document（PRD/用例/UI 等交付物）。");
    }
  }
  return lines;
}

/**
 * 与单条任务直接相关的「不满足的前置条件 / 实现缺口」，用于任务卡片红框与可执行性自动判断。
 */
export function computeTaskUnmetPoints(task: TaskItem, context: TaskSplitContext | null, allTasks: TaskItem[]): string[] {
  const points: string[] = [];
  const byId = new Map(allTasks.map((t) => [t.id, t]));

  if (context?.mode === "repository" && context.repositoryType) {
    if (context.repositoryType === "frontend" && task.role === "backend") {
      points.push("当前为前端仓库，本任务角色为后端，与仓库类型不一致。");
    } else if (context.repositoryType === "backend" && task.role === "frontend") {
      points.push("当前为后端仓库，本任务角色为前端，与仓库类型不一致。");
    } else if (
      context.repositoryType === "document"
      && (task.role === "frontend" || task.role === "backend")
    ) {
      points.push("当前为文档仓库，本任务角色为前端/后端实现，与仓库类型不一致。");
    }
  }

  if (!task.title.trim()) {
    points.push("任务标题为空。");
  }

  if ((task.sourceRequirementIds ?? []).length === 0) {
    points.push("未关联 PRD 需求条目（sourceRequirementIds），难以追溯验收范围。");
  }

  if ((task.dod ?? []).length === 0) {
    points.push("缺少 DoD（验收标准）。");
  }

  points.push(...dependencyIssues(task, byId));

  if (isApiProtocolTask(task)) {
    points.push(...apiSpecIssues(task));
  }

  return Array.from(new Set(points));
}
