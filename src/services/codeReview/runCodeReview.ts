import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import type { CodeReviewDiffPayload, CodeReviewRun, CodeReviewScope } from "../../types/codeReview";
import { getClaudeConfigModel } from "../claude";
import { executeSessionEngineAndWait } from "../sessionEngineInvocation";
import { extractClaudeInvocationFinalText } from "../../utils/claudeInvocationText";
import { buildCodeReviewPrompt } from "./buildCodeReviewPrompt";
import { loadCodeReviewSettings } from "./codeReviewSettings";
import { collectCodeReviewDiff, listCodeReviewRuns, saveCodeReviewRun } from "./codeReviewIpc";
import {
  diffCodeReviewFileSets,
  inferCodeReviewRunFilePaths,
  type CodeReviewFileSetDelta,
} from "./diffFileSetDelta";
import { fingerprintCodeReviewDiff } from "./diffFingerprint";
import { mergeCarriedCodeReviewFindings } from "./mergeIncrementalFindings";
import { parseCodeReviewResult } from "./parseCodeReviewResult";
import {
  filterUnifiedDiffToFiles,
  fingerprintUnifiedDiffFiles,
  resolveIncrementalFocusFiles,
} from "./splitUnifiedDiff";

export type RunCodeReviewInput = {
  repositoryPath: string;
  scope: CodeReviewScope;
  baseRef?: string | null;
  executionEngine?: SessionExecutionEngine | null;
  timeoutMs?: number;
  onInvocationKey?: (invocationKey: string) => void;
  persist?: boolean;
  /** Force a fresh engine pass even when fingerprint matches. */
  force?: boolean;
};

export type RunCodeReviewResult =
  | {
      ok: true;
      run: CodeReviewRun;
      truncated: boolean;
      reused: boolean;
      incremental: CodeReviewFileSetDelta | null;
    }
  | { ok: false; error: string; empty?: boolean };

export async function runCodeReview(input: RunCodeReviewInput): Promise<RunCodeReviewResult> {
  const repositoryPath = input.repositoryPath.trim();
  if (!repositoryPath) {
    return { ok: false, error: "缺少仓库路径" };
  }

  let diff: CodeReviewDiffPayload;
  try {
    diff = await collectCodeReviewDiff({
      repositoryPath,
      scope: input.scope,
      baseRef: input.baseRef,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (diff.empty) {
    return { ok: false, error: "没有可审查的变更", empty: true };
  }

  const fingerprint = fingerprintCodeReviewDiff({
    scope: String(diff.scope),
    baseRef: diff.baseRef,
    filePaths: diff.filePaths,
    diffText: diff.diffText,
  });
  const fileFingerprints = fingerprintUnifiedDiffFiles(diff.diffText);

  let recent: CodeReviewRun[] = [];
  try {
    recent = await listCodeReviewRuns(repositoryPath, 30);
  } catch {
    recent = [];
  }

  const settings = await loadCodeReviewSettings();
  if (!input.force && settings.reuseIdenticalDiff) {
    const hit = recent.find(
      (run) =>
        run.diffFingerprint === fingerprint && String(run.scope) === String(diff.scope),
    );
    if (hit) {
      return { ok: true, run: hit, truncated: diff.truncated, reused: true, incremental: null };
    }
  }

  const previousSameScope = recent.find((run) => String(run.scope) === String(diff.scope));
  let incremental: CodeReviewFileSetDelta | null =
    previousSameScope && previousSameScope.diffFingerprint !== fingerprint
      ? diffCodeReviewFileSets(
          inferCodeReviewRunFilePaths(previousSameScope),
          diff.filePaths,
          { patchChanged: true },
        )
      : null;

  let promptDiff = diff;
  let focusFiles: string[] = [];
  let unchangedFiles: string[] = [];
  let filteredToFocus = false;

  if (incremental && previousSameScope) {
    const focus = resolveIncrementalFocusFiles({
      currentFingerprints: fileFingerprints,
      previousFingerprints: previousSameScope.fileFingerprints ?? null,
      currentPaths: diff.filePaths,
    });
    focusFiles = focus.focusFiles;
    unchangedFiles = focus.unchangedFiles;
    incremental = {
      ...incremental,
      focusFiles,
      unchangedFiles,
    };

    if (
      focusFiles.length > 0 &&
      focusFiles.length < diff.filePaths.length &&
      Object.keys(previousSameScope.fileFingerprints ?? {}).length > 0
    ) {
      const filteredText = filterUnifiedDiffToFiles(diff.diffText, focusFiles);
      if (filteredText.trim()) {
        filteredToFocus = true;
        promptDiff = {
          ...diff,
          filePaths: focusFiles,
          diffText: filteredText,
        };
        incremental = {
          ...incremental,
          filteredToFocus: true,
        };
      }
    }
  }

  const engine = input.executionEngine ?? "claude";
  const model = engine === "claude" ? await getClaudeConfigModel(repositoryPath) : undefined;
  const prompt = buildCodeReviewPrompt(promptDiff, {
    incremental,
    previousSummary: previousSameScope?.summary ?? null,
    fullFilePaths: filteredToFocus ? diff.filePaths : null,
  });

  const invocation = await executeSessionEngineAndWait({
    executionEngine: engine,
    repositoryPath,
    prompt,
    model: model ?? undefined,
    timeoutMs: input.timeoutMs ?? 180_000,
    onInvocationKey: input.onInvocationKey,
  });

  if (!invocation.success) {
    const errTail = invocation.errorLines.filter(Boolean).slice(-3).join(" · ");
    return {
      ok: false,
      error: errTail || "代码审查执行失败",
    };
  }

  const text = extractClaudeInvocationFinalText(invocation.outputLines);
  const parsed = parseCodeReviewResult(text);

  let findings = parsed.findings;
  let carriedFindingCount = 0;
  if (filteredToFocus && previousSameScope && unchangedFiles.length > 0) {
    const merged = mergeCarriedCodeReviewFindings({
      previousFindings: previousSameScope.findings,
      nextFindings: parsed.findings,
      unchangedFiles,
      currentFiles: diff.filePaths,
    });
    carriedFindingCount = Math.max(0, merged.length - parsed.findings.length);
    findings = merged;
    if (incremental) {
      incremental = {
        ...incremental,
        carriedFindingCount,
      };
    }
  }

  const summary =
    carriedFindingCount > 0
      ? `${parsed.summary || "增量审查完成"}（沿用 ${carriedFindingCount} 项未变文件发现）`
      : parsed.summary;

  const run: CodeReviewRun = {
    id: `cr-${Date.now()}`,
    repositoryPath,
    scope: diff.scope,
    baseRef: diff.baseRef,
    branch: diff.branch,
    createdAtMs: Date.now(),
    recommendation: parsed.recommendation,
    summary,
    findings,
    openQuestions: parsed.openQuestions,
    diffFingerprint: fingerprint,
    filePaths: [...diff.filePaths],
    fileFingerprints,
  };

  if (input.persist !== false) {
    try {
      const saved = await saveCodeReviewRun(run);
      return {
        ok: true,
        run: saved,
        truncated: diff.truncated,
        reused: false,
        incremental,
      };
    } catch {
      // Persistence is best-effort; still return the in-memory run.
    }
  }

  return { ok: true, run, truncated: diff.truncated, reused: false, incremental };
}
