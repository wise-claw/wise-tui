import type { SplitResult, TaskItem } from "../types";

function taskToMarkdown(task: TaskItem): string {
  const deps = task.dependencies.length > 0 ? task.dependencies.join(", ") : "无";
  const subtasks = task.subtasks.map((item) => `  - [ ] ${item}`).join("\n");
  const dod = task.dod.map((item) => `  - [ ] ${item}`).join("\n");

  return [
    `### ${task.id} ${task.title}`,
    "",
    `- 角色：${task.role === "frontend" ? "前端" : task.role === "backend" ? "后端" : "文档"}`,
    `- 大小：\`${task.size}\``,
    `- 预估：${task.estimateDays} 人天`,
    `- 前置依赖：${deps}`,
    ...(task.apiSpec
      ? [
        `- 接口路径：${task.apiSpec.endpoint}`,
        `- 请求方法：${task.apiSpec.method}`,
        `- 请求定义：${task.apiSpec.requestSchema}`,
        `- 响应定义：${task.apiSpec.responseSchema}`,
        `- 错误码：${task.apiSpec.errorCodes.join(", ") || "无"}`,
      ]
      : []),
    `- 需求来源：${task.sourceRefs.join(", ")}`,
    "- 子任务：",
    subtasks || "  - [ ] 无",
    "- DoD：",
    dod || "  - [ ] 无",
    "",
  ].join("\n");
}

export function exportSplitResultMarkdown(result: SplitResult): string {
  const contextLines = result.context
    ? [
        `- 关联模式：${result.context.mode}`,
        `- 关联项目：${result.context.projectName ?? "无"}`,
        `- 关联仓库：${result.context.repositoryName ?? "无"}`,
        `- 仓库路径：${result.context.repositoryPath ?? "无"}`,
      ]
    : ["- 关联模式：manual", "- 关联项目：无", "- 关联仓库：无", "- 仓库路径：无"];

  const header = [
    "# PRD 任务拆分结果",
    "",
    `- 标题：${result.source.title}`,
    `- 来源类型：${result.source.sourceType}`,
    ...contextLines,
    `- 关键路径：${result.criticalPath.join(" -> ") || "无"}`,
    "",
    "## 可并行任务组",
    ...result.parallelGroups.map((group, index) => `- 组 ${index + 1}: ${group.join(", ")}`),
    "",
    "## 任务明细",
    "",
  ].join("\n");

  const body = result.splitTasks.map(taskToMarkdown).join("\n");
  const checklist = [
    "",
    "## 开发完成确认",
    "- [ ] 功能开发完成并自测通过",
    "- [ ] 关键路径联调通过",
    "- [ ] 异常分支验证通过",
    "- [ ] 回归检查通过",
    "",
    "## 上线前确认",
    "- [ ] 发布说明已更新",
    "- [ ] 风险与依赖已确认",
    "- [ ] 回滚预案已准备",
    "- [ ] 验收结论已同步",
    "",
  ].join("\n");
  return `${header}${body}${checklist}`;
}
