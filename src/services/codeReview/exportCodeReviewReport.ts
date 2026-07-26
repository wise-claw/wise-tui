import type { CodeReviewFinding, CodeReviewRun } from "../../types/codeReview";

function esc(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

export type CodeReviewExportFilter = "all" | "highOrCritical";

export type CodeReviewExportOptions = {
  filter?: CodeReviewExportFilter;
};

export function isHighOrCriticalFinding(finding: Pick<CodeReviewFinding, "severity">): boolean {
  const severity = String(finding.severity).toUpperCase();
  return severity === "HIGH" || severity === "CRITICAL";
}

export function filterCodeReviewFindingsForExport(
  findings: ReadonlyArray<CodeReviewFinding>,
  filter: CodeReviewExportFilter = "all",
): CodeReviewFinding[] {
  if (filter === "highOrCritical") {
    return findings.filter(isHighOrCriticalFinding);
  }
  return [...findings];
}

function resolveExportFindings(
  run: CodeReviewRun,
  options?: CodeReviewExportOptions,
): { findings: CodeReviewFinding[]; filter: CodeReviewExportFilter } {
  const filter = options?.filter ?? "all";
  return {
    filter,
    findings: filterCodeReviewFindingsForExport(run.findings, filter),
  };
}

export function buildCodeReviewMarkdownReport(
  run: CodeReviewRun,
  options?: CodeReviewExportOptions,
): string {
  const { findings, filter } = resolveExportFindings(run, options);
  const filterNote =
    filter === "highOrCritical" ? "（仅高危：HIGH / CRITICAL）" : "";
  const lines: string[] = [
    `# 代码审查报告`,
    "",
    `- 仓库: \`${run.repositoryPath}\``,
    `- 范围: ${run.scope === "branch" ? "相对主干" : "未提交"}`,
    `- 分支: ${run.branch ?? "unknown"}`,
    `- 时间: ${new Date(run.createdAtMs).toISOString()}`,
    `- 结论: **${run.recommendation}**`,
    `- 摘要: ${esc(run.summary) || "（无）"}`,
    "",
    `## Findings${filterNote}（${findings.length}${filter === "highOrCritical" ? ` / 共 ${run.findings.length}` : ""}）`,
    "",
  ];

  if (findings.length === 0) {
    lines.push(
      filter === "highOrCritical" ? "无高危发现问题。" : "无发现问题。",
      "",
    );
  } else {
    findings.forEach((finding, index) => {
      const loc =
        finding.line != null ? `${finding.path}:${finding.line}` : finding.path || "unknown";
      lines.push(
        `### ${index + 1}. [${finding.severity}/${finding.confidence}] ${esc(finding.title)}`,
        "",
        `- 位置: \`${loc}\``,
      );
      if (finding.detail) lines.push(`- 说明: ${esc(finding.detail)}`);
      if (finding.fix) lines.push(`- 修复建议: ${esc(finding.fix)}`);
      lines.push("");
    });
  }

  if (run.openQuestions?.length && filter !== "highOrCritical") {
    lines.push("## 待确认", "");
    for (const question of run.openQuestions) {
      lines.push(`- ${esc(question)}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildCodeReviewJsonReport(
  run: CodeReviewRun,
  options?: CodeReviewExportOptions,
): string {
  const { findings, filter } = resolveExportFindings(run, options);
  return `${JSON.stringify(
    {
      id: run.id,
      repositoryPath: run.repositoryPath,
      scope: run.scope,
      baseRef: run.baseRef,
      branch: run.branch,
      createdAtMs: run.createdAtMs,
      recommendation: run.recommendation,
      summary: run.summary,
      exportFilter: filter,
      findings,
      openQuestions: filter === "highOrCritical" ? [] : run.openQuestions,
      diffFingerprint: run.diffFingerprint ?? null,
      filePaths: run.filePaths ?? [],
    },
    null,
    2,
  )}\n`;
}

export function codeReviewReportBasename(
  run: CodeReviewRun,
  ext: "md" | "json",
  options?: CodeReviewExportOptions,
): string {
  const stamp = new Date(run.createdAtMs || Date.now())
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const branch = (run.branch || "review").replace(/[^\w.-]+/g, "_").slice(0, 40);
  const filterSuffix = options?.filter === "highOrCritical" ? "-high" : "";
  return `wise-code-review-${branch}${filterSuffix}-${stamp}.${ext}`;
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("当前环境不支持剪贴板写入");
}

export function downloadTextFile(filename: string, text: string, mime: string): void {
  if (typeof document === "undefined") {
    throw new Error("当前环境不支持下载");
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
