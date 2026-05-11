/**
 * 项目/仓库提示词持久化：支持多「用途」槽位（schema v2），兼容旧版单层 JSON（v1）。
 */

import type { SplitPromptTemplateLayers } from "../types/splitPromptLayers";

export const PROMPT_SLOT_PRD_TASK_SPLIT = "prdTaskSplit" as const;
export const PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1 = "prdTaskSplitPhase1" as const;
export const PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2 = "prdTaskSplitPhase2" as const;

export type BuiltinPromptSlotId =
  | typeof PROMPT_SLOT_PRD_TASK_SPLIT
  | typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1
  | typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2;

export const PROMPT_SLOT_PRESETS: readonly { id: string; label: string }[] = [
  { id: PROMPT_SLOT_PRD_TASK_SPLIT, label: "PRD 任务拆分" },
  { id: PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1, label: "PRD 拆分（阶段1）" },
  { id: PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2, label: "PRD 溯源映射（阶段2）" },
] as const;

export function isBuiltinPromptSlot(slotId: string): boolean {
  return PROMPT_SLOT_PRESETS.some((p) => p.id === slotId);
}

const SCHEMA_V2 = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从任意对象提取分层字段（与 `parseSplitPromptLayersJson` 字段一致）。 */
export function partialLayersFromRecord(o: unknown): Partial<SplitPromptTemplateLayers> | null {
  if (!isRecord(o)) return null;
  const out: Partial<SplitPromptTemplateLayers> = {};
  if (typeof o.templateId === "string") out.templateId = o.templateId;
  if (typeof o.version === "string") out.version = o.version;
  if (typeof o.enabled === "boolean") out.enabled = o.enabled;
  if (typeof o.systemBody === "string") out.systemBody = o.systemBody;
  if (typeof o.repoStrategyBody === "string") out.repoStrategyBody = o.repoStrategyBody;
  if (typeof o.userBody === "string") out.userBody = o.userBody;
  if (Array.isArray(o.variables) && o.variables.every((v) => typeof v === "string")) {
    out.variables = o.variables as string[];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 解析存储中的 JSON：v2 为 `{ schemaVersion, prompts }`；v1 为单层 `SplitPromptTemplateLayers` 对象，归入 `prdTaskSplit`。
 */
export function parsePromptStorageRaw(raw: string | null | undefined): Record<string, Partial<SplitPromptTemplateLayers>> {
  if (!raw?.trim()) return {};
  try {
    const root = JSON.parse(raw) as unknown;
    if (!isRecord(root)) return {};
    if (root.schemaVersion === SCHEMA_V2 && isRecord(root.prompts)) {
      const out: Record<string, Partial<SplitPromptTemplateLayers>> = {};
      for (const [slotId, value] of Object.entries(root.prompts)) {
        const id = slotId.trim();
        if (!id) continue;
        const partial = partialLayersFromRecord(value);
        if (partial) out[id] = partial;
      }
      return out;
    }
    const legacy = partialLayersFromRecord(root);
    if (legacy) return { [PROMPT_SLOT_PRD_TASK_SPLIT]: legacy };
    return {};
  } catch {
    return {};
  }
}

export function serializePromptBundle(slots: Record<string, SplitPromptTemplateLayers>): string {
  return JSON.stringify({ schemaVersion: SCHEMA_V2, prompts: slots }, null, 2);
}

export function presetSlotLabel(slotId: string): string {
  const hit = PROMPT_SLOT_PRESETS.find((p) => p.id === slotId);
  return hit?.label ?? slotId;
}

const SLOT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function isPromptSlotIdSyntaxValid(id: string): boolean {
  return SLOT_ID_RE.test(id.trim());
}

/** 生成随机用途 slot id：`p` + 32 位十六进制，满足 `isPromptSlotIdSyntaxValid`。 */
export function generatePromptSlotId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `p${hex}`;
}

/** 在已有键中分配未占用的 slot id（极低概率碰撞时会重试）。 */
export function allocatePromptSlotId(existingKeys: Iterable<string>): string {
  const set = new Set(existingKeys);
  for (let i = 0; i < 64; i++) {
    const id = generatePromptSlotId();
    if (!set.has(id)) return id;
  }
  throw new Error("allocatePromptSlotId: exhausted retries");
}

/**
 * 列表/弹窗展示名：内置用途用预设文案；否则取 `systemBody` 首条非空行若为 `## 标题` 则用标题；
 * 否则回退为 slotId。
 */
export function slotPromptPurposeLabel(
  slotId: string,
  partial?: Partial<SplitPromptTemplateLayers> | null,
): string {
  const preset = PROMPT_SLOT_PRESETS.find((p) => p.id === slotId);
  if (preset) return preset.label;
  for (const raw of (partial?.systemBody ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      const t = m[1].trim();
      return t || slotId;
    }
    break;
  }
  return slotId;
}

/** 合并预设 id 与若干映射中的槽位 id，预设优先靠前。 */
export function collectPromptSlotIds(
  ...maps: readonly Record<string, Partial<SplitPromptTemplateLayers>>[]
): string[] {
  const set = new Set<string>();
  for (const p of PROMPT_SLOT_PRESETS) set.add(p.id);
  for (const m of maps) {
    for (const k of Object.keys(m)) set.add(k);
  }
  const presetOrder = PROMPT_SLOT_PRESETS.map((p) => p.id);
  const rest = [...set].filter((id) => !presetOrder.includes(id)).sort();
  return [...presetOrder.filter((id) => set.has(id)), ...rest];
}
