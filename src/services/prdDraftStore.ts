import { invoke } from "@tauri-apps/api/core";

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

export async function loadPrdDraft(): Promise<PrdDraftPayload | null> {
  try {
    const parsed = await invoke<PrdDraftPayload | null>("get_prd_task_draft");
    if (!parsed) return null;
    if (typeof parsed.inputValue !== "string") return null;
    if (parsed.originalInputValue !== undefined && parsed.originalInputValue !== null && typeof parsed.originalInputValue !== "string") {
      return null;
    }
    if (parsed.contextMode !== "project" && parsed.contextMode !== "repository") return null;
    if (
      parsed.requirementDisplayName !== undefined &&
      parsed.requirementDisplayName !== null &&
      typeof parsed.requirementDisplayName !== "string"
    ) {
      return null;
    }
    if (
      parsed.currentRequirementId !== undefined &&
      parsed.currentRequirementId !== null &&
      typeof parsed.currentRequirementId !== "string"
    ) {
      return null;
    }
    if (parsed.requirements !== undefined && parsed.requirements !== null) {
      if (!Array.isArray(parsed.requirements)) return null;
      for (const item of parsed.requirements) {
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
        if (item.linkedProjectId !== null && item.linkedProjectId !== undefined && typeof item.linkedProjectId !== "string") return null;
        if (item.linkedRepositoryId !== null && item.linkedRepositoryId !== undefined && typeof item.linkedRepositoryId !== "number") return null;
        if (typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt)) return null;
        if (typeof item.updatedAt !== "number" || !Number.isFinite(item.updatedAt)) return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function savePrdDraft(payload: PrdDraftPayload): Promise<void> {
  try {
    await invoke("set_prd_task_draft", { payload });
  } catch {
    // ignore persistence errors
  }
}

export async function clearPrdDraft(): Promise<void> {
  try {
    await invoke("clear_prd_task_draft");
  } catch {
    // ignore
  }
}
