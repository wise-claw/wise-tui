import type { ProjectItem, Repository } from "../types";
import type { TrellisExecutionMetadata } from "../types/workflow";
import { getRoleTags } from "../utils/projectRepositoryRoles";
import { executeClaudeCodeAndWait, type ClaudeInvocationResult } from "./claude";
import { gitWorktreeAddOmcBatch } from "./git";

export interface AtMention {
  tag: string;
  index: number;
}

export interface ParseAtMentionsResult {
  mentions: AtMention[];
  strippedBody: string;
}

/**
 * 解析 `@<tag>` 提及。`<tag>` 限 `[A-Za-z0-9_-]+`。`\@tag` 转义成纯文本，不计入 mentions。
 *
 * `strippedBody` 是删除合法 @-mention 段后的正文（前后空白合并），用于子代理派发。
 */
export function parseAtMentions(input: string): ParseAtMentionsResult {
  const mentions: AtMention[] = [];
  const segments: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\" && input[i + 1] === "@") {
      segments.push("@");
      i += 2;
      continue;
    }
    if (ch === "@") {
      const left = input[i - 1];
      const isBoundary = i === 0 || /\s/.test(left ?? "") || /[\(\[\{,;:]/.test(left ?? "");
      if (isBoundary) {
        let j = i + 1;
        while (j < input.length && /[A-Za-z0-9_-]/.test(input[j]!)) j += 1;
        if (j > i + 1) {
          const tag = input.slice(i + 1, j);
          mentions.push({ tag, index: i });
          i = j;
          continue;
        }
      }
    }
    segments.push(ch);
    i += 1;
  }
  const strippedBody = segments.join("").replace(/\s+/g, " ").trim();
  return { mentions, strippedBody };
}

/**
 * 在项目成员仓库中查找匹配标签的仓库。
 * 标签匹配大小写不敏感、去空白。只考虑 `project.repositoryIds` 内的仓库。
 */
export function resolveReposByTag(
  tag: string,
  project: ProjectItem,
  repositories: ReadonlyArray<Repository>,
): Repository[] {
  const needle = tag.trim().toLowerCase();
  if (!needle) return [];
  const memberIds = new Set(project.repositoryIds);
  const out: Repository[] = [];
  for (const repo of repositories) {
    if (!memberIds.has(repo.id)) continue;
    const tags = getRoleTags(repo).map((t) => t.toLowerCase());
    if (tags.includes(needle)) out.push(repo);
  }
  return out;
}

export type AtMentionDispatchPlan =
  | { kind: "dispatch"; mentionedTags: string[]; matchedRepos: Repository[]; body: string }
  | { kind: "fallthrough"; reason: "not_wise_trellis" | "no_mentions" | "empty_body" }
  | { kind: "warn_then_fallthrough"; mentionedTags: string[]; body: string };

/**
 * 计算给定 prompt 在当前项目下应该走哪条路径：派发、回退、或先提示再回退。
 *
 * - 项目非 `wise_trellis` → fallthrough
 * - 无合法 mention → fallthrough
 * - 有 mention 但 strippedBody 为空 → fallthrough（视为单纯 `@frontend` 无指令）
 * - 有 mention 但无任何匹配仓库 → warn_then_fallthrough
 * - 至少一条 mention 匹配 → dispatch
 */
export function planAtMentionDispatch(args: {
  activeProject: ProjectItem | null | undefined;
  repositories: ReadonlyArray<Repository>;
  prompt: string;
}): AtMentionDispatchPlan {
  const { activeProject, repositories, prompt } = args;
  if (!activeProject || activeProject.sddMode !== "wise_trellis") {
    return { kind: "fallthrough", reason: "not_wise_trellis" };
  }
  const parsed = parseAtMentions(prompt);
  if (parsed.mentions.length === 0) {
    return { kind: "fallthrough", reason: "no_mentions" };
  }
  if (parsed.strippedBody.length === 0) {
    return { kind: "fallthrough", reason: "empty_body" };
  }
  const seenTags = new Set<string>();
  const mentionedTags: string[] = [];
  for (const mention of parsed.mentions) {
    const key = mention.tag.toLowerCase();
    if (!seenTags.has(key)) {
      seenTags.add(key);
      mentionedTags.push(mention.tag);
    }
  }
  const matchedReposById = new Map<number, Repository>();
  for (const tag of mentionedTags) {
    for (const repo of resolveReposByTag(tag, activeProject, repositories)) {
      matchedReposById.set(repo.id, repo);
    }
  }
  if (matchedReposById.size === 0) {
    return { kind: "warn_then_fallthrough", mentionedTags, body: parsed.strippedBody };
  }
  return {
    kind: "dispatch",
    mentionedTags,
    matchedRepos: Array.from(matchedReposById.values()),
    body: parsed.strippedBody,
  };
}

export interface DispatchResult {
  repositoryId: number;
  repositoryPath: string;
  status: "succeeded" | "failed";
  taskId: string;
  summary?: string;
  errorMessage?: string;
}

export type ClaudeInvokeFn = (params: {
  repositoryPath: string;
  prompt: string;
  connectionMode?: Parameters<typeof executeClaudeCodeAndWait>[0]["connectionMode"];
  bare?: boolean;
  timeoutMs?: number;
  streamUi?: Parameters<typeof executeClaudeCodeAndWait>[0]["streamUi"];
}) => Promise<ClaudeInvocationResult>;

export type WorktreeFn = (
  repoPath: string,
  taskId: string,
  attempt: number,
) => Promise<{ worktreePath: string; branchName: string }>;

export interface DispatchAtMentionPromptArgs {
  project: ProjectItem;
  matchedRepos: ReadonlyArray<Repository>;
  body: string;
  sessionId: string;
  attempt?: number;
  /** 测试可注入；默认 `executeClaudeCodeAndWait`。 */
  invokeClaude?: ClaudeInvokeFn;
  /** 测试可注入；默认 `gitWorktreeAddOmcBatch`。 */
  prepareWorktree?: WorktreeFn;
  /** 调用方可注入自定义时间戳工厂，便于测试稳定 taskId。 */
  nowMs?: () => number;
}

const DEFAULT_DISPATCH_TIMEOUT_MS = 300_000;

function buildSubagentPrompt(project: ProjectItem, repo: Repository, body: string): string {
  const projectLine = `Active project: ${project.name} (rootPath: ${project.rootPath ?? "(unset)"}).`;
  const repoLine = `Target repository: ${repo.name} at ${repo.path}.`;
  const roleLine = `Role tags: ${getRoleTags(repo).join(", ") || "(none)"}.`;
  return `${projectLine}\n${repoLine}\n${roleLine}\n\nInstruction:\n${body}`;
}

/**
 * 对每个匹配仓库并发派发 trellis-implement 子代理；一条失败不影响其他。
 *
 * 不经过 `TrellisWorkflowAdapter`，因为 @-mention 派发需要把用户的原始指令送达
 * 子代理（适配器内部固定写死的提示词不符合该语义）。`streamUi` 字段透传仓库归属
 * 元数据，确保现有 `RepositoryMember` 监控面板正确归类。
 */
export async function dispatchAtMentionPromptToRepos(
  args: DispatchAtMentionPromptArgs,
): Promise<DispatchResult[]> {
  const invokeClaude = args.invokeClaude ?? executeClaudeCodeAndWait;
  const prepareWorktree = args.prepareWorktree ?? gitWorktreeAddOmcBatch;
  const attempt = args.attempt ?? 1;
  const baseTs = (args.nowMs ?? Date.now)();
  const results = await Promise.all(
    args.matchedRepos.map(async (repo) => {
      const taskId = `at-mention-${baseTs}-${repo.id}`;
      const executionMetadata: TrellisExecutionMetadata = {
        ownerKind: "repository",
        ownerRepositoryId: repo.id,
        ownerRepositoryName: repo.name,
        ownerRepositoryPath: repo.path,
        repositoryType: repo.repositoryType,
        stage: "implement",
        subagentType: "trellis-implement",
        taskId,
      };
      const prompt = buildSubagentPrompt(args.project, repo, args.body);
      try {
        const wt = await prepareWorktree(repo.path, taskId, attempt);
        const invocation = await invokeClaude({
          repositoryPath: wt.worktreePath,
          prompt,
          connectionMode: "oneshot",
          bare: true,
          timeoutMs: DEFAULT_DISPATCH_TIMEOUT_MS,
          streamUi: {
            sessionId: args.sessionId,
            repositoryPath: repo.path,
            templateId: "trellis",
            attempt,
            omcInvocationSource: "workflow",
            ...executionMetadata,
          },
        });
        if (invocation.success) {
          return {
            repositoryId: repo.id,
            repositoryPath: repo.path,
            status: "succeeded" as const,
            taskId,
            summary: `Dispatched trellis-implement to ${repo.name}`,
          };
        }
        return {
          repositoryId: repo.id,
          repositoryPath: repo.path,
          status: "failed" as const,
          taskId,
          errorMessage: invocation.errorLines.join("\n").trim() || "Claude invocation failed",
        };
      } catch (err) {
        return {
          repositoryId: repo.id,
          repositoryPath: repo.path,
          status: "failed" as const,
          taskId,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  return results;
}
