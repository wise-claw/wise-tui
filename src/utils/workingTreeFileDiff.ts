import { gitBlameFile, gitShowRevision } from "../services/git";
import { readProjectRelativeFile } from "../services/projectRelativeFiles";
import type { GitBlameLineEntry } from "../types";
import { buildFileTextDiffLines, type ToolFileEditPreviewLine } from "./toolFileEditPreview";

const cache = new Map<string, Promise<ToolFileEditPreviewLine[]>>();

/** 卡片用它做 effect 依赖，逻辑更新后会重新拉取，避免沿用上一次的空结果。 */
export const FILE_DIFF_RECOVERY_VERSION = 6;

/** 同时进行的 git 补齐上限。多会话里每张编辑卡都会触发，不限流会把主线程和 git IPC 打满。 */
const MAX_DIFF_RECOVERY_IN_FLIGHT = 2;

/** 超过该字符数的全文不再在主线程做 diff / blame。 */
const MAX_DIFF_SOURCE_CHARS = 120_000;

const CACHE_MAX = 256;

let diffRecoveryInFlight = 0;
const diffRecoveryWaiters: Array<() => void> = [];

/** 按时间从新到旧列出 blame 里出现过的提交。 */
export function blameShasByRecency(lines: readonly GitBlameLineEntry[]): string[] {
  const newest = new Map<string, number>();
  for (const line of lines) {
    const sha = line.sha.trim();
    if (!sha) continue;
    const prev = newest.get(sha);
    if (prev == null || line.timestamp > prev) newest.set(sha, line.timestamp);
  }
  return [...newest.entries()].sort((a, b) => b[1] - a[1]).map(([sha]) => sha);
}

/** 取 blame 里时间最新的提交，用来还原已提交文件的最近一次差异。 */
export function pickLatestBlameSha(lines: readonly GitBlameLineEntry[]): string {
  return blameShasByRecency(lines)[0] ?? "";
}

function rememberDiffLines(key: string, pending: Promise<ToolFileEditPreviewLine[]>): void {
  cache.set(key, pending);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    cache.delete(oldest);
  }
}

function withDiffRecoverySlot<T>(work: () => Promise<T>): Promise<T> {
  const run = () => {
    diffRecoveryInFlight += 1;
    return work().finally(() => {
      diffRecoveryInFlight -= 1;
      diffRecoveryWaiters.shift()?.();
    });
  };
  if (diffRecoveryInFlight < MAX_DIFF_RECOVERY_IN_FLIGHT) return run();
  return new Promise<T>((resolve, reject) => {
    diffRecoveryWaiters.push(() => {
      run().then(resolve, reject);
    });
  });
}

export function diffSourceTooLarge(before: string, after: string): boolean {
  return before.length > MAX_DIFF_SOURCE_CHARS || after.length > MAX_DIFF_SOURCE_CHARS;
}

/**
 * 历史会话只记下了路径、没有 old/new 时补出 diff。
 * 工作区相对 HEAD 有改动就用这份；否则用该文件最近一次提交的差异。
 * 同一路径只算一次，并且全局最多两路同时打 git，避免多会话把界面拖卡。
 */
export function loadWorkingTreeFileDiffLines(
  repositoryPath: string,
  relativePath: string,
): Promise<ToolFileEditPreviewLine[]> {
  const key = `${FILE_DIFF_RECOVERY_VERSION}\n${repositoryPath}\n${relativePath}`;
  const cached = cache.get(key);
  if (cached) return cached;
  // 空结果也留在缓存里。多会话反复挂载同一张卡时，失败重试会再次扫 git。
  const pending = withDiffRecoverySlot(() =>
    computeWorkingTreeFileDiffLines(repositoryPath, relativePath).catch(
      () => [] as ToolFileEditPreviewLine[],
    ),
  );
  rememberDiffLines(key, pending);
  return pending;
}

async function computeWorkingTreeFileDiffLines(
  repositoryPath: string,
  relativePath: string,
): Promise<ToolFileEditPreviewLine[]> {
  const relative = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const [before, after] = await Promise.all([
    gitShowRevision(repositoryPath, `HEAD:${relative}`),
    readProjectRelativeFile(repositoryPath, relative).catch(() => ""),
  ]);
  if (diffSourceTooLarge(before, after)) return [];
  if (before !== after) return buildFileTextDiffLines(before, after);
  return lastCommitDiffLines(repositoryPath, relative, after);
}

export function sameRepoFilePath(filePath: string, relativePath: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  const file = normalize(filePath);
  const relative = normalize(relativePath);
  return file === relative || file.endsWith(`/${relative}`) || relative.endsWith(`/${file}`);
}

async function diffAgainstParent(
  repositoryPath: string,
  relativePath: string,
  sha: string,
  parentSha: string | undefined,
  headText: string,
): Promise<ToolFileEditPreviewLine[] | null> {
  const [parentText, commitText] = await Promise.all([
    parentSha ? gitShowRevision(repositoryPath, `${parentSha}:${relativePath}`) : Promise.resolve(""),
    gitShowRevision(repositoryPath, `${sha}:${relativePath}`),
  ]);
  const next = commitText || headText;
  if (parentText === next || diffSourceTooLarge(parentText, next)) return null;
  return buildFileTextDiffLines(parentText, next);
}

function diffHasChanges(lines: ToolFileEditPreviewLine[] | null): lines is ToolFileEditPreviewLine[] {
  return !!lines && lines.some((line) => line.kind !== "same");
}

async function lastCommitDiffLines(
  repositoryPath: string,
  relativePath: string,
  headText: string,
): Promise<ToolFileEditPreviewLine[]> {
  if (headText.length > MAX_DIFF_SOURCE_CHARS) return [];
  try {
    const blame = await gitBlameFile(repositoryPath, "HEAD", relativePath);
    const sha = pickLatestBlameSha(blame.lines ?? []);
    if (!sha) return [];
    const lines = await diffAgainstParent(repositoryPath, relativePath, sha, `${sha}^`, headText);
    return diffHasChanges(lines) ? lines : [];
  } catch {
    return [];
  }
}
