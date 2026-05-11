import { Modal } from "antd";
import type { SplitResult } from "../types";
import { exportSplitResultMarkdown } from "../services/taskExport";
import { validateSplitResult } from "../services/taskSplitValidator";

/** 与 `App.useApp().message` 兼容的最小接口，避免绑定具体 antd 类型路径。 */
export interface RubricToastApi {
  error: (content: string) => void;
  success: (content: string) => void;
  info: (content: string) => void;
  warning: (content: string) => void;
}

export function summarizeIssueMessages(messages: { message: string }[], max = 5): string {
  return messages.map((e) => e.message).slice(0, max).join("；");
}

function buildRubricWarningBulletText(messages: { message: string }[], max = 12): string {
  return messages
    .slice(0, max)
    .map((w) => `· ${w.message}`)
    .join("\n");
}

async function confirmByRubricWarnings(title: string, okText: string, warnings: { message: string }[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let confirmed = false;
    Modal.confirm({
      title,
      content: buildRubricWarningBulletText(warnings),
      okText,
      cancelText: "取消",
      width: 520,
      onOk: () => {
        confirmed = true;
      },
      afterClose: () => resolve(confirmed),
    });
  });
}

export interface RubricActionGateOptions {
  actionLabel: string;
  warningConfirmTitle: string;
  warningConfirmOkText: string;
}

/**
 * 按 Rubric 为某个动作做门禁：
 * - error：直接阻断，并 toast 提示；
 * - warning：二次确认；
 * - clean：直接放行。
 */
export async function guardActionBySplitRubric(
  next: SplitResult,
  toast: RubricToastApi,
  options: RubricActionGateOptions,
): Promise<boolean> {
  const rubric = validateSplitResult(next);
  const hardErrors = rubric.hardErrors ?? rubric.errors ?? [];
  const softWarnings = rubric.softWarnings ?? rubric.warnings ?? [];
  if (hardErrors.length > 0) {
    toast.error(`无法${options.actionLabel}：${summarizeIssueMessages(hardErrors)}`);
    return false;
  }
  if (softWarnings.length > 0) {
    return confirmByRubricWarnings(options.warningConfirmTitle, options.warningConfirmOkText, softWarnings);
  }
  return true;
}

/** 拆分已写入后提示 Rubric：错误用 warning，仅警告用 info（不阻断）。 */
export function notifySplitResultRubricAfterCommit(next: SplitResult, toast: RubricToastApi): void {
  const rubric = validateSplitResult(next);
  const hardErrors = rubric.hardErrors ?? rubric.errors ?? [];
  const softWarnings = rubric.softWarnings ?? rubric.warnings ?? [];
  if (hardErrors.length > 0) {
    toast.warning(
      `拆分已保存，但存在结构问题（${hardErrors.length} 条），请在右侧校验区或任务依赖中修正：${hardErrors
        .map((e) => e.message)
        .slice(0, 2)
        .join("；")}`,
    );
    return;
  }
  if (softWarnings.length > 0) {
    toast.info(
      `拆分已保存。另有 ${softWarnings.length} 条可改进项（如未覆盖需求、L 级任务等），详见右侧校验提示。`,
    );
  }
}

/** 将校验项按统一风格提示到 toast。 */
export function notifyValidationIssues(
  toast: RubricToastApi,
  level: "error" | "warning",
  prefix: string,
  issues: { message: string }[],
  max = 4,
): void {
  if (issues.length === 0) return;
  const text = `${prefix}：${summarizeIssueMessages(issues, max)}`;
  if (level === "error") toast.error(text);
  else toast.warning(text);
}

/** 校验后复制拆分 Markdown；存在 error 时拒绝复制；存在 warning 时二次确认。 */
export async function copySplitMarkdownWithRubricGate(next: SplitResult, toast: RubricToastApi): Promise<void> {
  const passed = await guardActionBySplitRubric(next, toast, {
    actionLabel: "导出",
    warningConfirmTitle: "拆分结果存在可改进项，仍要导出到剪贴板吗？",
    warningConfirmOkText: "仍要复制",
  });
  if (!passed) return;
  const markdown = exportSplitResultMarkdown(next);
  try {
    await navigator.clipboard.writeText(markdown);
    toast.success("已复制 Markdown 到剪贴板");
  } catch {
    toast.error("复制失败，请重试。");
  }
}
