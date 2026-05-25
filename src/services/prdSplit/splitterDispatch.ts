/**
 * Splitter dispatch — 把一个 cluster 的输入装包 + 派给 `trellis-splitter` subagent。
 *
 * 责任分布：
 *   - TS 这层做：组装 bundle、组装 prompt（含强制的 `Active task:` 前缀）、调用 Tauri 命令、
 *     把 raw 输出喂给本地 normalizer (`normalizeClaudeSplitOutputToSplitResult`)。
 *   - Rust 这层做：写 bundle 到 `~/.wise/prd-runs/<runId>/`、spawn `claude`、抓 stdout、
 *     提取 JSON、回传。
 *
 * 这层不做：cluster planning（见 `clusterPlanner`）、Trellis 落盘（见 `trellisWriter`）。
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  PrdDocument,
  SplitResult,
  TaskSplitContext,
} from "../../types";
import type { ClaudeInputBundleFiles } from "../buildSplitRequestPayload";
import { buildSplitRequestPayload } from "../buildSplitRequestPayload";
import {
  normalizeClaudeSplitOutputToSplitResult,
  validateClaudeSplitPayloadStrict,
  type ClaudeSplitStrictValidationIssue,
} from "../claudeSplitOutputNormalize";
import { readSnapshotFile } from "../materializePrdSnapshot";
import { readTrellisSpecFile } from "../trellisSpecBridge";
import type { ClusterPlanItem } from "./clusterPlanner";
import { PRD_SPLIT_LOOP_FEEDBACK_SPEC_PATH } from "./specFeedback";
import type { RequirementsIndexV2 } from "./requirementsIndexVersion";
import { computeIndexVersion } from "./requirementsIndexVersion";

export interface DispatchClusterInput {
  projectRootPath: string;
  /** Cluster 主仓库路径。Workspace root 负责 Trellis/agent 发现；该目录作为 subagent 代码读取范围。 */
  executionRootPath?: string | null;
  /** 父任务相对路径（`.trellis/tasks/MM-DD-...`），用于 prompt 第一行 `Active task:`。 */
  parentTaskPath: string;
  cluster: ClusterPlanItem;
  /** 原始 PRD 文档（含全文）；本函数会按 cluster 的 requirementIds 切片喂给 splitter。 */
  prd: PrdDocument;
  /** Cluster 关联的 requirements-index v2 全量（splitter 校验需要）。 */
  requirementsIndex: RequirementsIndexV2;
  /** 拆分上下文（仓库标识、policy 等），用于 normalizer 与 buildSplitRequestPayload。 */
  context: TaskSplitContext | null;
  model?: string | null;
  timeoutMs?: number | null;
}

export interface DispatchClusterRawOutput {
  runId: string;
  runDir: string;
  exitCode: number;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  rawResultPath: string;
  rawOutput: unknown;
  stdoutTruncatedPreview: string;
  claudeSessionId?: string | null;
}

export interface DispatchClusterResult {
  raw: DispatchClusterRawOutput;
  normalized: SplitResult | null;
  validationIssues: ClaudeSplitStrictValidationIssue[];
  errors: string[];
}

export interface RetryClusterFromRunDirInput {
  runId: string;
  projectRootPath: string;
  missionId?: string | null;
  clusterId: string;
  model?: string | null;
}

export interface RetryClusterFromRunDirOutput {
  newRunId: string;
  newRunDir: string;
}

export interface CancelClusterRunInput {
  runId: string;
}

export interface CancelClusterRunOutput {
  runId: string;
  runDir: string;
  clusterId: string;
  signalledRunningProcess: boolean;
  wroteRunResult: boolean;
  alreadyFinished: boolean;
}

export interface RecoverClusterRunInput {
  runId: string;
  runDir: string;
  prd: PrdDocument;
  cluster: ClusterPlanItem;
  requirementsIndex: RequirementsIndexV2;
  context: TaskSplitContext | null;
}

interface RetryRunResultJson {
  runId: string;
  status: "succeeded" | "failed" | "cancelled" | "running";
  exitCode: number;
  durationMs: number;
  clusterId: string;
  claudeSessionId?: string | null;
  stdoutPath: string;
  stderrPath: string;
  rawResultPath: string | null;
  error?: string | null;
}

