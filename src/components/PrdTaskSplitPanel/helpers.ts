import type { SplitResult, TaskApiSpec, TaskItem, TaskSize } from "../../types";
import { allSplitResultTaskItems } from "../../services/splitResultModel";
import { refreshSplitResultDerivedFields } from "../../services/taskSplitter";
export {
  remapAnchorRangeFromMarkdownToVisible,
  remapSplitResultAnchorOffsetsFromMarkdown,
} from "../../services/markdownAnchorOffsets";

export type TaskConfirmFilter = "unconfirmed" | "confirmed";
export type TaskAiMode = "optimize" | "check";

export function createRequirementHistoryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `req-${crypto.randomUUID()}`;
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function buildSnapshotAbsoluteDisplayPath(path: string): string {
  if (path.startsWith("/Users/")) {
    const homePrefix = "/Users/";
    const seg = path.slice(homePrefix.length).split("/");
    if (seg.length >= 2) {
      const userHome = `${homePrefix}${seg[0]}`;
      if (path.startsWith(`${userHome}/.wise/`) || path === `${userHome}/.wise`) {
        return `~${path.slice(userHome.length)}`;
      }
    }
  }
  return path;
}

export function dirnameFromAbsolutePath(path: string): string {
  const i = path.lastIndexOf("/");
  if (i <= 0) return path;
  return path.slice(0, i);
}

export function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  try {
    const asJson = JSON.stringify(err);
    if (asJson && asJson !== "{}") return asJson;
  } catch {
    // ignore
  }
  return fallback;
}

