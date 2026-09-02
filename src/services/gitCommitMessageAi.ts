import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { GitStatusResponse } from "../types";
import { collectClaudeInvocationTextCandidates } from "../utils/claudeInvocationText";
import { humanizeClaudeError } from "../utils/humanizeClaudeError";
import {
  buildConventionalCommitFallback,
  conventionalCommitPromptLines,
  normalizeConventionalCommitMessage,
  parseAiConventionalCommitMessage,
} from "../utils/conventionalCommitMessage";
import { getClaudeConfigModel } from "./claude";
import { gitCommitMessageContext } from "./git";
import { executeSessionEngineAndWait, supportsSessionEngineOneshotWait } from "./sessionEngineInvocation";
import { getCachedDefaultExecutionEngine } from "./wiseDefaultConfigStore";

const COMMIT_MESSAGE_AI_TIMEOUT_MS = 45_000;
const COMMIT_MESSAGE_FILE_PREVIEW_LIMIT = 40;

export interface GitCommitAiEngineRetryDetail {
  from: SessionExecutionEngine;
  to: SessionExecutionEngine;
  reason: string;
}

/** 默认执行环境优先，仓库引擎作回退；不支持 oneshot 的引擎（如 Gemini）会跳过。 */
export function resolveGitCommitAiEngineChain(input: {
  defaultEngine?: SessionExecutionEngine | null;
  repositoryEngine?: SessionExecutionEngine | null;
}): SessionExecutionEngine[] {
  const defaultEngine = normalizeSessionExecutionEngine(
    input.defaultEngine ?? getCachedDefaultExecutionEngine(),
  );
  const repositoryEngine =
    input.repositoryEngine == null || String(input.repositoryEngine).trim() === ""
      ? null
      : normalizeSessionExecutionEngine(input.repositoryEngine);

  const chain: SessionExecutionEngine[] = [];
  const add = (engine: SessionExecutionEngine | null) => {
    if (!engine || !supportsSessionEngineOneshotWait(engine) || chain.includes(engine)) {
      return;
    }
    chain.push(engine);
  };
  add(defaultEngine);
  add(repositoryEngine);
  return chain;
}

function parseCommitMessageFromInvocation(outputLines: readonly string[]): string | null {
  const parsed = collectClaudeInvocationTextCandidates(outputLines)
    .map((candidate) => parseAiConventionalCommitMessage(candidate))
    .filter((message): message is string => Boolean(message));
  if (parsed.length === 0) return null;
  return parsed.reduce((best, current) => (current.length > best.length ? current : best));
}

function compactAiFailureReason(lines: readonly string[], fallback: string): string {
  const text = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" · ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  const compact = text.length > 180 ? `${text.slice(0, 180)}…` : text;
  return humanizeClaudeError(compact);
}

