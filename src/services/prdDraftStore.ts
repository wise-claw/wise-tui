import { invoke } from "@tauri-apps/api/core";
import { deleteAppSetting, getAppSettingJson, setAppSettingJson } from "./appSettingsStore";

export interface PrdDraftPayload {
  inputValue: string;
  /** 首次自动回填/重建前的原始需求正文（用于一键回退）。 */
  originalInputValue?: string | null;
  contextMode: "project" | "repository";
  linkedProjectId: string | null;
  linkedRepositoryId: number | null;
  /** 首次保存时由用户填写并持久化；有值后再次保存不再弹出命名框。 */
  requirementDisplayName?: string | null;
  /** 当前激活的需求 id。 */
  currentRequirementId?: string | null;
  /** 多需求历史列表（按更新时间倒序展示由前端控制）。 */
  requirements?: PrdRequirementHistoryItem[];
}

export interface PrdRequirementHistoryItem {
  id: string;
  requirementDisplayName: string;
  /** 是否置顶；全局仅允许一个 true。 */
  isPinned?: boolean;
  inputValue: string;
  originalInputValue?: string | null;
  contextMode: "project" | "repository";
  linkedProjectId: string | null;
  linkedRepositoryId: number | null;
  createdAt: number;
  updatedAt: number;
}

const DRAFT_KEY_PREFIX = "prd_task_draft:project:" as const;
/** 无项目上下文时的占位桶（与旧版未写 linkedProjectId 的草稿兼容） */
const DRAFT_KEY_NONE = `${DRAFT_KEY_PREFIX}__none__` as const;

function appSettingKeyForProjectScope(projectScopeId: string | null | undefined): string {
  const p = projectScopeId?.trim();
  return p && p.length > 0 ? `${DRAFT_KEY_PREFIX}${p}` : DRAFT_KEY_NONE;
}

function assertValidPrdDraftPayload(parsed: unknown): PrdDraftPayload | null {
  if (!parsed || typeof parsed !== "object") return null;
  const draft = parsed as PrdDraftPayload;
  if (typeof draft.inputValue !== "string") return null;
  if (
    draft.originalInputValue !== undefined &&
    draft.originalInputValue !== null &&
    typeof draft.originalInputValue !== "string"
  ) {
    return null;
  }
  if (draft.contextMode !== "project" && draft.contextMode !== "repository") return null;
  if (
    draft.requirementDisplayName !== undefined &&
    draft.requirementDisplayName !== null &&
    typeof draft.requirementDisplayName !== "string"
  ) {
    return null;
  }
  if (
    draft.currentRequirementId !== undefined &&
    draft.currentRequirementId !== null &&
    typeof draft.currentRequirementId !== "string"
  ) {
    return null;
  }
  if (draft.requirements !== undefined && draft.requirements !== null) {
    if (!Array.isArray(draft.requirements)) return null;
    for (const item of draft.requirements) {
      if (!item || typeof item !== "object") return null;
      if (typeof item.id !== "string" || !item.id.trim()) return null;
      if (typeof item.requirementDisplayName !== "string" || !item.requirementDisplayName.trim()) return null;
      if (item.isPinned !== undefined && typeof item.isPinned !== "boolean") return null;
      if (typeof item.inputValue !== "string") return null;
      if (
        item.originalInputValue !== undefined &&
        item.originalInputValue !== null &&
        typeof item.originalInputValue !== "string"
      ) {
        return null;
      }
      if (item.contextMode !== "project" && item.contextMode !== "repository") return null;
      if (item.linkedProjectId !== null && item.linkedProjectId !== undefined && typeof item.linkedProjectId !== "string") {
        return null;
      }
      if (item.linkedRepositoryId !== null && item.linkedRepositoryId !== undefined && typeof item.linkedRepositoryId !== "number") {
        return null;
      }
      if (typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt)) return null;
      if (typeof item.updatedAt !== "number" || !Number.isFinite(item.updatedAt)) return null;
    }
  }
  return draft;
}

function resolveRequirementProjectBucket(item: PrdRequirementHistoryItem, legacyRoot: PrdDraftPayload): string {
  const fromItem = item.linkedProjectId?.trim();
  if (fromItem) return fromItem;
  const fromRoot = legacyRoot.linkedProjectId?.trim();
  if (fromRoot) return fromRoot;
  return "__none__";
}

function pickPinnedOrLatest(requirements: PrdRequirementHistoryItem[]): PrdRequirementHistoryItem | null {
  if (requirements.length === 0) return null;
  const sorted = [...requirements].sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = sorted.find((r) => r.isPinned);
  return pinned ?? sorted[0] ?? null;
}

