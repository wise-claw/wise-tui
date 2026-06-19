import type { ClaudeHookHandler } from "../../types";
import {
  EVENT_HELP_TEXT,
  type HookDisplayType,
  getDefaultDisplaySupportedTypes,
  getDefaultEditableSupportedTypes,
  getDisplaySupportedTypesMap,
} from "./constants";

export function getHelpTextByTitle(title: string, eventName?: string): string {
  if (title.includes("PostToolUse / PostToolUseFailure")) {
    return `${EVENT_HELP_TEXT.PostToolUse} ${EVENT_HELP_TEXT.PostToolUseFailure}`;
  }
  if (title.includes("SubagentStart / SubagentStop")) {
    return `${EVENT_HELP_TEXT.SubagentStart} ${EVENT_HELP_TEXT.SubagentStop}`;
  }
  if (title.includes("Stop / StopFailure")) {
    return `${EVENT_HELP_TEXT.Stop} ${EVENT_HELP_TEXT.StopFailure}`;
  }
  if (eventName) return EVENT_HELP_TEXT[eventName] ?? "该流程说明暂未配置。";
  return "该步骤用于表示 Claude Code 生命周期中的中间过程。";
}

export function getDisplaySupportedTypesByEvent(eventName?: string): HookDisplayType[] {
  if (!eventName) return getDefaultDisplaySupportedTypes();
  return getDisplaySupportedTypesMap()[eventName] ?? getDefaultDisplaySupportedTypes();
}

/** Wise 编辑器当前可创建的 hook 类型（不含 mcp_tool）。 */
export function getSupportedTypesByEvent(eventName?: string): ClaudeHookHandler["type"][] {
  if (!eventName) return getDefaultEditableSupportedTypes();
  return getDisplaySupportedTypesByEvent(eventName).filter(
    (type): type is ClaudeHookHandler["type"] => type !== "mcp_tool",
  );
}

export function getSupportedTypesText(eventName: string): string {
  return getDisplaySupportedTypesByEvent(eventName).join(" / ");
}

export function handlerSummary(h: ClaudeHookHandler): string {
  if (h.type === "command") return h.command?.trim() || "(空命令)";
  if (h.type === "http") return h.url?.trim() || "(空 URL)";
  return h.prompt?.trim() || "(空 prompt)";
}

const HOOK_RUNTIME_UTILITY_BASENAMES = new Set(["find-node.sh", "run.cjs", "run.mjs"]);
const PLUGIN_ROOT_PATTERN = /\$\{?CLAUDE_PLUGIN_ROOT\}?/g;

export type HookPathResolutionContext = {
  repositoryPath?: string | null;
  scopeSourcePath?: string | null;
  handlerId?: string | null;
  pluginSourcePaths?: readonly string[];
};

export type HookOpenTarget =
  | { kind: "absolute"; absolutePath: string }
  | { kind: "repository"; repositoryPath: string; relativePath: string };