/** 0 = 无超时，子代理应自行结束或报错 */
const DEFAULT_SPLITTER_TIMEOUT_MS = 0;
const LOOP_FEEDBACK_BUNDLE_FILE = "prd-loop-feedback.md";
const LOOP_FEEDBACK_MAX_CHARS = 12_000;
const LOOP_FEEDBACK_MAX_ENTRIES = 3;

export async function dispatchClusterSplit(input: DispatchClusterInput): Promise<DispatchClusterResult> {
  const errors: string[] = [];

  // 1. 用 cluster 视角的 PRD 子集 + cluster 元数据装配 bundle。
  const clusterRequirementIds = new Set(input.cluster.requirementIds);
  const clusterFilteredPrd: PrdDocument = filterPrdToClusterRequirements(
    input.prd,
    input.requirementsIndex,
    clusterRequirementIds,
  );

  const clusterRequirementsIndex = filterRequirementsIndexToCluster(input.requirementsIndex, clusterRequirementIds);
  const clusterPayload = buildClusterMetaJson(input.cluster);
  const outputSchema = OUTPUT_SCHEMA_JSON;
  const payload = buildSplitRequestPayload({
    prd: clusterFilteredPrd,
    context: input.context,
    outputSchemaJson: outputSchema,
  });
  if (!payload.ok) {
    return {
      raw: emptyRaw(),
      normalized: null,
      validationIssues: [],
      errors: [`bundle 装配失败: ${payload.reason}`],
    };
  }

  // 注入 cluster.json + 用本任务专用的 requirements-index v2（含 version/bodyHash）。
  const bundle: Record<string, string> = {
    ...payload.bundle,
    "cluster.json": clusterPayload,
    "requirements-index.json": JSON.stringify(clusterRequirementsIndex, null, 2),
  };
  const loopFeedback = await loadPrdSplitLoopFeedbackForBundle(input.projectRootPath);
  if (loopFeedback) {
    bundle[LOOP_FEEDBACK_BUNDLE_FILE] = loopFeedback;
  }

  const prompt = composeSplitterPrompt({
    parentTaskPath: input.parentTaskPath,
    cluster: input.cluster,
    executionRootPath: input.executionRootPath ?? input.context?.repositoryPath ?? null,
    bundleFileNames: Object.keys(bundle),
    bundle,
  });

  // 2. Tauri dispatch.
  let raw: DispatchClusterRawOutput;
  try {
    raw = await invoke<DispatchClusterRawOutput>("prd_split_dispatch_cluster", {
      input: {
        projectRootPath: input.projectRootPath,
        executionRootPath: input.executionRootPath ?? input.context?.repositoryPath ?? null,
        parentTaskPath: input.parentTaskPath,
        clusterId: input.cluster.id,
        bundle,
        prompt,
        model: input.model ?? null,
        timeoutMs: input.timeoutMs ?? DEFAULT_SPLITTER_TIMEOUT_MS,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      raw: emptyRaw(),
      normalized: null,
      validationIssues: [],
      errors: [`dispatch 命令失败: ${message}`],
    };
  }

  if (raw.exitCode !== 0) {
    errors.push(`Claude 退出码非零 (${raw.exitCode})`);
  }

  // 3. 校验 + 归一。
  if (raw.rawOutput == null) {
    return {
      raw,
      normalized: null,
      validationIssues: [],
      errors: [
        ...errors,
        formatMissingJsonError(raw),
      ],
    };
  }

  const validation = validateClaudeSplitPayloadStrict({
    payload: raw.rawOutput,
    source: input.prd,
  });
  const clusterScopeIssues = validation.ok
    ? validateClusterRequirementScope(raw.rawOutput, input.cluster)
    : [];
  if (!validation.ok) {
    return {
      raw,
      normalized: null,
      validationIssues: validation.issues,
      errors: [...errors, `输出未通过 strict 校验（${validation.issues.length} 条 issue）`],
    };
  }
  if (clusterScopeIssues.length > 0) {
    return {
      raw,
      normalized: null,
      validationIssues: clusterScopeIssues,
      errors: [...errors, `输出引用了非本 cluster 的 requirement id（${clusterScopeIssues.length} 条 issue）`],
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

export async function retryClusterFromRunDir(
  input: RetryClusterFromRunDirInput,
): Promise<RetryClusterFromRunDirOutput> {
  return invoke<RetryClusterFromRunDirOutput>("prd_split_retry_run", {
    input: {
      runId: input.runId,
      projectRootPath: input.projectRootPath,
      missionId: input.missionId ?? null,
      clusterId: input.clusterId,
      model: input.model ?? null,
    },
  });
}

export async function recoverClusterRunFromRunDir(
  input: RecoverClusterRunInput,
): Promise<DispatchClusterResult> {
  const resultJsonPath = `${input.runDir.replace(/\/+$/, "")}/run-result.json`;
  const resultJson = parseRetryRunResultJson(await readSnapshotFile(resultJsonPath), resultJsonPath);
  const runDir = input.runDir.replace(/\/+$/, "");
  const rawResultPath = resultJson.rawResultPath ?? `${runDir}/split-result.raw.json`;
  const rawOutput = await readRetryRawOutput(rawResultPath);
  const raw: DispatchClusterRawOutput = {
    runId: resultJson.runId || input.runId,
    runDir,
    exitCode: resultJson.exitCode,
    durationMs: resultJson.durationMs,
    stdoutPath: resultJson.stdoutPath || `${runDir}/claude.stdout.log`,
    stderrPath: resultJson.stderrPath || `${runDir}/claude.stderr.log`,
    rawResultPath,
    rawOutput,
    stdoutTruncatedPreview: "",
    claudeSessionId: resultJson.claudeSessionId ?? null,
  };
  const errors = resultJson.error ? [resultJson.error] : [];
  if (resultJson.status !== "succeeded") {
    return {
      raw,
      normalized: null,
      validationIssues: [],
      errors: errors.length > 0 ? errors : [`retry run ended with status: ${resultJson.status}`],
    };
  }
  if (rawOutput == null) {
    return {
      raw,
      normalized: null,
      validationIssues: [],
      errors: [
        ...errors,
        formatMissingJsonError(raw),
      ],
    };
  }
  const validation = validateClaudeSplitPayloadStrict({
    payload: rawOutput,
    source: input.prd,
  });
  const clusterScopeIssues = validation.ok
    ? validateClusterRequirementScope(rawOutput, input.cluster)
    : [];
  if (!validation.ok) {
    return {
      raw,
      normalized: null,
      validationIssues: validation.issues,
      errors: [...errors, `输出未通过 strict 校验（${validation.issues.length} 条 issue）`],
    };
  }
  if (clusterScopeIssues.length > 0) {
    return {
      raw,
      normalized: null,
      validationIssues: clusterScopeIssues,
      errors: [...errors, `输出引用了非本 cluster 的 requirement id（${clusterScopeIssues.length} 条 issue）`],
    };
  }
  return {
    raw,
    normalized: normalizeClaudeSplitOutputToSplitResult({
      payload: rawOutput,
      source: input.prd,
      context: input.context,
    }),
    validationIssues: [],
    errors,
  };
}

export async function cancelClusterRun(input: CancelClusterRunInput): Promise<CancelClusterRunOutput> {
  return invoke<CancelClusterRunOutput>("prd_split_cancel_run", {
    input: {
      runId: input.runId,
    },
  });
}

// ── prompt 装配 ──

export function composeSplitterPrompt(input: {
  parentTaskPath: string;
  cluster: ClusterPlanItem;
  executionRootPath?: string | null;
  bundleFileNames: string[];
  bundle?: ClaudeInputBundleFiles;
}): string {
  const lines: string[] = [];
  lines.push(`Active task: ${input.parentTaskPath}`);
  lines.push("");
  lines.push("You are the `trellis-splitter` sub-agent. Split exactly one cluster into tasks.");
  lines.push("Output a single JSON object to stdout — no markdown fences, no explanatory text.");
  lines.push("Do not call tools. The complete input bundle is embedded below; use it directly.");
  lines.push("");
  lines.push("See `.trellis/spec/guides/trellis-splitter-prompt.md` for the full protocol.");
  if (input.bundleFileNames.includes(LOOP_FEEDBACK_BUNDLE_FILE)) {
    lines.push("Also read `prd-loop-feedback.md` for durable lessons from previous PRD split -> Verify -> Spec loops.");
    lines.push("Treat that file as guidance only: `requirements-index.json` remains the source of truth for current task scope.");
  }
  lines.push("");
  lines.push("## Cluster meta");
  lines.push(`- id: \`${input.cluster.id}\``);
  lines.push(`- title: ${input.cluster.title}`);
  lines.push(`- primaryRepositoryId: ${input.cluster.primaryRepositoryId ?? "null"}`);
  lines.push(`- repositoryIds: ${JSON.stringify(input.cluster.repositoryIds)}`);
  lines.push(`- requirementIds: ${JSON.stringify(input.cluster.requirementIds)}`);
  if (input.executionRootPath?.trim()) {
    lines.push(`- executionRootPath: ${input.executionRootPath.trim()}`);
  }
  lines.push("");
  lines.push("## Input bundle (files in the run directory)");
  for (const name of input.bundleFileNames) {
    lines.push(`- \`${name}\``);
  }
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
  lines.push("## Hard constraints (violating any of these invalidates the output)");
  lines.push("1. Output schema: see `OUTPUT_SCHEMA.json` in the input bundle. The output must pass `validateClaudeSplitPayloadStrict`.");
  lines.push("2. Every task must include >=1 `sourceRequirementIds`, each existing in `requirements-index.json`. Do not fabricate IDs.");
  lines.push("3. `taskAnchors` is mandatory for every task and must be an object, never null. At least one of `contextBefore`/`contextAfter` must contain an exact, contiguous substring copied from one of the task's `sourceRequirementIds` contents in `requirements-index.json`.");
  lines.push("4. When `executionStatus = \"executable\"`, `missingPrerequisites` must be empty; otherwise non-empty.");
  lines.push("5. `clusterId` must equal this cluster's id. `repoTarget` defaults are handled locally.");
  lines.push("6. If `prd-loop-feedback.md` exists, apply relevant anchor/dependency/runtime lessons without inventing requirements from it.");
  lines.push("7. Output exactly one top-level JSON object. No surrounding text.");
  lines.push("8. The final assistant response must be the JSON object itself, starting with `{` and ending with `}`.");
  lines.push("");
  lines.push("## Anchor construction");
  lines.push("- Choose the most specific requirement content for each task from `requirements-index.json`.");
  lines.push("- Set `taskAnchors.contextAfter` to a verbatim substring from that requirement content, preferably 16-80 characters. Do not use only headings such as `### 4`.");
  lines.push("- Set `taskAnchors.contextBefore` to nearby PRD text if available; it may also repeat the same requirement substring.");
  lines.push("- Set `taskAnchors.textHash` to that requirement's `bodyHash` when a single requirement is primary; otherwise use a non-empty stable string.");
  lines.push("- If an exact source span is uncertain, still output a taskAnchors object with a verbatim requirement substring; do not output null.");
  lines.push("");
  lines.push("## Classification & design output");
  lines.push("- `classification` is one of:");
  lines.push("  - `\"lightweight\"`: single role, single repo, subtasks <= 3 and dod <= 3. `designMarkdown` / `implementMarkdown` may be omitted.");
  lines.push("  - `\"complex\"`: any of the above not met. **Must** provide non-empty `designMarkdown` and `implementMarkdown`.");
  lines.push("- `designMarkdown` suggested sections: `## Architecture` / `## Data Contract` / `## Compatibility` / `## Risks`.");
  lines.push("- `implementMarkdown` suggested sections: `## Ordered Steps` / `## Validation Commands` / `## Rollback Points`.");
  lines.push("- Do not use triple-backtick code fences inside markdown strings. Use 4-space indent or inline backticks to avoid breaking JSON escaping.");
  lines.push("");
  lines.push("Now produce the JSON.");
  return lines.join("\n");
}

async function loadPrdSplitLoopFeedbackForBundle(projectRootPath: string): Promise<string | null> {
  try {
    const file = await readTrellisSpecFile(projectRootPath, PRD_SPLIT_LOOP_FEEDBACK_SPEC_PATH);
    return buildLoopFeedbackBundleContent(file.content);
  } catch {
    return null;
  }
}

export function buildLoopFeedbackBundleContent(
  content: string,
  options: { maxEntries?: number; maxChars?: number } = {},
): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const maxEntries = Math.max(1, options.maxEntries ?? LOOP_FEEDBACK_MAX_ENTRIES);
  const maxChars = Math.max(500, options.maxChars ?? LOOP_FEEDBACK_MAX_CHARS);
  const entries = trimmed
    .split(/\n(?=## \d{4}-\d{2}-\d{2}T[\d:.]+Z - PRD Split Loop Feedback)/g)
    .filter((entry) => entry.trim().startsWith("## "));
  const selected = entries.length > 0
    ? entries.slice(-maxEntries).join("\n").trim()
    : trimmed;
  const bounded = selected.length > maxChars
    ? `> Earlier feedback omitted to keep splitter context bounded.\n\n${selected.slice(selected.length - maxChars)}`
    : selected;
  return [
    "# PRD Split Loop Feedback For This Split",
    "",
    "Use these durable lessons from prior Verify/Spec feedback to avoid repeating anchor, dependency, runtime, or handoff defects.",
    "Do not treat this file as a source of new product requirements; current `requirements-index.json` is authoritative.",
    "",
    bounded,
  ].join("\n");
}

function formatMissingJsonError(raw: DispatchClusterRawOutput): string {
  const parts = [
    "Claude 输出未包含可解析的 splitter JSON 对象。",
    raw.runDir ? `runDir: ${raw.runDir}` : null,
    raw.stdoutPath ? `stdout: ${raw.stdoutPath}` : null,
    raw.rawResultPath ? `raw: ${raw.rawResultPath}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" ");
}

function buildClusterMetaJson(cluster: ClusterPlanItem): string {
  return JSON.stringify(
    {
      id: cluster.id,
      title: cluster.title,
      primaryRepositoryId: cluster.primaryRepositoryId,
      repositoryIds: cluster.repositoryIds,
      requirementIds: cluster.requirementIds,
      dependencyClusterIds: cluster.dependencyClusterIds,
    },
    null,
    2,
  );
}

function filterRequirementsIndexToCluster(
  index: RequirementsIndexV2,
  clusterRequirementIds: Set<string>,
): RequirementsIndexV2 {
  if (clusterRequirementIds.size === 0) return index;
  const requirements = index.requirements.filter((entry) => clusterRequirementIds.has(entry.id));
  if (requirements.length === 0) return index;
  return {
    schemaVersion: 2,
    version: computeIndexVersion(requirements),
    requirements,
  };
}

/** 把全量 PRD 收窄到只含 cluster 关联的 requirements；其他段落保留以利上下文。 */
function filterPrdToClusterRequirements(
  prd: PrdDocument,
  index: RequirementsIndexV2,
  clusterRequirementIds: Set<string>,
): PrdDocument {
  if (clusterRequirementIds.size === 0) return prd;
  const wantedTexts = new Set<string>();
  for (const entry of index.requirements) {
    if (clusterRequirementIds.has(entry.id)) {
      wantedTexts.add(entry.content.trim());
    }
  }
  if (wantedTexts.size === 0) return prd;
  return {
    ...prd,
    functional: prd.functional.filter((t) => wantedTexts.has(t.trim())),
    nonFunctional: prd.nonFunctional.filter((t) => wantedTexts.has(t.trim())),
    acceptance: prd.acceptance.filter((t) => wantedTexts.has(t.trim())),
  };
}

function validateClusterRequirementScope(
  payload: unknown,
  cluster: ClusterPlanItem,
): ClaudeSplitStrictValidationIssue[] {
  if (cluster.requirementIds.length === 0) return [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const root = payload as Record<string, unknown>;
  const tasks = Array.isArray(root.tasks) ? root.tasks : [];
  const allowed = new Set(cluster.requirementIds);
  const issues: ClaudeSplitStrictValidationIssue[] = [];
  tasks.forEach((task, index) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) return;
    const rawTask = task as Record<string, unknown>;
    const taskId = typeof rawTask.id === "string" && rawTask.id.trim() ? rawTask.id.trim() : `task@${index + 1}`;
    const ids = readStringArray(rawTask.sourceRequirementIds ?? rawTask.source_requirement_ids);
    const outOfScope = ids.filter((id) => !allowed.has(id));
    if (outOfScope.length === 0) return;
    issues.push({
      path: `tasks[${index}].sourceRequirementIds`,
      message: `${taskId} 引用了非本 cluster 的 requirement id: ${outOfScope.join(", ")}`,
    });
  });
  return issues;
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
    claudeSessionId: null,
  };
}

function parseRetryRunResultJson(raw: string, path: string): RetryRunResultJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`解析 retry run-result.json 失败 (${path}): ${message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`retry run-result.json 不是对象: ${path}`);
  }
  const value = parsed as Record<string, unknown>;
  const runId = readString(value.runId);
  const status = readStatus(value.status);
  const rawResultPath = readString(value.rawResultPath);
  if (!runId || !status) {
    throw new Error(`retry run-result.json 缺少 runId/status: ${path}`);
  }
  return {
    runId,
    status,
    exitCode: readNumber(value.exitCode) ?? (status === "succeeded" ? 0 : -1),
    durationMs: readNumber(value.durationMs) ?? 0,
    clusterId: readString(value.clusterId) ?? "",
    claudeSessionId: readString(value.claudeSessionId),
    stdoutPath: readString(value.stdoutPath) ?? "",
    stderrPath: readString(value.stderrPath) ?? "",
    rawResultPath,
    error: readString(value.error),
  };
}

async function readRetryRawOutput(rawResultPath: string): Promise<unknown> {
  const raw = await readSnapshotFile(rawResultPath).catch(() => "");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item));
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStatus(value: unknown): RetryRunResultJson["status"] | null {
  return value === "succeeded" || value === "failed" || value === "cancelled" || value === "running" ? value : null;
}

const OUTPUT_SCHEMA_JSON = JSON.stringify(
  {
    type: "object",
    required: ["tasks"],
    properties: {
      tasks: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: [
            "id",
            "title",
            "description",
            "role",
            "executionStatus",
            "subtasks",
            "dod",
            "sourceRequirementIds",
            "taskAnchors",
          ],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            role: { enum: ["frontend", "backend", "document"] },
            executionStatus: { enum: ["executable", "not_executable"] },
            missingPrerequisites: { type: "array", items: { type: "string" } },
            subtasks: { type: "array", minItems: 1, items: { type: "string" } },
            dod: { type: "array", minItems: 1, items: { type: "string" } },
            dependencies: { type: "array", items: { type: "string" } },
            sourceRequirementIds: { type: "array", minItems: 1, items: { type: "string" } },
            taskAnchors: {
              type: "object",
              required: ["from", "to", "textHash", "contextAfter"],
              properties: {
                from: { type: "integer", minimum: 0 },
                to: { type: "integer", minimum: 1 },
                textHash: { type: "string", minLength: 1 },
                contextBefore: { type: "string" },
                contextAfter: {
                  type: "string",
                  minLength: 4,
                  description: "A verbatim substring copied from one of this task's sourceRequirementIds contents in requirements-index.json.",
                },
              },
            },
            clusterId: { type: "string" },
            repoTarget: { type: ["integer", "null"] },
            classification: { enum: ["lightweight", "complex"] },
            designMarkdown: { type: "string" },
            implementMarkdown: { type: "string" },
          },
        },
      },
      claudeSplitMapping: {
        type: "object",
        properties: {
          version: { const: 1 },
          taskRequirementLinks: {
            type: "array",
            items: {
              type: "object",
              required: ["taskId", "requirementIds"],
              properties: {
                taskId: { type: "string" },
                requirementIds: { type: "array", items: { type: "string" } },
                rationale: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
  null,
  2,
);
