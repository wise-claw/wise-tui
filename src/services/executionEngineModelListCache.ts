import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { ClaudeModelPickerOptions } from "./claude";
import type { CodexModelListItem } from "./codex";
import type { CursorModelListItem } from "./cursorAgent";
import type { OpencodeModelListItem } from "./opencode";
import type { QoderModelListItem } from "./qoder";
import { createLocalModelPreferenceCache } from "./localModelPreferenceCache";

/**
 * 各执行环境的模型列表缓存。先显示本地缓存，再后台拉取并按差异更新。
 */
export const WISE_EXECUTION_ENGINE_MODEL_LISTS_KEY =
  "wise.executionEngineModelLists.v1";

export type ExecutionEngineModelListKind = "cursor" | "codex" | "opencode" | "qoder" | "claude";

const MAX_LIST_ITEMS = 500;
const MAX_CLAUDE_MODELS = 200;
const MAX_ALIASES = 20;
const MAX_TEXT = 512;

export interface ExecutionEngineModelLists {
  cursor?: CursorModelListItem[];
  codex?: CodexModelListItem[];
  opencode?: OpencodeModelListItem[];
  qoder?: QoderModelListItem[];
  claude?: ClaudeModelPickerOptions;
}

export function executionEngineModelListKind(
  engine: SessionExecutionEngine,
): ExecutionEngineModelListKind | null {
  if (engine === "cursor") return "cursor";
  if (engine === "codex" || engine === "codex-rpc") return "codex";
  if (engine === "opencode") return "opencode";
  if (engine === "qoder") return "qoder";
  if (engine === "claude") return "claude";
  return null;
}

function normalizeText(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function parseStringArray(value: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const next: string[] = [];
  for (const item of value) {
    if (next.length >= maxItems) break;
    const text = normalizeText(item);
    if (text) next.push(text);
  }
  return next.length > 0 ? next : undefined;
}

function parseModelListItem(raw: unknown): {
  id: string;
  displayName: string;
  description?: string | null;
  aliases?: string[];
  provider?: string | null;
  providerId?: string;
  providerName?: string | null;
} | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const id = normalizeText(rec.id);
  if (!id) return null;
  const displayName = normalizeText(rec.displayName) ?? id;
  const item: {
    id: string;
    displayName: string;
    description?: string | null;
    aliases?: string[];
    provider?: string | null;
    providerId?: string;
    providerName?: string | null;
  } = { id, displayName };
  if ("description" in rec) {
    const description = normalizeText(rec.description);
    item.description = description;
  }
  const aliases = parseStringArray(rec.aliases, MAX_ALIASES);
  if (aliases) item.aliases = aliases;
  if ("provider" in rec) item.provider = normalizeText(rec.provider);
  const providerId = normalizeText(rec.providerId);
  if (providerId) item.providerId = providerId;
  if ("providerName" in rec) item.providerName = normalizeText(rec.providerName);
  return item;
}

function parseModelList(raw: unknown): ReturnType<typeof parseModelListItem>[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const next: NonNullable<ReturnType<typeof parseModelListItem>>[] = [];
  for (const item of raw) {
    if (next.length >= MAX_LIST_ITEMS) break;
    const parsed = parseModelListItem(item);
    if (parsed) next.push(parsed);
  }
  return next.length > 0 ? next : undefined;
}

function parseClaudePicker(raw: unknown): ClaudeModelPickerOptions | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const defaultModel = normalizeText(rec.defaultModel);
  const availableModels = parseStringArray(rec.availableModels, MAX_CLAUDE_MODELS) ?? [];
  if (!defaultModel && availableModels.length === 0) return undefined;
  return { defaultModel: defaultModel ?? null, availableModels };
}

