import { buildComposerInsertFromPlainText } from "../services/claudeComposerPrompt";
import { extractComposerAttachmentPathsFromText } from "../services/readComposerImage";

/** Cursor / Claude Code 注入块：列表展示时隐藏，保留 `<user_query>` 内正文。 */
const STRIPPED_XML_BLOCK_TAGS = [
  "image_files",
  "attached_files",
  "user_info",
  "rules",
  "agent_skills",
  "available_skills",
  "system_reminder",
  "system-reminder",
  "open_and_recently_viewed_files",
  "git_status",
  "agent_transcripts",
  "mcp_file_system",
  "mcp_file_system_servers",
  "user_rules",
  "always_applied_workspace_rules",
  "committing-changes-with-git",
  "creating-pull-requests",
  "agent_requestable_workspace_rules",
  "cursor_rules_context",
  "local-command-caveat",
  "command-name",
  "command-message",
  "command-args",
  "command-stdout",
  "command-stderr",
] as const;

const JSONL_INLINE_ATTACHMENT_RE = /\[附图\s+[^\]]+\]/g;
const DISPLAY_CACHE_MAX = 96;
const displayCache = new Map<string, ImportantUserInputDisplay>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripXmlLikeBlocks(text: string, tags: readonly string[]): string {
  if (!text.includes("<")) return text;
  let out = text;
  for (const tag of tags) {
    const open = `<${tag}`;
    if (!out.includes(open)) continue;
    const escaped = escapeRegExp(tag);
    out = out.replace(new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?</${escaped}>`, "gi"), "");
  }
  return out;
}

function extractUserQueryBlock(text: string): string | null {
  const openIdx = text.search(/<user_query>/i);
  if (openIdx < 0) return null;
  const slice = text.slice(openIdx);
  const match = slice.match(/<user_query>([\s\S]*?)<\/user_query>/i);
  const inner = match?.[1]?.trim();
  return inner || null;
}

/** Claude Code 斜杠命令展开块中的用户正文（如 `/autopilot` 后的「你好」）。 */
export function extractCommandArgsBlock(text: string): string | null {
  const match = text.match(/<command-args>([\s\S]*?)<\/command-args>/i);
  const inner = match?.[1]?.trim();
  return inner || null;
}

/** Claude Code 斜杠命令展开块中的命令名（如 `/oh-my-claudecode:autopilot`）。 */
export function extractCommandNameBlock(text: string): string | null {
  const match = text.match(/<command-name>([\s\S]*?)<\/command-name>/i);
  const inner = match?.[1]?.trim();
  return inner || null;
}

export function hasClaudeCommandExpansionBlocks(text: string): boolean {
  return /<command-(?:name|message|args)(?:\s|>)/i.test(text);
}

function extractJsonlAttachmentPaths(text: string): string[] {
  if (!text.includes("[附图")) return [];
  const paths: string[] = [];
  const re = /\[附图\s+([^\]]+)\]/g;
  for (const match of text.matchAll(re)) {
    const p = match[1]?.trim();
    if (p && !paths.includes(p)) paths.push(p);
  }
  return paths;
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface ImportantUserInputDisplay {
  compactText: string;
  attachmentPaths: string[];
  hasStrippedContext: boolean;
}

function rememberDisplayCache(fullText: string, result: ImportantUserInputDisplay): ImportantUserInputDisplay {
  if (displayCache.size >= DISPLAY_CACHE_MAX) {
    const firstKey = displayCache.keys().next().value;
    if (firstKey != null) displayCache.delete(firstKey);
  }
  displayCache.set(fullText, result);
  return result;
}

/** 会话消息列表：提取用户真正输入（类似 Cursor 只展示 query，不含 rules/上下文注入）。 */
export function extractImportantUserInputForDisplay(fullText: string): ImportantUserInputDisplay {
  const cached = displayCache.get(fullText);
  if (cached) return cached;

  const trimmed = fullText.trim();
  if (!trimmed) {
    return rememberDisplayCache(fullText, {
      compactText: "",
      attachmentPaths: [],
      hasStrippedContext: false,
    });
  }

  const attachmentPaths = [
    ...extractComposerAttachmentPathsFromText(trimmed),
    ...extractJsonlAttachmentPaths(trimmed),
  ].filter((path, index, all) => all.indexOf(path) === index);

  const fromUserQuery = extractUserQueryBlock(trimmed);
  const fromCommandArgs = extractCommandArgsBlock(trimmed);
  const stripped = stripXmlLikeBlocks(trimmed, STRIPPED_XML_BLOCK_TAGS)
    .replace(/^\[Image\]\s*/i, "")
    .trim();
  const candidate = fromUserQuery ?? fromCommandArgs ?? stripped;

  const { composerMain } = buildComposerInsertFromPlainText(candidate);
  let compactText = composerMain.replace(JSONL_INLINE_ATTACHMENT_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!compactText && !hasClaudeCommandExpansionBlocks(trimmed)) {
    compactText = trimmed;
  }

  const normalizedFull = normalizeComparableText(trimmed);
  const normalizedCompact = normalizeComparableText(compactText);
  const hasStrippedContext =
    (normalizedCompact !== normalizedFull && normalizedCompact.length > 0) ||
    (attachmentPaths.length > 0 && !compactText.includes("附图"));

  return rememberDisplayCache(fullText, { compactText, attachmentPaths, hasStrippedContext });
}

/** jsonl / 磁盘 transcript 入库：把 Claude 斜杠命令展开块还原为用户可见正文。 */
export function normalizeClaudeUserMessageForDisplay(fullText: string): string {
  return extractImportantUserInputForDisplay(fullText).compactText;
}
