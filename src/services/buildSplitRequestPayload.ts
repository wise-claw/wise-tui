/**
 * 拆分触发前的输入装配（spec §4 I2 / I3）：PRD + 用户配置 → Claude 输入包逻辑文件表。
 */

import type { PrdDocument, TaskSplitContext } from "../types";
import { DEFAULT_PRD_BODY_MAX_CHARS } from "../constants/splitInputPrepare";
import { buildRequirementsIndex } from "./prdRequirementIndex";
import { prdDocumentToSplitMarkdown } from "./prdDocumentMarkdown";
import { parseRequirementsIndex } from "./requirementsIndexValidate";

/** spec §5.1 建议文件名 → 内容（由调用方写入 `split-run/{runId}/` 或等价 tar）。 */
export type ClaudeInputBundleFiles = Record<string, string>;

export interface RepoContextForSplit {
  schemaVersion: 1;
  mode: TaskSplitContext["mode"];
  projectId: string | null;
  projectName: string | null;
  repositoryId: number | null;
  repositoryName: string | null;
  repositoryPath: string | null;
  repositoryType: "frontend" | "backend" | "document" | null;
  splitPolicyId: string | null;
  splitPolicyFeatures: Record<string, number | string | boolean> | null;
  splitPolicyRationale: string[] | null;
  /** 已知缺口：须写入模型输出，禁止猜测补全（spec §4.2）。 */
  known_gaps: string[];
}

export interface PrdTrimRunMeta {
  prdTrimApplied: boolean;
  strategy: "none" | "head_truncate";
  originalCharCount: number;
  prdBodyCharLimit: number;
  /** 裁剪存在时指向包内全文相对路径（spec §4 I3）。 */
  fullTextRelativePath: string | null;
}

export interface BuildSplitRequestPayloadInput {
  prd: PrdDocument;
  context: TaskSplitContext | null;
  /** 覆盖默认 PRD 正文上限（UTF-16 码元）。 */
  prdBodyMaxChars?: number;
  /** 若已通过 `renderSplitPromptTemplate` 得到合并稿，写入 bundle。 */
  renderedPromptCombinedMarkdown?: string;
  /** 与 OUTPUT_SCHEMA 变量一致的机器可读 schema 全文；写入 `OUTPUT_SCHEMA.json`。 */
  outputSchemaJson?: string;
}

export type BuildSplitRequestPayloadResult =
  | { ok: true; bundle: ClaudeInputBundleFiles; repoContext: RepoContextForSplit }
  | { ok: false; reason: string };

function buildKnownGaps(context: TaskSplitContext | null): string[] {
  const gaps: string[] = [];
  if (!context) {
    gaps.push("未关联项目/仓库上下文（mode 缺失）。");
    return gaps;
  }
  if (context.mode === "project") {
    if (!context.projectId?.trim()) gaps.push("项目级拆分：缺少 projectId。");
    if (!context.repositoryId) gaps.push("项目级拆分：缺少关联仓库 repositoryId。");
    if (!context.repositoryPath?.trim()) gaps.push("项目级拆分：缺少仓库路径 repositoryPath。");
  }
  if (context.mode === "repository") {
    if (!context.repositoryId) gaps.push("仓库级拆分：缺少 repositoryId。");
    if (!context.repositoryPath?.trim()) gaps.push("仓库级拆分：缺少 repositoryPath。");
  }
  if (!context.repositoryType) {
    gaps.push("未选择仓库类型（frontend / backend / document），输出中须显式反映该缺口。");
  }
  return gaps;
}

function buildRepoContext(context: TaskSplitContext | null): RepoContextForSplit {
  const known_gaps = buildKnownGaps(context);
  if (!context) {
    return {
      schemaVersion: 1,
      mode: "manual",
      projectId: null,
      projectName: null,
      repositoryId: null,
      repositoryName: null,
      repositoryPath: null,
      repositoryType: null,
      splitPolicyId: null,
      splitPolicyFeatures: null,
      splitPolicyRationale: null,
      known_gaps,
    };
  }
  return {
    schemaVersion: 1,
    mode: context.mode,
    projectId: context.projectId ?? null,
    projectName: context.projectName ?? null,
    repositoryId: context.repositoryId ?? null,
    repositoryName: context.repositoryName ?? null,
    repositoryPath: context.repositoryPath ?? null,
    repositoryType: context.repositoryType ?? null,
    splitPolicyId: context.splitPolicyId ?? null,
    splitPolicyFeatures: context.splitPolicyFeatures ?? null,
    splitPolicyRationale: context.splitPolicyRationale ?? null,
    known_gaps,
  };
}