export function stripRequirementsIndexSection(markdown: string): string {
  const removed = markdown.replace(/\n?##\s*需求索引（JSON）[\s\S]*?(?=\n##\s|$)/g, "\n");
  return removed.replace(/\n{3,}/g, "\n\n").trim();
}

export function stripSectionByHeading(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\n?##\\s*${escaped}[\\s\\S]*?(?=\\n##\\s|$)`, "g");
  const removed = markdown.replace(re, "\n");
  return removed.replace(/\n{3,}/g, "\n\n").trim();
}

export function clipRuntimeLogText(text: string, maxLen = 12000): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}\n\n...（已截断）` : trimmed;
}

export interface ClaudeRuntimeSessionInfo {
  sessionId: string;
  model: string | null;
  cwd: string | null;
  tools: number | null;
}

export function parseClaudeRuntimeSessionInfo(rawLine: string): ClaudeRuntimeSessionInfo | null {
  const line = rawLine.trim();
  if (!line.startsWith("{")) return null;
  try {
    const payload = JSON.parse(line) as Record<string, unknown>;
    const type = typeof payload.type === "string" ? payload.type : "";
    const subtype = typeof payload.subtype === "string" ? payload.subtype : "";
    if (type !== "system" || subtype !== "init") return null;
    const sidRaw = payload.session_id ?? payload.sessionId;
    const sessionId = typeof sidRaw === "string" ? sidRaw.trim() : "";
    if (!sessionId) return null;
    const model = typeof payload.model === "string" ? payload.model.trim() || null : null;
    const cwd = typeof payload.cwd === "string" ? payload.cwd.trim() || null : null;
    const tools = Array.isArray(payload.tools) ? payload.tools.length : null;
    return { sessionId, model, cwd, tools };
  } catch {
    return null;
  }
}

export function formatClaudeRuntimeSessionInfo(info: ClaudeRuntimeSessionInfo): string {
  const lines = [
    "Claude Code 会话已启动",
    `- session_id: ${info.sessionId}`,
    `- model: ${info.model ?? "未知"}`,
    `- cwd: ${info.cwd ?? "未知"}`,
  ];
  if (typeof info.tools === "number") {
    lines.push(`- tools: ${info.tools}`);
  }
  return lines.join("\n");
}

export function stripEmbeddedTaskAnchorsFromRequirementMarkdown(markdown: string): string {
  return markdown
    .replace(/\n{0,2}>\s*任务锚点：[^\n]*(?=\n|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export const API_METHOD_OPTIONS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
export const TASK_AI_DEFAULT_PROMPT_BY_MODE: Record<TaskAiMode, string> = {
  optimize: [
    "请优化当前任务内容，保持业务目标不变。",
    "重点补强：结构清晰度、执行步骤、验收标准（DoD）与风险提示。",
    "输出仅返回可直接替换的任务 markdown 正文，不要解释。",
  ].join("\n"),
  check: [
    "请检查当前任务是否具备可执行前置条件。",
    "结合仓库上下文判断缺失项，并给出按优先级排序的补充建议。",
    "输出请包含：可执行结论、缺失前置条件、建议补充。",
  ].join("\n"),
};

/** 与右侧任务 id 对应：task-72 → "72"，task-5-1 → "5-1"。 */
export function anchorLabelFromTaskId(taskId: string): string {
  const trimmed = taskId.trim();
  const m = /^task-(\d+)(?:-(\d+))?$/.exec(trimmed);
  if (m) {
    return m[2] ? `${m[1]}-${m[2]}` : m[1]!;
  }
  const tail = trimmed.replace(/^task-/i, "");
  return tail.length > 0 ? tail : trimmed;
}

function buildEndpointSlugFromTitle(title: string): string {
  const cleaned = title
    .replace(/^接口协议定义[:：]\s*/, "")
    .replace(/^前端实现[:：]\s*/, "")
    .replace(/^后端实现[:：]\s*/, "")
    .replace(/^联调验收[:：]\s*/, "")
    .trim();
  const slug = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "feature";
}

export function buildApiSpecTemplate(task: TaskItem): TaskApiSpec {
  const endpointSlug = buildEndpointSlugFromTitle(task.title);
  return {
    endpoint: `/api/${endpointSlug}`,
    method: "POST",
    requestSchema: JSON.stringify({
      feature: task.title,
      payload: {},
    }, null, 2),
    responseSchema: JSON.stringify({
      code: 0,
      message: "ok",
      data: {},
    }, null, 2),
    errorCodes: ["400", "401", "500"],
  };
}

export function buildRequestSchemaByMethod(method: typeof API_METHOD_OPTIONS[number], title: string): string {
  if (method === "GET" || method === "DELETE") {
    return JSON.stringify({
      feature: title,
      query: {
        page: 1,
        pageSize: 20,
      },
    }, null, 2);
  }
  return JSON.stringify({
    feature: title,
    payload: {},
  }, null, 2);
}

export function normalizeJsonText(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

function normalizeLooseText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function includesLoosely(needle: string, haystack: string): boolean {
  const needleNormalized = normalizeLooseText(needle);
  const hayNormalized = normalizeLooseText(haystack);
  if (!needleNormalized || !hayNormalized) return false;
  if (hayNormalized.includes(needleNormalized) || needleNormalized.includes(hayNormalized)) return true;
  if (needleNormalized.length >= 8) {
    const prefix = needleNormalized.slice(0, Math.min(24, needleNormalized.length));
    if (hayNormalized.includes(prefix)) return true;
  }
  return false;
}

export function pickMostRelevantRequirementId(
  task: TaskItem,
  requirementContentById: Map<string, string>,
  preferredProbe?: string,
): string | null {
  const reqIds = (task.sourceRequirementIds ?? []).filter((id) => id.trim().length > 0);
  if (reqIds.length === 0) return null;
  if (reqIds.length === 1) return reqIds[0] ?? null;
  const probes = [
    preferredProbe ?? "",
    task.taskAnchors?.contextAfter ?? "",
    task.taskAnchors?.contextBefore ?? "",
    task.description ?? "",
    task.title ?? "",
  ].map((text) => text.trim()).filter((text) => text.length > 0);
  for (const probe of probes) {
    const matched = reqIds.find((id) => includesLoosely(probe, requirementContentById.get(id) ?? ""));
    if (matched) return matched;
  }
  return reqIds[0] ?? null;
}

export function parseTaskNumericOrdinal(taskId: string): number | null {
  const m = /^task-(\d+)$/.exec(taskId.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

let randomTaskIdFallbackNonce = 0;

function createRandomTaskId(usedIds: Set<string>): string {
  for (let i = 0; i < 24; i += 1) {
    const raw =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const id = `task-${raw}`;
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
  randomTaskIdFallbackNonce += 1;
  const fallbackId = `task-${Date.now().toString(36)}-${randomTaskIdFallbackNonce.toString(36)}`;
  usedIds.add(fallbackId);
  return fallbackId;
}

/** 将已确认的拆分任务复制为 `executableTasks` 行（新 id、依赖映射到同批生成 id、写入 splitSourceTaskId）。 */
export function buildExecutableTaskCopiesFromSplitSources(activeResult: SplitResult, sourceTasks: TaskItem[]): TaskItem[] {
  const usedTaskIds = new Set(allSplitResultTaskItems(activeResult).map((task) => task.id));
  const sourceToGeneratedId = new Map<string, string>();
  for (const sourceTask of sourceTasks) {
    sourceToGeneratedId.set(sourceTask.id, createRandomTaskId(usedTaskIds));
  }
  return sourceTasks.map((task) => {
    const nextId = sourceToGeneratedId.get(task.id) ?? createRandomTaskId(usedTaskIds);
    const nextDependencies = task.dependencies
      .map((depId) => sourceToGeneratedId.get(depId) ?? "")
      .filter((depId) => depId.length > 0 && depId !== nextId);
    return {
      ...task,
      id: nextId,
      dependencies: Array.from(new Set(nextDependencies)),
      flowStatus: "todo" as const,
      splitSourceTaskId: task.id,
    };
  });
}

export function defaultTaskConfirmFilterByTasks(tasks: TaskItem[]): TaskConfirmFilter {
  if (tasks.length === 0) return "unconfirmed";
  const confirmedCount = tasks.filter((task) => (task.executionStatus ?? "not_executable") === "executable").length;
  return confirmedCount === tasks.length ? "confirmed" : "unconfirmed";
}

function buildStableAnchorHash(input: string): string {
  // FNV-1a 32-bit: 足够轻量且在前端环境可稳定复现
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildSelectionAnchorTextHash(
  text: string,
  from: number,
  to: number,
  contextBefore: string,
  contextAfter: string,
): string {
  const seed = [
    normalizeLooseText(text),
    normalizeLooseText(contextBefore),
    normalizeLooseText(contextAfter),
    String(Math.floor(from)),
    String(Math.floor(to)),
  ].join("|");
  return `sel-${buildStableAnchorHash(seed)}`;
}

export function mergeSplitResultsByAppend(base: SplitResult, incoming: SplitResult): SplitResult {
  const existingTasks = base.splitTasks;
  const startOrdinal = existingTasks
    .map((task) => parseTaskNumericOrdinal(task.id))
    .reduce((max: number, current) => {
      if (current == null) return max;
      return current > max ? current : max;
    }, 0);
  const incomingIdRemap = new Map<string, string>();
  incoming.splitTasks.forEach((task, index) => {
    const nextId = `task-${startOrdinal + index + 1}`;
    incomingIdRemap.set(task.id, nextId);
  });
  const remappedIncomingTasks = incoming.splitTasks.map((task) => {
    const nextId = incomingIdRemap.get(task.id) ?? task.id;
    const mappedDependencies = task.dependencies
      .map((depId) => incomingIdRemap.get(depId) ?? depId)
      .filter((depId) => depId !== nextId);
    const uniqueDependencies = Array.from(new Set(mappedDependencies));
    return {
      ...task,
      id: nextId,
      dependencies: uniqueDependencies,
    };
  });
  const mergedTaskIdSet = new Set<string>([
    ...existingTasks.map((task) => task.id),
    ...remappedIncomingTasks.map((task) => task.id),
  ]);
  const normalizedIncomingTasks = remappedIncomingTasks.map((task) => ({
    ...task,
    dependencies: task.dependencies.filter((depId) => mergedTaskIdSet.has(depId)),
  }));

  const remapAnchorRecord = <T extends Record<string, unknown>>(record: T | undefined): T | undefined => {
    if (!record) return undefined;
    const out: Record<string, unknown> = {};
    for (const [taskId, value] of Object.entries(record)) {
      const mappedTaskId = incomingIdRemap.get(taskId) ?? taskId;
      out[mappedTaskId] = value;
    }
    return Object.keys(out).length > 0 ? (out as T) : undefined;
  };

  const mergedClaueMapping = (() => {
    const baseLinks = base.claudeSplitMapping?.taskRequirementLinks ?? [];
    const incomingLinks = incoming.claudeSplitMapping?.taskRequirementLinks ?? [];
    const remappedIncomingLinks = incomingLinks
      .map((link) => ({
        ...link,
        taskId: incomingIdRemap.get(link.taskId) ?? link.taskId,
      }))
      .filter((link) => mergedTaskIdSet.has(link.taskId));
    const mergedLinks = [...baseLinks, ...remappedIncomingLinks];
    if (mergedLinks.length === 0) return undefined;
    return {
      version: 1 as const,
      taskRequirementLinks: mergedLinks,
      capturedAtMs: Date.now(),
      runId: incoming.claudeSplitMapping?.runId ?? base.claudeSplitMapping?.runId,
    };
  })();

  const merged: SplitResult = refreshSplitResultDerivedFields({
    ...base,
    context: incoming.context ?? base.context,
    splitTasks: [...existingTasks, ...normalizedIncomingTasks],
    executableTasks: base.executableTasks,
    taskAnchorDescriptors: {
      ...(base.taskAnchorDescriptors ?? {}),
      ...(remapAnchorRecord(incoming.taskAnchorDescriptors) ?? {}),
    },
    taskAnchorTexts: {
      ...(base.taskAnchorTexts ?? {}),
      ...(remapAnchorRecord(incoming.taskAnchorTexts) ?? {}),
    },
    taskAnchorPositions: {
      ...(base.taskAnchorPositions ?? {}),
      ...(remapAnchorRecord(incoming.taskAnchorPositions) ?? {}),
    },
    claudeSplitMapping: mergedClaueMapping,
  });

  // 只保留当前任务集引用到的锚点键，防止陈旧锚点残留。
  const pruneAnchorRecord = <T extends Record<string, unknown>>(record: T | undefined): T | undefined => {
    if (!record) return undefined;
    const out: Record<string, unknown> = {};
    for (const [taskId, value] of Object.entries(record)) {
      if (!mergedTaskIdSet.has(taskId)) continue;
      out[taskId] = value;
    }
    return Object.keys(out).length > 0 ? (out as T) : undefined;
  };

  return {
    ...merged,
    taskAnchorDescriptors: pruneAnchorRecord(merged.taskAnchorDescriptors),
    taskAnchorTexts: pruneAnchorRecord(merged.taskAnchorTexts),
    taskAnchorPositions: pruneAnchorRecord(merged.taskAnchorPositions),
  };
}

export function estimateDaysFromSize(size: TaskSize): number {
  if (size === "S") return 1;
  if (size === "M") return 2;
  return 4;
}

export function sameApiSpec(a: TaskApiSpec | undefined, b: TaskApiSpec | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.endpoint !== b.endpoint) return false;
  if (a.method !== b.method) return false;
  if (a.requestSchema !== b.requestSchema) return false;
  if (a.responseSchema !== b.responseSchema) return false;
  if (a.errorCodes.length !== b.errorCodes.length) return false;
  for (let i = 0; i < a.errorCodes.length; i += 1) {
    if (a.errorCodes[i] !== b.errorCodes[i]) return false;
  }
  return true;
}

export function taskToMarkdown(task: TaskItem): string {
  const taskDescription = task.description.trim();
  const subtaskLines = task.subtasks;
  const dodLines = task.dod;
  return [
    "#### 任务内容",
    taskDescription,
    "",
    ...(task.apiSpec
      ? [
        "#### 接口协议",
        `- 接口路径：${task.apiSpec.endpoint}`,
        `- 请求方法：${task.apiSpec.method}`,
        `- 请求定义：${task.apiSpec.requestSchema}`,
        `- 响应定义：${task.apiSpec.responseSchema}`,
        `- 错误码：${task.apiSpec.errorCodes.join(", ") || "无"}`,
        "",
      ]
      : []),
    "#### 子任务",
    ...subtaskLines.map((item) => `- ${item}`),
    "",
    "#### 验收标准（DoD）",
    ...dodLines.map((item) => `- ${item}`),
  ].join("\n");
}

export function parseTaskMarkdownDraft(
  markdown: string,
): Pick<TaskItem, "description" | "subtasks" | "dod"> & { apiSpec?: TaskApiSpec } {
  const lines = markdown.split(/\r?\n/);
  type Section = "none" | "description" | "api" | "subtasks" | "dod";
  let section: Section = "none";
  const descriptionLines: string[] = [];
  const apiLines: string[] = [];
  const subtaskLines: string[] = [];
  const dodLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^####\s*任务内容/.test(trimmed)) {
      section = "description";
      continue;
    }
    if (/^####\s*接口协议/.test(trimmed)) {
      section = "api";
      continue;
    }
    if (/^####\s*子任务/.test(trimmed)) {
      section = "subtasks";
      continue;
    }
    if (/^####\s*验收标准/.test(trimmed)) {
      section = "dod";
      continue;
    }
    if (section === "description") descriptionLines.push(line);
    if (section === "api") apiLines.push(line);
    if (section === "subtasks") subtaskLines.push(line);
    if (section === "dod") dodLines.push(line);
  }

  const toList = (source: string[]): string[] =>
    source
      .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
      .filter((line) => line.length > 0);

  const pickApi = (label: string): string => {
    const row = apiLines.find((line) => new RegExp(`^\\s*[-*]?\\s*${label}\\s*[：:]`).test(line.trim()));
    if (!row) return "";
    return row.replace(new RegExp(`^\\s*[-*]?\\s*${label}\\s*[：:]\\s*`), "").trim();
  };

  const methodRaw = pickApi("请求方法").toUpperCase();
  const method = API_METHOD_OPTIONS.find((item) => item === methodRaw) ?? "POST";
  const endpoint = pickApi("接口路径");
  const requestSchema = pickApi("请求定义");
  const responseSchema = pickApi("响应定义");
  const errorCodesRaw = pickApi("错误码");
  const errorCodes = errorCodesRaw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== "无");
  const hasApiSpec = [endpoint, requestSchema, responseSchema, errorCodesRaw].some((item) => item.trim().length > 0);

  return {
    description: descriptionLines.join("\n").trim(),
    subtasks: toList(subtaskLines),
    dod: toList(dodLines),
    apiSpec: hasApiSpec
      ? {
        endpoint,
        method,
        requestSchema,
        responseSchema,
        errorCodes,
      }
      : undefined,
  };
}