function stripOuterQuotes(value: string): string {
  let path = value.trim();
  while (path.startsWith('"') || path.startsWith("'")) {
    path = path.slice(1);
  }
  while (path.endsWith('"') || path.endsWith("'")) {
    path = path.slice(0, -1);
  }
  return path.trim();
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function joinAbsolutePath(root: string, relative: string): string {
  const base = root.replace(/\/+$/, "");
  const rel = relative.replace(/^\/+/, "");
  return `${base}/${rel}`;
}

function isHomePath(path: string): boolean {
  return path === "~" || path.startsWith("~/");
}

/** 真实绝对路径（排除 OMC `""/scripts/...` 展开后的 `/scripts/...`）。 */
function isFilesystemAbsolutePath(path: string): boolean {
  if (!path.startsWith("/") || path.length <= 1) return false;
  if (path.startsWith("/scripts/")) return false;
  return true;
}

function isPluginRelativeArtifactPath(path: string): boolean {
  return path.startsWith("/scripts/") || path.startsWith("scripts/");
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
        tokens.push(current);
        current = "";
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (current.trim()) {
        tokens.push(current.trim());
        current = "";
      }
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.trim()) {
        tokens.push(current.trim());
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (quote) {
    tokens.push(current);
  } else if (current.trim()) {
    tokens.push(current.trim());
  }
  return tokens;
}

type ParsedCommandPath = {
  path: string;
  isAbsolute: boolean;
  usesPluginRoot: boolean;
  usesHome: boolean;
};

function parseCommandPathToken(token: string): ParsedCommandPath | null {
  const raw = stripOuterQuotes(token);
  if (!raw || raw.startsWith("-")) return null;

  if (isHomePath(raw)) {
    return { path: raw, isAbsolute: true, usesPluginRoot: false, usesHome: true };
  }

  if (isFilesystemAbsolutePath(raw)) {
    return { path: raw, isAbsolute: true, usesPluginRoot: false, usesHome: false };
  }

  const emptyPluginPrefix = raw.match(/^""\/?(.*)$/);
  if (emptyPluginPrefix) {
    const suffix = emptyPluginPrefix[1]?.replace(/^\/+/, "") ?? "";
    if (!suffix) return null;
    return { path: suffix, isAbsolute: false, usesPluginRoot: true, usesHome: false };
  }

  if (PLUGIN_ROOT_PATTERN.test(raw)) {
    const path = raw.replace(PLUGIN_ROOT_PATTERN, "").replace(/^\/+/, "");
    if (!path) return null;
    return { path, isAbsolute: false, usesPluginRoot: true, usesHome: false };
  }

  if (raw.startsWith("/scripts/")) {
    return { path: raw.slice(1), isAbsolute: false, usesPluginRoot: true, usesHome: false };
  }

  let path = raw;
  if (path.startsWith("./")) {
    path = path.slice(2);
  }
  if (!path) return null;

  const looksLikePath =
    path.includes("/") ||
    path.startsWith(".") ||
    /\.(mjs|cjs|js|py|sh|bash|zsh|ts)$/i.test(path);
  if (!looksLikePath) return null;

  return {
    path,
    isAbsolute: false,
    usesPluginRoot: isPluginRelativeArtifactPath(path),
    usesHome: false,
  };
}

function extractCommandPathCandidates(command: string): ParsedCommandPath[] {
  const tokens = tokenizeShellCommand(command);
  const paths: ParsedCommandPath[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const parsed = parseCommandPathToken(tokens[index]!);
    if (parsed) paths.push(parsed);
  }
  return paths;
}

function pickPrimaryHookScriptPath(candidates: ParsedCommandPath[]): ParsedCommandPath | null {
  const meaningful = candidates.filter((item) => !HOOK_RUNTIME_UTILITY_BASENAMES.has(basename(item.path)));
  return meaningful[meaningful.length - 1] ?? candidates[candidates.length - 1] ?? null;
}

export function derivePluginRootFromSourcePath(sourcePath?: string | null): string | null {
  const normalized = sourcePath?.trim().replace(/\\/g, "/");
  if (!normalized) return null;
  const hooksJson = normalized.match(/^(.*)\/hooks\/hooks\.json$/);
  if (hooksJson?.[1]) return hooksJson[1]!;
  const manifest = normalized.match(/^(.*)\/\.claude-plugin\/plugin\.json$/);
  if (manifest?.[1]) return manifest[1]!;
  return null;
}

function resolvePluginRoots(context?: HookPathResolutionContext): string[] {
  const roots = new Set<string>();
  const fromScope = derivePluginRootFromSourcePath(context?.scopeSourcePath);
  if (fromScope) roots.add(fromScope);
  for (const sourcePath of context?.pluginSourcePaths ?? []) {
    const root = derivePluginRootFromSourcePath(sourcePath);
    if (root) roots.add(root);
  }
  return Array.from(roots).sort((a, b) => {
    const aOmc = a.includes("/omc/") || a.includes("oh-my-claudecode");
    const bOmc = b.includes("/omc/") || b.includes("oh-my-claudecode");
    if (aOmc !== bOmc) return aOmc ? -1 : 1;
    return a.localeCompare(b);
  });
}

function resolvePluginRoot(context?: HookPathResolutionContext): string | null {
  const roots = resolvePluginRoots(context);
  return roots[0] ?? null;
}

export function resolveHookHandlerOpenTarget(
  handler: ClaudeHookHandler,
  matcher?: string | null,
  context?: HookPathResolutionContext,
): HookOpenTarget | null {
  if (handler.type !== "command") return null;
  const command = handler.command?.trim() ?? "";
  if (!command) return null;

  const candidates = extractCommandPathCandidates(command);
  const picked = pickPrimaryHookScriptPath(candidates);
  const commandUsesPluginRoot = candidates.some((item) => item.usesPluginRoot);

  if (picked) {
    if (picked.isAbsolute && !picked.usesHome) {
      return { kind: "absolute", absolutePath: picked.path };
    }
    if (picked.usesHome) {
      return { kind: "absolute", absolutePath: picked.path };
    }
    if (picked.usesPluginRoot || commandUsesPluginRoot) {
      const pluginRoot = resolvePluginRoot(context);
      if (pluginRoot) {
        return { kind: "absolute", absolutePath: joinAbsolutePath(pluginRoot, picked.path) };
      }
    }
    const repo = context?.repositoryPath?.trim();
    if (repo) {
      return { kind: "repository", repositoryPath: repo, relativePath: picked.path };
    }
    const pluginRoot = resolvePluginRoot(context);
    if (pluginRoot) {
      return { kind: "absolute", absolutePath: joinAbsolutePath(pluginRoot, picked.path) };
    }
    return null;
  }

  const matcherText = matcher?.trim();
  if (matcherText && matcherText !== "*") {
    const relativePath = matcherText.includes("/")
      ? matcherText.replace(/^\.\//, "").replace(/^\/+/, "")
      : `.claude/hooks/${matcherText}`;
    const repo = context?.repositoryPath?.trim();
    if (repo) {
      return { kind: "repository", repositoryPath: repo, relativePath };
    }
  }
  return null;
}

/** 返回用于展示/打开的绝对路径（能解析时）。 */
export function resolveHookHandlerTargetPath(
  handler: ClaudeHookHandler,
  matcher?: string | null,
  context?: HookPathResolutionContext,
): string | null {
  const target = resolveHookHandlerOpenTarget(handler, matcher, context);
  if (!target) return null;
  if (target.kind === "absolute") return target.absolutePath;
  return joinAbsolutePath(target.repositoryPath, target.relativePath);
}

export function formatHookOpenTargetTooltip(
  target: HookOpenTarget | null | undefined,
): string | undefined {
  if (!target) return undefined;
  if (target.kind === "absolute") return target.absolutePath;
  return joinAbsolutePath(target.repositoryPath, target.relativePath);
}

/** @deprecated 优先使用 formatHookOpenTargetTooltip */
export function formatHookTargetPathTooltip(
  targetPath: string | null | undefined,
  repositoryPath?: string | null,
): string | undefined {
  const path = targetPath?.trim();
  if (!path) return undefined;
  if (isFilesystemAbsolutePath(path) || isHomePath(path)) return path;
  const repo = repositoryPath?.trim().replace(/\/+$/, "");
  if (repo) return joinAbsolutePath(repo, path);
  return path;
}