function buildPerProjectPayloadFromLegacy(legacy: PrdDraftPayload, projectBucket: string, items: PrdRequirementHistoryItem[]): PrdDraftPayload {
  const selected = pickPinnedOrLatest(items);
  const canonicalProjectId = projectBucket === "__none__" ? null : projectBucket;
  const normalizedItems = items.map((r) => ({
    ...r,
    linkedProjectId: canonicalProjectId ?? r.linkedProjectId,
  }));
  if (!selected) {
    return {
      inputValue: legacy.inputValue,
      originalInputValue: legacy.originalInputValue ?? null,
      contextMode: legacy.contextMode,
      linkedProjectId: canonicalProjectId ?? legacy.linkedProjectId ?? null,
      linkedRepositoryId: legacy.linkedRepositoryId ?? null,
      requirementDisplayName: legacy.requirementDisplayName ?? null,
      currentRequirementId: legacy.currentRequirementId ?? null,
      requirements: normalizedItems,
    };
  }
  return {
    inputValue: selected.inputValue,
    originalInputValue: selected.originalInputValue ?? null,
    contextMode: selected.contextMode,
    linkedProjectId: canonicalProjectId ?? selected.linkedProjectId ?? null,
    linkedRepositoryId: selected.linkedRepositoryId ?? legacy.linkedRepositoryId ?? null,
    requirementDisplayName: selected.requirementDisplayName.trim(),
    currentRequirementId: selected.id,
    requirements: normalizedItems,
  };
}

let legacyMigrationAttempted = false;

async function migrateLegacyInvokeDraftIfNeeded(): Promise<void> {
  if (legacyMigrationAttempted) return;
  legacyMigrationAttempted = true;
  let legacy: PrdDraftPayload | null = null;
  try {
    legacy = await invoke<PrdDraftPayload | null>("get_prd_task_draft");
  } catch {
    return;
  }
  const valid = legacy ? assertValidPrdDraftPayload(legacy) : null;
  if (!valid) {
    return;
  }

  const reqs = valid.requirements ?? [];
  if (reqs.length === 0) {
    const bucket = valid.linkedProjectId?.trim() || "__none__";
    const payload = buildPerProjectPayloadFromLegacy(valid, bucket, []);
    await setAppSettingJson(appSettingKeyForProjectScope(bucket === "__none__" ? null : bucket), payload);
  } else {
    const groups = new Map<string, PrdRequirementHistoryItem[]>();
    for (const item of reqs) {
      const bucket = resolveRequirementProjectBucket(item, valid);
      const arr = groups.get(bucket) ?? [];
      arr.push(item);
      groups.set(bucket, arr);
    }
    for (const [bucket, list] of groups) {
      const payload = buildPerProjectPayloadFromLegacy(valid, bucket, list);
      await setAppSettingJson(appSettingKeyForProjectScope(bucket === "__none__" ? null : bucket), payload);
    }
  }
  try {
    await invoke("clear_prd_task_draft");
  } catch {
    /* 迁移后清理失败不阻塞读 */
  }
}

function attachProjectScopeToDraft(projectScopeId: string | null | undefined, payload: PrdDraftPayload): PrdDraftPayload {
  const pid = projectScopeId?.trim() || null;
  if (!pid) {
    return payload;
  }
  const nextReqs = (payload.requirements ?? []).map((r) => ({
    ...r,
    linkedProjectId: pid,
  }));
  return {
    ...payload,
    linkedProjectId: pid,
    requirements: nextReqs,
  };
}

/**
 * 按当前应用侧「项目」作用域加载 PRD 需求草稿（各项目独立存储）。
 * @param projectScopeId 通常为侧栏 `activeProjectId`；缺失时使用 `__none__` 桶（与旧数据迁移一致）。
 */
export async function loadPrdDraft(projectScopeId: string | null): Promise<PrdDraftPayload | null> {
  try {
    const key = appSettingKeyForProjectScope(projectScopeId);
    const scoped = await getAppSettingJson<unknown>(key);
    const scopedValid = scoped ? assertValidPrdDraftPayload(scoped) : null;
    if (scopedValid) return scopedValid;

    await migrateLegacyInvokeDraftIfNeeded();

    const afterMigrate = await getAppSettingJson<unknown>(key);
    return afterMigrate ? assertValidPrdDraftPayload(afterMigrate) : null;
  } catch {
    return null;
  }
}

/**
 * 将需求草稿保存到对应项目桶，并统一写入 `linkedProjectId` 与各条 `requirements[].linkedProjectId`。
 */
export async function savePrdDraft(projectScopeId: string | null, payload: PrdDraftPayload): Promise<void> {
  try {
    const normalized = attachProjectScopeToDraft(projectScopeId, payload);
    await setAppSettingJson(appSettingKeyForProjectScope(projectScopeId), normalized);
  } catch {
    // ignore persistence errors
  }
}

/** 清除指定项目下的需求草稿（应用设置键）。 */
export async function clearPrdDraftForProject(projectScopeId: string | null): Promise<void> {
  try {
    await deleteAppSetting(appSettingKeyForProjectScope(projectScopeId));
  } catch {
    // ignore
  }
}

export async function clearPrdDraft(): Promise<void> {
  try {
    await invoke("clear_prd_task_draft");
  } catch {
    // ignore
  }
  try {
    await deleteAppSetting(DRAFT_KEY_NONE);
  } catch {
    // ignore
  }
}
