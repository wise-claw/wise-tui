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
import type { ClusterPlanItem } from "./clusterPlanner";
import type { RequirementsIndexV2 } from "./requirementsIndexVersion";

export interface DispatchClusterInput {
  projectRootPath: string;
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

/** 0 = 无超时，子代理应自行结束或报错 */
const DEFAULT_SPLITTER_TIMEOUT_MS = 0;

export async function dispatchClusterSplit(input: DispatchClusterInput): Promise<DispatchClusterResult> {
  const errors: string[] = [];

  // 1. 用 cluster 视角的 PRD 子集 + cluster 元数据装配 bundle。
  const clusterRequirementIds = new Set(input.cluster.requirementIds);
  const clusterFilteredPrd: PrdDocument = filterPrdToClusterRequirements(
    input.prd,
    input.requirementsIndex,
    clusterRequirementIds,
  );

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
    "requirements-index.json": JSON.stringify(input.requirementsIndex, null, 2),
  };

  const prompt = composeSplitterPrompt({
    parentTaskPath: input.parentTaskPath,
    cluster: input.cluster,
    bundleFileNames: Object.keys(bundle),
    bundle,
  });

  // 2. Tauri dispatch.
  let raw: DispatchClusterRawOutput;
  try {
    raw = await invoke<DispatchClusterRawOutput>("prd_split_dispatch_cluster", {
      input: {
        projectRootPath: input.projectRootPath,
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
    source: clusterFilteredPrd,
  });
  if (!validation.ok) {
    return {
      raw,
      normalized: null,
      validationIssues: validation.issues,
      errors: [...errors, `输出未通过 strict 校验（${validation.issues.length} 条 issue）`],
    };
  }

  const normalized = normalizeClaudeSplitOutputToSplitResult({
    payload: raw.rawOutput,
    source: clusterFilteredPrd,
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

// ── prompt 装配 ──

export function composeSplitterPrompt(input: {
  parentTaskPath: string;
  cluster: ClusterPlanItem;
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
  lines.push("");
  lines.push("## Cluster meta");
  lines.push(`- id: \`${input.cluster.id}\``);
  lines.push(`- title: ${input.cluster.title}`);
  lines.push(`- primaryRepositoryId: ${input.cluster.primaryRepositoryId ?? "null"}`);
  lines.push(`- repositoryIds: ${JSON.stringify(input.cluster.repositoryIds)}`);
  lines.push(`- requirementIds: ${JSON.stringify(input.cluster.requirementIds)}`);
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
  lines.push("3. For `taskAnchors`, at least one of `contextBefore`/`contextAfter` must be traceable to the source requirement text.");
  lines.push("4. When `executionStatus = \"executable\"`, `missingPrerequisites` must be empty; otherwise non-empty.");
  lines.push("5. `clusterId` must equal this cluster's id. `repoTarget` defaults are handled locally.");
  lines.push("6. Output exactly one top-level JSON object. No surrounding text.");
  lines.push("7. The final assistant response must be the JSON object itself, starting with `{` and ending with `}`.");
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
              required: ["from", "to", "textHash"],
              properties: {
                from: { type: "integer", minimum: 0 },
                to: { type: "integer", minimum: 1 },
                textHash: { type: "string", minLength: 1 },
                contextBefore: { type: "string" },
                contextAfter: { type: "string" },
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
