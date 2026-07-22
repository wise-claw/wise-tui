import { message } from "antd";
import { runClaudeQuick } from "./claudeQuick";
import { searchRepositoryFiles } from "./repositoryFiles";
import { readProjectRelativeFile } from "./projectRelativeFiles";
import {
  buildImportNavigationAiPrompt,
  buildImportNavigationSearchQuery,
  parseImportNavigationAiPath,
  pickExactBasenameSearchHit,
  takeImportNavigationSearchCandidates,
  type ImportNavigationResolveKind,
} from "../utils/monacoImportAiResolve";
import { resolvePathAliasImportCandidates } from "../utils/monacoPathAliasResolve";
import { loadRepositoryTypeScriptProfile } from "./monacoRepositoryTypeScriptConfig";

const AI_TIMEOUT_MS = 12_000;
const AI_MODEL = "haiku";
const SEARCH_CANDIDATE_LIMIT = 20;

export interface ResolveImportPathWithAiFallbackInput {
  repositoryPath: string;
  fromRelativePath: string;
  specifier: string;
  kind: ImportNavigationResolveKind;
  lineContext: string;
}

interface SearchResolveResult {
  path: string | null;
  /** 需要 AI 择一的候选；空表示搜索阶段已结束（命中或彻底无结果）。 */
  aiCandidates: string[];
}

async function tryAliasCandidates(
  repositoryPath: string,
  specifier: string,
): Promise<string | null> {
  let paths: Record<string, string[] | undefined> | null = null;
  let baseUrl = ".";
  try {
    const profile = await loadRepositoryTypeScriptProfile(repositoryPath);
    const compilerOptions = profile.compilerOptions ?? {};
    const pathsRaw = compilerOptions.paths;
    if (pathsRaw && typeof pathsRaw === "object" && !Array.isArray(pathsRaw)) {
      paths = pathsRaw as Record<string, string[] | undefined>;
    }
    if (typeof compilerOptions.baseUrl === "string" && compilerOptions.baseUrl.trim()) {
      baseUrl = compilerOptions.baseUrl.trim();
    }
  } catch {
    // 默认 @/ → src/
  }

  const candidates = resolvePathAliasImportCandidates(specifier, { paths, baseUrl });
  for (const candidate of candidates) {
    if (await fileExists(repositoryPath, candidate)) return candidate;
  }
  return null;
}

/**
 * 仅仓库搜索：唯一文件名命中 / 唯一候选可直跳；多候选留给 AI。
 */
async function resolveViaRepositorySearch(
  repositoryPath: string,
  specifier: string,
  fromRelativePath: string,
): Promise<SearchResolveResult> {
  const aliasHit = await tryAliasCandidates(repositoryPath, specifier);
  if (aliasHit) return { path: aliasHit, aiCandidates: [] };

  const query = buildImportNavigationSearchQuery(specifier);
  if (!query) return { path: null, aiCandidates: [] };

  // 从 Java/Kotlin 等源文件点类型名时，优先带后缀搜索，更容易命中同名文件。
  const fromExt = (fromRelativePath.split(/[\\/]/).pop() ?? "").split(".").pop()?.toLowerCase() ?? "";
  const preferredQuery =
    fromExt && ["java", "kt", "kts", "cs"].includes(fromExt) && !query.includes(".")
      ? `${query}.${fromExt}`
      : query;

  const hitsPreferred = await searchRepositoryFiles(repositoryPath, preferredQuery);
  const hits =
    hitsPreferred.length > 0 || preferredQuery === query
      ? hitsPreferred
      : await searchRepositoryFiles(repositoryPath, query);

  const exact = pickExactBasenameSearchHit(query, hits);
  if (exact && (await fileExists(repositoryPath, exact))) {
    return { path: exact, aiCandidates: [] };
  }

  const candidates = takeImportNavigationSearchCandidates(hits, SEARCH_CANDIDATE_LIMIT);
  if (candidates.length === 1) {
    const only = candidates[0]!;
    if (await fileExists(repositoryPath, only)) {
      return { path: only, aiCandidates: [] };
    }
    return { path: null, aiCandidates: [] };
  }
  if (candidates.length === 0) return { path: null, aiCandidates: [] };
  return { path: null, aiCandidates: candidates };
}

async function resolveViaAiPick(
  input: ResolveImportPathWithAiFallbackInput,
  candidates: string[],
): Promise<string | null> {
  try {
    const raw = await runClaudeQuick({
      projectPath: input.repositoryPath.trim(),
      prompt: buildImportNavigationAiPrompt({
        fromRelativePath: input.fromRelativePath,
        specifier: input.specifier,
        kind: input.kind,
        lineContext: input.lineContext,
        candidates,
      }),
      timeoutMs: AI_TIMEOUT_MS,
      model: AI_MODEL,
    });
    const picked = parseImportNavigationAiPath(raw, candidates);
    if (!picked) return null;
    return (await fileExists(input.repositoryPath, picked)) ? picked : null;
  } catch {
    return null;
  }
}

/**
 * 规则候选全部不存在时的兜底：仓库搜索 → 单文件名命中直跳 → 否则 haiku 从候选择一。
 * 失败/超时静默返回 null（由调用方决定是否 toast）。
 */
export async function resolveImportPathWithAiFallback(
  input: ResolveImportPathWithAiFallbackInput,
): Promise<string | null> {
  const repositoryPath = input.repositoryPath.trim();
  if (!repositoryPath) return null;

  const searched = await resolveViaRepositorySearch(
    repositoryPath,
    input.specifier,
    input.fromRelativePath,
  );
  if (searched.path) return searched.path;
  if (searched.aiCandidates.length === 0) return null;
  return resolveViaAiPick(input, searched.aiCandidates);
}

async function fileExists(repositoryPath: string, relativePath: string): Promise<boolean> {
  try {
    await readProjectRelativeFile(repositoryPath, relativePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 带反馈的兜底跳转：一开始就显示 loading（大仓库搜索可能较慢），避免「点击无反应」。
 */
export async function resolveImportPathWithAiFallbackUi(
  input: ResolveImportPathWithAiFallbackInput,
): Promise<string | null> {
  const repositoryPath = input.repositoryPath.trim();
  const label = input.specifier.trim() || "目标";
  if (!repositoryPath) {
    message.info("未能解析目标文件");
    return null;
  }

  const hide = message.loading(`正在定位 ${label}…`, 0);
  try {
    const searched = await resolveViaRepositorySearch(
      repositoryPath,
      input.specifier,
      input.fromRelativePath,
    );
    if (searched.path) return searched.path;
    if (searched.aiCandidates.length === 0) {
      message.info(`未找到 ${label} 对应文件`);
      return null;
    }

    const path = await resolveViaAiPick(input, searched.aiCandidates);
    if (!path) {
      message.info(`未能解析 ${label}`);
      return null;
    }
    return path;
  } catch {
    message.info(`未能解析 ${label}`);
    return null;
  } finally {
    hide();
  }
}