function trimPrdMarkdown(
  fullMarkdown: string,
  limit: number,
): { prdMd: string; meta: PrdTrimRunMeta; prdFullMd: string | null } {
  const originalCharCount = fullMarkdown.length;
  if (fullMarkdown.length <= limit) {
    return {
      prdMd: fullMarkdown,
      meta: {
        prdTrimApplied: false,
        strategy: "none",
        originalCharCount,
        prdBodyCharLimit: limit,
        fullTextRelativePath: null,
      },
      prdFullMd: null,
    };
  }
  const fullTextRelativePath = "prd-full.md";
  const notice = [
    "> **PRD 正文已因长度上限裁剪**",
    "> ",
    `> - 原始字符数（近似）: ${originalCharCount}`,
    `> - 本文件上限: ${limit}（与 run 元数据中 prd.prdBodyCharLimit 一致）`,
    `> - 全文见同目录 \`${fullTextRelativePath}\`（供人工或工具完整阅读）。`,
    "> - 模型须在存在缺口时在输出中显式反映，不得编造被裁掉部分的需求。",
    "",
  ];
  const headBudget = Math.max(0, limit - notice.join("\n").length);
  const head = fullMarkdown.slice(0, headBudget);
  const prdMd = `${notice.join("\n")}${head}`;
  return {
    prdMd,
    meta: {
      prdTrimApplied: true,
      strategy: "head_truncate",
      originalCharCount,
      prdBodyCharLimit: limit,
      fullTextRelativePath,
    },
    prdFullMd: fullMarkdown,
  };
}

/**
 * 从原始 PRD 与用户拆分上下文装配 Claude 输入包（spec §4 I2、§5.1 文件名约定）。
 * 不写入磁盘；Tauri `materialize_prd_snapshot` 等可消费 `bundle`。
 */
export function buildSplitRequestPayload(input: BuildSplitRequestPayloadInput): BuildSplitRequestPayloadResult {
  try {
    const limit = input.prdBodyMaxChars ?? DEFAULT_PRD_BODY_MAX_CHARS;
    const fullMarkdown = prdDocumentToSplitMarkdown(input.prd);
    const { prdMd, prdFullMd } = trimPrdMarkdown(fullMarkdown, limit);
    const requirementsIndex = buildRequirementsIndex(input.prd);
    const idxJson = JSON.stringify(requirementsIndex, null, 2);
    const idxParsed = parseRequirementsIndex(JSON.parse(idxJson) as unknown);
    if (!idxParsed.ok) {
      return { ok: false, reason: idxParsed.errors.join("; ") };
    }
    const repoContext = buildRepoContext(input.context);
    const bundle: ClaudeInputBundleFiles = {
      "prd.md": prdMd,
      "requirements-index.json": idxJson,
      "repo-context.json": JSON.stringify(repoContext, null, 2),
    };
    if (prdFullMd) {
      bundle["prd-full.md"] = prdFullMd;
    }
    if (input.renderedPromptCombinedMarkdown?.trim()) {
      bundle["prompt.rendered.md"] = input.renderedPromptCombinedMarkdown.trim();
    }
    if (input.outputSchemaJson?.trim()) {
      bundle["OUTPUT_SCHEMA.json"] = input.outputSchemaJson.trim();
    }
    return {
      ok: true,
      bundle,
      repoContext,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }
}

/** 控制台单文件预览上限，避免超大 PRD 拖慢 DevTools。 */
const SPLIT_INPUT_DEBUG_LOG_MAX_CHARS = 16_000;
const SPLIT_INPUT_DEBUG_REQ_PREVIEW_MAX = 16;

/**
 * 将「输入准备」bundle 打印到浏览器控制台（供点击拆分时调试 spec §4 / §5.1）。
 */
export function logSplitInputPrepareBundle(
  prd: PrdDocument,
  context: TaskSplitContext | null,
  label: string,
): void {
  const result = buildSplitRequestPayload({ prd, context });
  if (!result.ok) {
    console.error(`[Wise 拆分输入准备] ${label}`, result.reason);
    return;
  }
  const { bundle, repoContext } = result;
  console.groupCollapsed(`[Wise 拆分输入准备] ${label} · ${Object.keys(bundle).join(", ")}`);
  console.log("repoContext", repoContext);
  for (const [fileName, content] of Object.entries(bundle)) {
    if (fileName === "requirements-index.json") {
      try {
        const parsed = JSON.parse(content) as {
          version?: unknown;
          requirements?: Array<{ id?: unknown; content?: unknown }>;
        };
        const requirements = Array.isArray(parsed.requirements) ? parsed.requirements : [];
        const preview = requirements
          .slice(0, SPLIT_INPUT_DEBUG_REQ_PREVIEW_MAX)
          .map((item, idx) => ({
            idx: idx + 1,
            id: typeof item?.id === "string" ? item.id : "",
            content: typeof item?.content === "string" ? item.content.slice(0, 120) : "",
          }));
        console.log(
          `--- ${fileName}（entries=${requirements.length}，仅展示 id/content 摘要） ---`,
        );
        console.table(preview);
        continue;
      } catch {
        console.warn(`--- ${fileName}（解析失败，回退原文预览） ---`);
      }
    }
    const len = content.length;
    const truncated = len > SPLIT_INPUT_DEBUG_LOG_MAX_CHARS;
    const preview = truncated
      ? `${content.slice(0, SPLIT_INPUT_DEBUG_LOG_MAX_CHARS)}\n…（共 ${len} 字符，控制台已截断）`
      : content;
    console.log(`--- ${fileName}（${len} 字符）${truncated ? "，已截断预览" : ""} ---`);
    console.log(preview);
  }
  console.groupEnd();
}
