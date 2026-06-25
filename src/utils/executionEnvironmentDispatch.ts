import {
  EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES,
  EXECUTION_ENVIRONMENT_MENTION_NAME,
  EXECUTION_ENVIRONMENT_REPO_MARKER,
} from "../constants/executionEnvironmentDispatch";
import {
  SESSION_EXECUTION_ENGINE_LABELS,
  SESSION_EXECUTION_ENGINES,
  type SessionExecutionEngine,
} from "../constants/sessionExecutionEngine";
import { extractComposerAttachmentPathsFromText } from "../services/readComposerImage";
import type { ClaudeMessage } from "../types";

const MENTION_PREFIXES = ["@", "＠"] as const;

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const BATCH_COUNT_PATTERNS: RegExp[] = [
  /(?:启动|开启|打开|起|开|创建|新建|并发|并行|同时|跑)\s*(\d{1,2})\s*(?:个|路|条)?\s*(?:会话|对话|窗口|任务|进程|session|sessions?)/iu,
  /(\d{1,2})\s*(?:个|路|条)\s*(?:会话|对话|窗口|任务|进程|session|sessions?)/iu,
  /(?:启动|开启|打开|起|开|创建|新建|并发|并行|同时|跑)\s*([零〇一二两三四五六七八九]{1,3})\s*(?:个|路|条)?\s*(?:会话|对话|窗口|任务|进程)/u,
  /([零〇一二两三四五六七八九]{1,3})\s*(?:个|路|条)\s*(?:会话|对话|窗口|任务|进程)/u,
  /(?:多个|多路|批量|并行|同时)\s*(?:会话|对话|窗口|任务|处理)/u,
];

const DEFAULT_SESSION_COUNT = 1;
const MAX_SESSION_COUNT = 12;

const ALL_ENGINE_MENTION_NAMES = [
  ...Object.values(EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES),
  EXECUTION_ENVIRONMENT_MENTION_NAME,
] as const;

export interface ExecutionEnvironmentDispatchPlan {
  executionEngine: SessionExecutionEngine;
  sessionCount: number;
  cleanedPrompt: string;
  /** 从正文中剥离的批量描述摘要（展示用） */
  batchHint?: string;
}

export interface ExecutionEnvironmentEngineMentionOption {
  engine: SessionExecutionEngine;
  mentionName: string;
  title: string;
  description: string;
  available: boolean;
}

function parseChineseNumber(token: string): number | null {
  const t = token.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) {
    const n = Number.parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (t === "十") return 10;
  if (t.length === 2 && t[0] === "十" && t[1] in CHINESE_DIGITS) {
    return 10 + (CHINESE_DIGITS[t[1]] ?? 0);
  }
  if (t.length === 2 && t[0] in CHINESE_DIGITS && t[1] === "十") {
    return (CHINESE_DIGITS[t[0]] ?? 0) * 10;
  }
  if (t.length === 3 && t[0] in CHINESE_DIGITS && t[1] === "十" && t[2] in CHINESE_DIGITS) {
    return (CHINESE_DIGITS[t[0]] ?? 0) * 10 + (CHINESE_DIGITS[t[2]] ?? 0);
  }
  let sum = 0;
  for (const ch of t) {
    if (!(ch in CHINESE_DIGITS)) return null;
    sum = sum * 10 + (CHINESE_DIGITS[ch] ?? 0);
  }
  return sum > 0 ? sum : null;
}

function clampSessionCount(n: number): number {
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SESSION_COUNT;
  return Math.min(MAX_SESSION_COUNT, Math.floor(n));
}

