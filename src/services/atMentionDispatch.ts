import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { ProjectItem, Repository } from "../types";
import { getRoleTags } from "../utils/projectRepositoryRoles";
import { repositoryFolderBasename, repositorySessionTabDisplayName } from "../utils/repositoryType";

export interface AtMention {
  tag: string;
  index: number;
}

export interface ParseAtMentionsResult {
  mentions: AtMention[];
  strippedBody: string;
}

/**
 * 解析 `@<tag>` 提及。`<tag>` 为连续非空白、非分隔符字符（含仓库目录名如 `vocs-web`）。
 * `\@tag` 转义成纯文本，不计入 mentions。
 *
 * `strippedBody` 是删除合法 @-mention 段后的正文（前后空白合并）。
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
        while (j < input.length) {
          const chAt = input[j]!;
          if (/\s/.test(chAt)) break;
          if (/[@#()[\]{}<>,"'`，。！？；：、]/.test(chAt)) break;
          j += 1;
        }
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

function repositoryMentionAliases(repo: Repository): string[] {
  const aliases = new Set<string>();
  const push = (value: string | null | undefined) => {
    const normalized = value?.trim().toLowerCase();
    if (normalized) aliases.add(normalized);
  };
  push(repositoryFolderBasename(repo));
  push(repo.name);
  return Array.from(aliases);
}

/**
 * 在工作区中查找匹配仓库名，或在当前项目中查找匹配角色标签（大小写不敏感）。
 * 仓库目录名 / 展示名优先且覆盖整个工作区；没有仓库名命中时，再按当前项目 roleTag 匹配。
 */
export function resolveReposByMention(
  tag: string,
  project: ProjectItem,
  repositories: ReadonlyArray<Repository>,
): Repository[] {
  const needle = tag.trim().toLowerCase();
  if (!needle) return [];

  const byRepositoryName = repositories.filter((repo) =>
    repositoryMentionAliases(repo).includes(needle),
  );
  if (byRepositoryName.length > 0) return byRepositoryName;

  return resolveReposByTag(tag, project, repositories);
}

export type AtMentionDispatchPlan =
  | { kind: "dispatch"; mentionedTags: string[]; matchedRepos: Repository[]; body: string }
  | { kind: "fallthrough"; reason: "no_mentions" }
  | { kind: "warn_then_fallthrough"; mentionedTags: string[]; body: string };

/**
 * 计算给定 prompt 在当前项目下应该走哪条路径：派发、回退、或先提示再回退。
 *
 * - 无合法 mention → fallthrough
 * - 工作区内有 mention 但无任何匹配仓库 → warn_then_fallthrough
 * - 独立仓库语境中无匹配仓库 → 静默 fallthrough（可能是 @终端 / @文件）
 * - 至少一条 mention 匹配仓库名或角色标签 → dispatch（正文可为空：只在目标仓新建会话）
 */
