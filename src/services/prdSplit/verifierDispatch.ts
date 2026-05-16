/**
 * Verifier dispatch — 第二轮 splitter 修复型子代理。
 *
 * 复用 `prd_split_dispatch_cluster` Tauri 命令（差异在 bundle 与 prompt 两处）：
 *   bundle 多 `previous-output.json` / `validation-issues.json`；
 *   prompt 切到 verifier 视角。
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  PrdDocument,
  SplitResult,
  TaskSplitContext,
} from "../../types";
import { buildSplitRequestPayload, type ClaudeInputBundleFiles } from "../buildSplitRequestPayload";
import {
  normalizeClaudeSplitOutputToSplitResult,
  validateClaudeSplitPayloadStrict,
  type ClaudeSplitStrictValidationIssue,
} from "../claudeSplitOutputNormalize";
import type { ClusterPlanItem } from "./clusterPlanner";
import type { DispatchClusterRawOutput } from "./splitterDispatch";
import type { RequirementsIndexV2 } from "./requirementsIndexVersion";

export interface DispatchVerifierInput {
  projectRootPath: string;
  parentTaskPath: string;
  cluster: ClusterPlanItem;
  prd: PrdDocument;
  requirementsIndex: RequirementsIndexV2;
  context: TaskSplitContext | null;
  /** 上一轮 splitter 的原始 JSON（应为对象；非对象时也允许，verifier 自己处理）。 */
  previousOutput: unknown;
  /** 校验 issue 列表（来自 validateClaudeSplitPayloadStrict）。 */
  validationIssues: ClaudeSplitStrictValidationIssue[];
  model?: string | null;
  timeoutMs?: number | null;
}

export interface DispatchVerifierResult {
  raw: DispatchClusterRawOutput;
  normalized: SplitResult | null;
  validationIssues: ClaudeSplitStrictValidationIssue[];
  errors: string[];
}