function isMentionBoundary(text: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = text[index - 1];
  return /[\s([{「『【，,;；：:]/.test(prev);
}

function findMentionIndex(text: string, mentionName: string): number {
  const name = mentionName.trim();
  if (!name) return -1;
  const matches: number[] = [];
  for (const prefix of MENTION_PREFIXES) {
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(`${prefix}${name}`, from);
      if (idx < 0) break;
      if (!isMentionBoundary(text, idx)) {
        from = idx + 1;
        continue;
      }
      const tail = text[idx + prefix.length + name.length] ?? "";
      if (!tail || !/[\p{L}\p{N}_-]/u.test(tail)) {
        matches.push(idx);
      }
      from = idx + prefix.length + name.length;
    }
  }
  if (matches.length === 0) return -1;
  return Math.min(...matches);
}

export function isExecutionEnvironmentEngineAvailable(
  engine: SessionExecutionEngine,
  availability: {
    codexAvailable: boolean;
    cursorAvailable: boolean;
    geminiAvailable: boolean;
    opencodeAvailable: boolean;
  },
): boolean {
  if (engine === "codex") return availability.codexAvailable;
  if (engine === "cursor") return availability.cursorAvailable;
  if (engine === "gemini") return availability.geminiAvailable;
  if (engine === "opencode") return availability.opencodeAvailable;
  return true;
}

export function listExecutionEnvironmentEngineMentionOptions(input: {
  codexAvailable: boolean;
  cursorAvailable: boolean;
  geminiAvailable?: boolean;
  opencodeAvailable?: boolean;
}): ExecutionEnvironmentEngineMentionOption[] {
  const geminiAvailable = input.geminiAvailable ?? false;
  const opencodeAvailable = input.opencodeAvailable ?? false;
  const availability = {
    codexAvailable: input.codexAvailable,
    cursorAvailable: input.cursorAvailable,
    geminiAvailable,
    opencodeAvailable,
  };
  return SESSION_EXECUTION_ENGINES.filter((engine) =>
    isExecutionEnvironmentEngineAvailable(engine, availability),
  ).map((engine) => {
    const meta = SESSION_EXECUTION_ENGINE_LABELS[engine];
    return {
      engine,
      mentionName: EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES[engine],
      title: meta.title,
      description: meta.description,
      available: true,
    };
  });
}

export function findExecutionEnvironmentMentionIndex(text: string): number {
  const indices = ALL_ENGINE_MENTION_NAMES.map((name) => findMentionIndex(text, name)).filter(
    (idx) => idx >= 0,
  );
  if (indices.length === 0) return -1;
  return Math.min(...indices);
}

export function hasExecutionEnvironmentMention(text: string): boolean {
  return findExecutionEnvironmentMentionIndex(text) >= 0;
}

function resolveMentionAtIndex(
  text: string,
  index: number,
): { mentionName: string; engine: SessionExecutionEngine } | null {
  for (const engine of SESSION_EXECUTION_ENGINES) {
    const mentionName = EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES[engine];
    for (const prefix of MENTION_PREFIXES) {
      if (text.startsWith(`${prefix}${mentionName}`, index)) {
        return { mentionName, engine };
      }
    }
  }
  for (const prefix of MENTION_PREFIXES) {
    if (text.startsWith(`${prefix}${EXECUTION_ENVIRONMENT_MENTION_NAME}`, index)) {
      return { mentionName: EXECUTION_ENVIRONMENT_MENTION_NAME, engine: "claude" };
    }
  }
  return null;
}

export function stripExecutionEnvironmentMention(text: string): {
  text: string;
  engine: SessionExecutionEngine;
} {
  const idx = findExecutionEnvironmentMentionIndex(text);
  if (idx < 0) return { text, engine: "claude" };
  const resolved = resolveMentionAtIndex(text, idx);
  if (!resolved) return { text, engine: "claude" };
  let end = idx;
  for (const prefix of MENTION_PREFIXES) {
    if (text.startsWith(`${prefix}${resolved.mentionName}`, idx)) {
      end = idx + prefix.length + resolved.mentionName.length;
      break;
    }
  }
  const before = text.slice(0, idx);
  const after = text.slice(end);
  return {
    text: `${before}${after}`.replace(/\s{2,}/g, " ").trim(),
    engine: resolved.engine,
  };
}

function extractBatchCount(text: string): { count: number; hint?: string } {
  for (const pattern of BATCH_COUNT_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    if (!match[1]) {
      return { count: 2, hint: match[0]?.trim() };
    }
    const parsed = parseChineseNumber(match[1]);
    if (parsed != null && parsed > 0) {
      return { count: clampSessionCount(parsed), hint: match[0]?.trim() };
    }
  }
  return { count: DEFAULT_SESSION_COUNT };
}

/** 从用户输入解析执行环境一次性派发计划。 */
export function parseExecutionEnvironmentDispatch(rawPrompt: string): ExecutionEnvironmentDispatchPlan | null {
  const trimmed = rawPrompt.trim();
  if (!trimmed || !hasExecutionEnvironmentMention(trimmed)) {
    return null;
  }
  const { text: withoutMention, engine } = stripExecutionEnvironmentMention(trimmed);
  const { count, hint } = extractBatchCount(withoutMention);
  let cleanedPrompt = withoutMention;
  for (const pattern of BATCH_COUNT_PATTERNS) {
    cleanedPrompt = cleanedPrompt.replace(pattern, " ").trim();
  }
  cleanedPrompt = cleanedPrompt.replace(/\s{2,}/g, " ").trim();
  return {
    executionEngine: engine,
    sessionCount: clampSessionCount(count),
    cleanedPrompt,
    batchHint: hint,
  };
}

export interface ExecutionEnvironmentWorkerRepoParts {
  engine: SessionExecutionEngine;
  label: string;
}

export function parseExecutionEnvironmentWorkerRepositoryName(
  repositoryName: string,
): ExecutionEnvironmentWorkerRepoParts | null {
  const marker = EXECUTION_ENVIRONMENT_REPO_MARKER;
  const idx = repositoryName.indexOf(marker);
  if (idx < 0) return null;
  const tail = repositoryName.slice(idx + marker.length).trim();
  if (!tail) return null;
  const enginePrefix = tail.match(/^(claude|codex|cursor|gemini|opencode):/i);
  if (enginePrefix) {
    const engine = enginePrefix[1].toLowerCase() as SessionExecutionEngine;
    const label = tail.slice(enginePrefix[0].length).trim();
    return { engine, label: label || "任务" };
  }
  return { engine: "claude", label: tail };
}

export function extractExecutionEnvironmentLabelFromRepositoryName(
  repositoryName: string,
): string | null {
  return parseExecutionEnvironmentWorkerRepositoryName(repositoryName)?.label ?? null;
}

export function isExecutionEnvironmentWorkerRepositoryName(repositoryName: string): boolean {
  return repositoryName.includes(EXECUTION_ENVIRONMENT_REPO_MARKER);
}

export function buildExecutionEnvironmentWorkerRepositoryName(
  repositoryDisplayBase: string,
  label: string,
  engine: SessionExecutionEngine = "claude",
): string {
  const base = repositoryDisplayBase.trim() || "仓库";
  const safeLabel = label.trim() || "任务";
  return `${base}${EXECUTION_ENVIRONMENT_REPO_MARKER}${engine}:${safeLabel}`;
}

/** 执行环境 worker 气泡：去掉 @Claude Code 等指派前缀，保留用户正文与附图。 */
export function buildExecutionEnvironmentWorkerUserBubble(bubbleText: string): string {
  const trimmed = bubbleText.trim();
  if (!trimmed) return trimmed;
  const plan = parseExecutionEnvironmentDispatch(trimmed);
  if (!plan?.cleanedPrompt.trim()) return trimmed;

  const attachmentPaths = extractComposerAttachmentPathsFromText(trimmed);
  if (attachmentPaths.length === 0) return plan.cleanedPrompt;
  const tail = attachmentPaths.map((path) => `@${path}`).join(" ");
  return `${plan.cleanedPrompt}\n\n附图：${tail}`.trim();
}

/** drawer / 历史：执行环境 worker 用户消息不展示 @ 指派对象。 */
export function sanitizeExecutionEnvironmentWorkerUserMessages(
  messages: readonly ClaudeMessage[],
): ClaudeMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;
    const text =
      message.parts
        ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n") ||
      message.content ||
      "";
    const trimmed = text.trim();
    if (!trimmed) return message;
    const cleaned = buildExecutionEnvironmentWorkerUserBubble(trimmed);
    if (cleaned === trimmed) return message;
    return {
      ...message,
      content: cleaned,
      parts: [{ type: "text", text: cleaned }],
    };
  });
}