function buildCommitMessagePrompt(status: GitStatusResponse, diffContext: string): string {
  const allFiles = [...status.staged, ...status.unstaged];
  const filesPreview = allFiles
    .slice(0, COMMIT_MESSAGE_FILE_PREVIEW_LIMIT)
    .map((file) => `- ${file.path} (${file.status}, +${file.additions}, -${file.deletions})`)
    .join("\n");
  const files =
    allFiles.length > COMMIT_MESSAGE_FILE_PREVIEW_LIMIT
      ? `${filesPreview}\n- ... 另有 ${allFiles.length - COMMIT_MESSAGE_FILE_PREVIEW_LIMIT} 个文件未列出`
      : filesPreview;
  const ahead = status.ahead ?? 0;
  return [
    ...conventionalCommitPromptLines(),
    "",
    `分支: ${status.branch ?? "unknown"}`,
    `统计: +${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`,
    `暂存数量: ${status.staged.length}, 未暂存数量: ${status.unstaged.length}`,
    ahead > 0 ? `待推送提交数: ${ahead}` : "",
    "文件列表：",
    files || "- 无",
    "",
    "实际变更 diff（可能截断；以此判断改动目的）：",
    diffContext || "（diff 不可用，请基于文件清单生成）",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface GenerateGitCommitMessageByAiInput {
  repositoryPath: string;
  status: GitStatusResponse;
  repositoryEngine?: SessionExecutionEngine | null;
  getDefaultEngine?: () => SessionExecutionEngine;
  invokeEngine?: typeof executeSessionEngineAndWait;
  getDiffContext?: (path: string) => Promise<string>;
  getClaudeModel?: typeof getClaudeConfigModel;
  onInvocationKey?: (invocationKey: string) => void;
  isCancelled?: () => boolean;
  onEngineRetry?: (detail: GitCommitAiEngineRetryDetail) => void;
}

export interface GenerateGitCommitMessageByAiResult {
  message: string;
  aiFailed: boolean;
  failureReason?: string;
  engineUsed?: SessionExecutionEngine;
}

/**
 * 生成 Conventional Commit 提交信息：先默认执行环境，失败再试当前仓库引擎。
 * 全部失败时返回规则兜底文案，不抛错。
 */
export async function generateGitCommitMessageByAi(
  input: GenerateGitCommitMessageByAiInput,
): Promise<GenerateGitCommitMessageByAiResult> {
  const fallback = normalizeConventionalCommitMessage(buildConventionalCommitFallback(input.status));
  if (input.isCancelled?.()) {
    return { message: fallback, aiFailed: true };
  }

  const chain = resolveGitCommitAiEngineChain({
    defaultEngine: (input.getDefaultEngine ?? getCachedDefaultExecutionEngine)(),
    repositoryEngine: input.repositoryEngine,
  });
  if (chain.length === 0) {
    return {
      message: fallback,
      aiFailed: true,
      failureReason: "没有可用的 oneshot 执行环境",
    };
  }

  let diffContext = "";
  try {
    const readDiff = input.getDiffContext ?? gitCommitMessageContext;
    diffContext = await readDiff(input.repositoryPath);
  } catch {
    // 保留文件清单降级路径；AI 调用仍可继续。
  }
  if (input.isCancelled?.()) {
    return { message: fallback, aiFailed: true };
  }

  const prompt = buildCommitMessagePrompt(input.status, diffContext);
  const invokeEngine = input.invokeEngine ?? executeSessionEngineAndWait;
  const readClaudeModel = input.getClaudeModel ?? getClaudeConfigModel;
  let lastReason = "执行环境调用失败";
  let lastEngine = chain[0];

  for (let index = 0; index < chain.length; index += 1) {
    if (input.isCancelled?.()) {
      return { message: fallback, aiFailed: true };
    }
    const engine = chain[index]!;
    lastEngine = engine;
    let model: string | undefined;
    if (engine === "claude") {
      try {
        model = (await readClaudeModel(input.repositoryPath)) ?? undefined;
      } catch {
        // 配置读取失败时仍让 Claude CLI 使用自身默认模型。
      }
    }

    try {
      const result = await invokeEngine({
        executionEngine: engine,
        repositoryPath: input.repositoryPath,
        prompt,
        model,
        timeoutMs: COMMIT_MESSAGE_AI_TIMEOUT_MS,
        onInvocationKey: input.onInvocationKey,
      });
      if (input.isCancelled?.()) {
        return { message: fallback, aiFailed: true };
      }
      if (result.success) {
        const parsed = parseCommitMessageFromInvocation(result.outputLines);
        if (parsed) {
          return { message: parsed, aiFailed: false, engineUsed: engine };
        }
        lastReason = "AI 返回内容不符合 type: 中文摘要 格式";
      } else {
        const outputReason = collectClaudeInvocationTextCandidates(result.outputLines)[0] ?? "";
        lastReason = compactAiFailureReason(
          [...result.errorLines, outputReason],
          `${engine} 调用失败`,
        );
      }
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }

    const nextEngine = chain[index + 1];
    if (nextEngine) {
      input.onEngineRetry?.({
        from: engine,
        to: nextEngine,
        reason: lastReason,
      });
    }
  }

  return {
    message: fallback,
    aiFailed: true,
    failureReason: lastReason,
    engineUsed: lastEngine,
  };
}