export async function dispatchClusterVerifier(input: DispatchVerifierInput): Promise<DispatchVerifierResult> {
  const errors: string[] = [];

  const payload = buildSplitRequestPayload({
    prd: input.prd,
    context: input.context,
  });
  if (!payload.ok) {
    return {
      raw: emptyRaw(),
      normalized: null,
      validationIssues: [],
      errors: [`bundle 装配失败: ${payload.reason}`],
    };
  }

  const bundle: Record<string, string> = {
    ...payload.bundle,
    "cluster.json": JSON.stringify({
      id: input.cluster.id,
      title: input.cluster.title,
      primaryRepositoryId: input.cluster.primaryRepositoryId,
      repositoryIds: input.cluster.repositoryIds,
      requirementIds: input.cluster.requirementIds,
      dependencyClusterIds: input.cluster.dependencyClusterIds,
    }, null, 2),
    "requirements-index.json": JSON.stringify(input.requirementsIndex, null, 2),
    "previous-output.json": JSON.stringify(input.previousOutput, null, 2),
    "validation-issues.json": JSON.stringify(input.validationIssues, null, 2),
  };

  const prompt = composeVerifierPrompt({
    parentTaskPath: input.parentTaskPath,
    cluster: input.cluster,
    issueCount: input.validationIssues.length,
    bundleFileNames: Object.keys(bundle),
    bundle,
  });

  let raw: DispatchClusterRawOutput;
  try {
    raw = await invoke<DispatchClusterRawOutput>("prd_split_dispatch_cluster", {
      input: {
        projectRootPath: input.projectRootPath,
        parentTaskPath: input.parentTaskPath,
        clusterId: `${input.cluster.id}-verify`,
        bundle,
        prompt,
        model: input.model ?? null,
        timeoutMs: input.timeoutMs ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      raw: emptyRaw(),
      normalized: null,
      validationIssues: [],
      errors: [`verifier dispatch 命令失败: ${message}`],
    };
  }

  if (raw.exitCode !== 0) errors.push(`Claude 退出码非零 (${raw.exitCode})`);
  if (raw.rawOutput == null) {
    return {
      raw,
      normalized: null,
      validationIssues: [],
      errors: [...errors, formatMissingJsonError(raw)],
    };
  }

  const validation = validateClaudeSplitPayloadStrict({
    payload: raw.rawOutput,
    source: input.prd,
  });
  if (!validation.ok) {
    return {
      raw,
      normalized: null,
      validationIssues: validation.issues,
      errors: [...errors, `verifier 输出仍未通过 strict 校验（${validation.issues.length} 条 issue）`],
    };
  }

  const normalized = normalizeClaudeSplitOutputToSplitResult({
    payload: raw.rawOutput,
    source: input.prd,
    context: input.context,
  });

  return {
    raw,
    normalized,
    validationIssues: [],
    errors,
  };
}

export function composeVerifierPrompt(input: {
  parentTaskPath: string;
  cluster: ClusterPlanItem;
  issueCount: number;
  bundleFileNames: string[];
  bundle?: ClaudeInputBundleFiles;
}): string {
  const lines: string[] = [];
  lines.push(`Active task: ${input.parentTaskPath}`);
  lines.push("");
  lines.push("你是 `trellis-verifier` 子代理。上一轮 `trellis-splitter` 的输出未通过本地 strict 校验；请基于 `previous-output.json` 与 `validation-issues.json` 给出**修正版** JSON，仅输出一个顶层 JSON 对象，不要 Markdown 围栏，不要解释文字。");
  lines.push("不要调用工具。完整输入 bundle 已内嵌在下方，直接使用。");
  lines.push("");
  lines.push("详细规则见 `.trellis/spec/guides/trellis-verifier-prompt.md`。");
  lines.push("");
  lines.push("## Cluster meta");
  lines.push(`- id: \`${input.cluster.id}\``);
  lines.push(`- title: ${input.cluster.title}`);
  lines.push(`- primaryRepositoryId: ${input.cluster.primaryRepositoryId ?? "null"}`);
  lines.push(`- requirementIds: ${JSON.stringify(input.cluster.requirementIds)}`);
  lines.push("");
  lines.push(`## 待修复 issue 数量：${input.issueCount}`);
  lines.push("");
  lines.push("## Input bundle");
  for (const name of input.bundleFileNames) lines.push(`- \`${name}\``);
  if (input.bundle) {
    lines.push("");
    lines.push("## Embedded input bundle");
    lines.push("Use these exact file contents. Do not read them again with tools.");
    for (const name of input.bundleFileNames) {
      const content = input.bundle[name];
      if (content == null) continue;
      lines.push("");
      lines.push(`### ${name}`);
      lines.push("~~~");
      lines.push(content);
      lines.push("~~~");
    }
  }
  lines.push("");
  lines.push("## 强约束");
  lines.push("1. 输出 schema 同 splitter；通过 `validateClaudeSplitPayloadStrict`。");
  lines.push("2. 每个 task `sourceRequirementIds` 必须来自 `requirements-index.json`；不得编造。");
  lines.push("3. `taskAnchors` 须可追溯到 PRD 原文（contextBefore / contextAfter）。");
  lines.push("4. 尽量保留 previous-output 的 task id；新任务用 `task-<n>-v2`。");
  lines.push("5. 不可解的 issue → 把对应 task 标 `executionStatus: not_executable`，并在 missingPrerequisites 写清原因。");
  lines.push("6. 仅输出一个顶层 JSON 对象。");
  lines.push("7. 最终回复必须是 JSON 对象本身，以 `{` 开头，以 `}` 结尾。");
  lines.push("");
  lines.push("现在产出修正后的 JSON。");
  return lines.join("\n");
}

function formatMissingJsonError(raw: DispatchClusterRawOutput): string {
  const parts = [
    "verifier 输出未包含可解析的 splitter JSON 对象。",
    raw.runDir ? `runDir: ${raw.runDir}` : null,
    raw.stdoutPath ? `stdout: ${raw.stdoutPath}` : null,
    raw.rawResultPath ? `raw: ${raw.rawResultPath}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" ");
}

function emptyRaw(): DispatchClusterRawOutput {
  return {
    runId: "",
    runDir: "",
    exitCode: -1,
    durationMs: 0,
    stdoutPath: "",
    stderrPath: "",
    rawResultPath: "",
    rawOutput: null,
    stdoutTruncatedPreview: "",
  };
}
