import type { CodeReviewDiffPayload } from "../../types/codeReview";
import { CODE_REVIEW_PROMPT_SIGNATURE } from "../../utils/codeReviewPromptSession";
import type { CodeReviewFileSetDelta } from "./diffFileSetDelta";

export type BuildCodeReviewPromptOptions = {
  incremental?: CodeReviewFileSetDelta | null;
  previousSummary?: string | null;
  /** When DIFF is filtered, list the full change-set for context. */
  fullFilePaths?: readonly string[] | null;
};

export function buildCodeReviewPrompt(
  diff: CodeReviewDiffPayload,
  options?: BuildCodeReviewPromptOptions,
): string {
  const fileList =
    diff.filePaths.length > 0
      ? diff.filePaths
          .slice(0, 80)
          .map((path) => `- ${path}`)
          .join("\n")
      : "- (none)";

  const incremental = options?.incremental;
  const incrementalLines: string[] = [];
  if (incremental) {
    incrementalLines.push("相对上次审查（增量提示）:");
    if (options?.previousSummary?.trim()) {
      incrementalLines.push(`上次结论: ${options.previousSummary.trim()}`);
    }
    if (incremental.filteredToFocus && (incremental.focusFiles?.length ?? 0) > 0) {
      incrementalLines.push(
        `本次仅提供以下变更文件的 DIFF（未变文件的旧 finding 将由系统沿用）:\n${(
          incremental.focusFiles ?? []
        )
          .slice(0, 40)
          .map((path) => `- ${path}`)
          .join("\n")}`,
      );
    }
    if (incremental.added.length > 0) {
      incrementalLines.push(
        `新增文件（优先）:\n${incremental.added
          .slice(0, 40)
          .map((path) => `- ${path}`)
          .join("\n")}`,
      );
    }
    if (incremental.removed.length > 0) {
      incrementalLines.push(
        `已不在变更中:\n${incremental.removed
          .slice(0, 40)
          .map((path) => `- ${path}`)
          .join("\n")}`,
      );
    }
    if (
      !incremental.filteredToFocus &&
      incremental.added.length === 0 &&
      incremental.removed.length === 0
    ) {
      incrementalLines.push("文件集与上次相同，但 patch 内容已变化；请关注实质逻辑改动。");
    }
    incrementalLines.push(
      "请重点审查新增与确有改动的文件；避免对稳定文件重复低价值噪音。",
    );
  }

  const fullList =
    options?.fullFilePaths && options.fullFilePaths.length > 0
      ? options.fullFilePaths
          .slice(0, 80)
          .map((path) => `- ${path}`)
          .join("\n")
      : "";

  return [
    `${CODE_REVIEW_PROMPT_SIGNATURE}（对标 Cursor Bugbot 的本地审查体验）。`,
    "只审查给定 diff 中的真实缺陷、安全与正确性问题；忽略纯格式/命名偏好。",
    "高召回发现后自行做一轮验证，去掉不确定或无影响的噪音。",
    "",
    "输出要求：",
    "1. 只输出一个 JSON 对象，不要 Markdown 说明，不要代码围栏。",
    "2. JSON schema:",
    '{',
    '  "recommendation": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",',
    '  "summary": "一句话结论",',
    '  "findings": [',
    '    {',
    '      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",',
    '      "confidence": "HIGH" | "MEDIUM" | "LOW",',
    '      "path": "relative/path",',
    '      "line": 123,',
    '      "title": "短标题",',
    '      "detail": "为什么是问题",',
    '      "fix": "具体修复建议"',
    '    }',
    '  ],',
    '  "openQuestions": ["低置信度疑点"]',
    '}',
    "3. CRITICAL/HIGH 仅用于真实缺陷或安全风险；line 用新文件侧行号，未知则 null。",
    "4. 若无问题：findings=[]，recommendation=APPROVE。",
    "",
    `仓库: ${diff.repositoryPath}`,
    `范围: ${diff.scope}`,
    `分支: ${diff.branch ?? "unknown"}`,
    `base: ${diff.baseRef ?? "n/a"}`,
    diff.truncated ? "注意: diff 已截断，仅基于可见部分审查。" : "",
    "",
    ...incrementalLines,
    incrementalLines.length > 0 ? "" : null,
    fullList ? "完整变更文件集:" : null,
    fullList || null,
    fullList ? "" : null,
    incremental?.filteredToFocus ? "本次审查文件:" : "变更文件:",
    fileList,
    "",
    "DIFF:",
    diff.diffText.trim() || "(empty)",
  ]
    .filter((line): line is string => line != null && line !== "")
    .join("\n");
}

export function buildCodeReviewFixPrompt(input: {
  repositoryPath: string;
  finding: {
    path: string;
    line: number | null;
    title: string;
    detail: string;
    fix: string;
    severity: string;
  };
}): string {
  const loc =
    input.finding.line != null ? `${input.finding.path}:${input.finding.line}` : input.finding.path;
  return [
    "请修复以下代码审查发现的问题。只改必要代码，完成后简要说明改动。",
    "",
    `仓库: ${input.repositoryPath}`,
    `位置: ${loc}`,
    `严重度: ${input.finding.severity}`,
    `标题: ${input.finding.title}`,
    `说明: ${input.finding.detail}`,
    input.finding.fix ? `建议修复: ${input.finding.fix}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