export function planAtMentionDispatch(args: {
  activeProject: ProjectItem | null | undefined;
  repositories: ReadonlyArray<Repository>;
  prompt: string;
}): AtMentionDispatchPlan {
  const { activeProject, repositories, prompt } = args;
  const parsed = parseAtMentions(prompt);
  if (parsed.mentions.length === 0) {
    return { kind: "fallthrough", reason: "no_mentions" };
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
    const matched = activeProject
      ? resolveReposByMention(tag, activeProject, repositories)
      : repositories.filter((repo) =>
          repositoryMentionAliases(repo).includes(tag.trim().toLowerCase()),
        );
    for (const repo of matched) {
      matchedReposById.set(repo.id, repo);
    }
  }
  if (matchedReposById.size === 0) {
    if (!activeProject) {
      return { kind: "fallthrough", reason: "no_mentions" };
    }
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
  sessionId?: string;
  summary?: string;
  errorMessage?: string;
}

export interface DispatchAtMentionPromptArgs {
  matchedRepos: ReadonlyArray<Repository>;
  mentionedTags?: ReadonlyArray<string>;
  body: string;
  /** 原始 composer 文本；用于从气泡中剥掉 @仓库 标签。 */
  prompt?: string;
  userBubblePrompt?: string;
  defaultInstructionApplied?: string;
  createSession: (
    repositoryPath: string,
    repositoryName: string,
    opts?: {
      skipActivate?: boolean;
      connectionKind?: "oneshot" | "streaming";
      initialExecutionEngine?: SessionExecutionEngine;
    },
  ) => Promise<string>;
  executeSession: (
    sessionId: string,
    prompt: string,
    opts?: { userBubblePrompt?: string; defaultInstructionApplied?: string },
  ) => boolean;
  /**
   * 创建成功后切到新建会话。@仓库 派发默认不传：任务在目标仓后台跑，当前会话保持不动。
   */
  activateSession?: (sessionId: string) => void;
  /** executeSession 返回 false 或创建失败时清理空壳会话。 */
  closeSession?: (sessionId: string) => void | Promise<void>;
}

function connectionKindForRepository(repo: Repository): "oneshot" | "streaming" {
  const engine = (repo.executionEngine ?? "claude").trim().toLowerCase();
  return engine === "claude" || engine === "" ? "streaming" : "oneshot";
}

/**
 * 只剥掉指定 @标签（仓库名 / roleTag），保留文件路径等其它 @ 引用。
 */
export function stripMentionTags(input: string, tags: ReadonlyArray<string>): string {
  const tagSet = new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  if (tagSet.size === 0) {
    return input.replace(/\s+/g, " ").trim();
  }
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
        while (j < input.length) {
          const chAt = input[j]!;
          if (/\s/.test(chAt)) break;
          if (/[@#()[\]{}<>,"'`，。！？；：、]/.test(chAt)) break;
          j += 1;
        }
        if (j > i + 1) {
          const tag = input.slice(i + 1, j);
          if (tagSet.has(tag.toLowerCase())) {
            i = j;
            continue;
          }
        }
      }
    }
    segments.push(ch);
    i += 1;
  }
  return segments.join("").replace(/\s+/g, " ").trim();
}

/**
 * 在每个匹配仓库下新建会话并执行正文（正文为空则只建会话）。
 * 一条失败不影响其他仓库。
 */
export async function dispatchAtMentionPromptToRepos(
  args: DispatchAtMentionPromptArgs,
): Promise<DispatchResult[]> {
  const commandSource = args.prompt?.trim() || args.body;
  const commandText =
    stripMentionTags(commandSource, args.mentionedTags ?? []) || args.body.trim();
  const bubbleSource = args.userBubblePrompt?.trim() || commandSource;
  const bubble = stripMentionTags(bubbleSource, args.mentionedTags ?? []) || commandText;
  const executePrompt = commandText;
  const defaultInstructionApplied = args.defaultInstructionApplied?.trim() || "";

  const results = await Promise.all(
    args.matchedRepos.map(async (repo): Promise<DispatchResult> => {
      let sessionId: string | null = null;
      try {
        sessionId = await args.createSession(repo.path, repositorySessionTabDisplayName(repo), {
          skipActivate: true,
          connectionKind: connectionKindForRepository(repo),
          ...(repo.executionEngine ? { initialExecutionEngine: repo.executionEngine } : {}),
        });
        if (!executePrompt) {
          return {
            repositoryId: repo.id,
            repositoryPath: repo.path,
            status: "succeeded",
            sessionId,
            summary: `在 ${repo.name} 下新建会话`,
          };
        }
        const spawnOk = args.executeSession(sessionId, executePrompt, {
          ...(bubble ? { userBubblePrompt: bubble } : {}),
          ...(defaultInstructionApplied ? { defaultInstructionApplied } : {}),
        });
        if (spawnOk === false) {
          void args.closeSession?.(sessionId);
          return {
            repositoryId: repo.id,
            repositoryPath: repo.path,
            status: "failed",
            sessionId,
            errorMessage: "新建会话未启动：可能已达并发上限",
          };
        }
        return {
          repositoryId: repo.id,
          repositoryPath: repo.path,
          status: "succeeded",
          sessionId,
          summary: `在 ${repo.name} 下新建会话并执行`,
        };
      } catch (err) {
        if (sessionId) void args.closeSession?.(sessionId);
        return {
          repositoryId: repo.id,
          repositoryPath: repo.path,
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const firstStartedSessionId =
    results.find((item) => item.status === "succeeded")?.sessionId ?? null;
  if (firstStartedSessionId) {
    args.activateSession?.(firstStartedSessionId);
  }
  return results;
}