function parseLists(raw: string | null): ExecutionEngineModelLists {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const rec = parsed as Record<string, unknown>;
    const next: ExecutionEngineModelLists = {};
    const cursor = parseModelList(rec.cursor) as CursorModelListItem[] | undefined;
    if (cursor) next.cursor = cursor;
    const codex = parseModelList(rec.codex) as CodexModelListItem[] | undefined;
    if (codex) next.codex = codex;
    const opencode = parseModelList(rec.opencode) as OpencodeModelListItem[] | undefined;
    if (opencode) next.opencode = opencode;
    const qoder = parseModelList(rec.qoder) as QoderModelListItem[] | undefined;
    if (qoder) next.qoder = qoder;
    const claude = parseClaudePicker(rec.claude);
    if (claude) next.claude = claude;
    return next;
  } catch {
    return {};
  }
}

function cloneLists(lists: ExecutionEngineModelLists): ExecutionEngineModelLists {
  return {
    ...(lists.cursor ? { cursor: lists.cursor.slice() } : {}),
    ...(lists.codex ? { codex: lists.codex.slice() } : {}),
    ...(lists.opencode ? { opencode: lists.opencode.slice() } : {}),
    ...(lists.qoder ? { qoder: lists.qoder.slice() } : {}),
    ...(lists.claude
      ? {
          claude: {
            defaultModel: lists.claude.defaultModel,
            availableModels: lists.claude.availableModels.slice(),
          },
        }
      : {}),
  };
}

const lists = createLocalModelPreferenceCache(WISE_EXECUTION_ENGINE_MODEL_LISTS_KEY, parseLists);

export async function loadExecutionEngineModelLists(): Promise<ExecutionEngineModelLists> {
  return cloneLists(await lists.load());
}

export function resetExecutionEngineModelListsForTests(): void {
  lists.reset();
}

export function getCachedCursorModels(): CursorModelListItem[] | null {
  const cachedLists = lists.read();
  return cachedLists.cursor?.length ? cachedLists.cursor.slice() : null;
}

export function getCachedCodexModels(): CodexModelListItem[] | null {
  const cachedLists = lists.read();
  return cachedLists.codex?.length ? cachedLists.codex.slice() : null;
}

export function getCachedOpencodeModels(): OpencodeModelListItem[] | null {
  const cachedLists = lists.read();
  return cachedLists.opencode?.length ? cachedLists.opencode.slice() : null;
}

export function getCachedQoderModels(): QoderModelListItem[] | null {
  const cachedLists = lists.read();
  return cachedLists.qoder?.length ? cachedLists.qoder.slice() : null;
}

export function getCachedClaudeModelPickerOptions(): ClaudeModelPickerOptions | null {
  const cachedLists = lists.read();
  return cachedLists.claude
    ? {
        defaultModel: cachedLists.claude.defaultModel,
        availableModels: cachedLists.claude.availableModels.slice(),
      }
    : null;
}

/** 空列表视为拉取失败，保留已有缓存，避免把可用模型冲掉。 */
export async function saveCachedCursorModels(items: CursorModelListItem[]): Promise<void> {
  const parsed = parseModelList(items) as CursorModelListItem[] | undefined;
  if (!parsed) return;
  await lists.update("cursor", parsed);
}

export async function saveCachedCodexModels(items: CodexModelListItem[]): Promise<void> {
  const parsed = parseModelList(items) as CodexModelListItem[] | undefined;
  if (!parsed) return;
  await lists.update("codex", parsed);
}

export async function saveCachedOpencodeModels(items: OpencodeModelListItem[]): Promise<void> {
  const parsed = parseModelList(items) as OpencodeModelListItem[] | undefined;
  if (!parsed) return;
  await lists.update("opencode", parsed);
}

export async function saveCachedQoderModels(items: QoderModelListItem[]): Promise<void> {
  const parsed = parseModelList(items) as QoderModelListItem[] | undefined;
  if (!parsed) return;
  await lists.update("qoder", parsed);
}

export async function saveCachedClaudeModelPickerOptions(
  options: ClaudeModelPickerOptions,
): Promise<void> {
  const parsed = parseClaudePicker(options);
  if (!parsed) return;
  await lists.update("claude", parsed);
}
