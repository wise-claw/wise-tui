import type { TaskItem } from "../types";

function collapseWhitespaceOneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripTrailingClosureBrackets(s: string): string {
  return s.replace(/[）\)\]\}」]+\s*$/u, "").trim();
}

/**
 * 直连批量发给 Claude Code 的极简任务句：优先任务描述首段，否则标题；
 * 去掉「任务 N」式占位标题，并做轻微口语化压缩（如「增加一个」→「加一个」）。
 */
export function buildOmcBatchTaskIntentOneLiner(task: TaskItem): string {
  const rawDesc = task.description?.trim() ?? "";
  let line = "";
  if (rawDesc.length > 0) {
    const firstBlock = rawDesc.split(/\n\s*\n/)[0] ?? rawDesc;
    line = stripTrailingClosureBrackets(collapseWhitespaceOneLine(firstBlock.replace(/\n/g, " ")));
  }
  if (/^增加一个/u.test(line)) {
    line = line.replace(/^增加一个/u, "加一个");
  }
  if (line.length > 0) {
    return line.length > 500 ? `${line.slice(0, 500)}…` : line;
  }
  let title = (task.title ?? "").trim();
  if (/^任务\s*\d+$/i.test(title)) {
    title = "";
  }
  if (title.length > 0) {
    const t = title.length > 200 ? `${title.slice(0, 200)}…` : title;
    return stripTrailingClosureBrackets(t);
  }
  return "完成该任务";
}
