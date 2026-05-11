import type { SplitPromptTemplate } from "./splitPromptTemplate";
import {
  getDefaultSplitPromptLayersBySlot,
  splitPromptLayersToFlatTemplate,
} from "./splitPromptTemplate";
import type { SplitPromptTemplateLayers } from "../types/splitPromptLayers";
import { SPLIT_PROMPT_STANDARD_VARIABLES } from "../types/splitPromptLayers";
import {
  loadPlatformSplitPromptLayers,
  loadProjectSplitPromptLayers,
  loadRepositorySplitPromptLayers,
} from "./splitPromptLayersStore";
import { parsePromptStorageRaw, PROMPT_SLOT_PRD_TASK_SPLIT } from "./splitPromptBundle";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 解析 app_settings 中保存的 JSON；字段可部分缺失。（不含多槽位 v2 包装，v2 请用 `parsePromptStorageRaw`。） */
export function parseSplitPromptLayersJson(raw: string | null | undefined): Partial<SplitPromptTemplateLayers> | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!isRecord(o)) return null;
    if (o.schemaVersion === 2) return null;
    const templateId = o.templateId;
    const version = o.version;
    const enabled = o.enabled;
    const systemBody = o.systemBody;
    const repoStrategyBody = o.repoStrategyBody;
    const userBody = o.userBody;
    const variables = o.variables;
    const out: Partial<SplitPromptTemplateLayers> = {};
    if (typeof templateId === "string") out.templateId = templateId;
    if (typeof version === "string") out.version = version;
    if (typeof enabled === "boolean") out.enabled = enabled;
    if (typeof systemBody === "string") out.systemBody = systemBody;
    if (typeof repoStrategyBody === "string") out.repoStrategyBody = repoStrategyBody;
    if (typeof userBody === "string") out.userBody = userBody;
    if (Array.isArray(variables) && variables.every((v) => typeof v === "string")) {
      out.variables = variables as string[];
    }
    return out;
  } catch {
    return null;
  }
}

function pickText(repo: string | undefined, proj: string | undefined, def: string): string {
  const r = repo?.trim();
  if (r) return r;
  const p = proj?.trim();
  if (p) return p;
  return def;
}

/**
 * 合并平台 / 项目 / 仓库三层（spec §3.1）。
 * 任一层 `enabled === false` 时整段回退为平台默认（不叠加自定义）。
 */
export function mergeSplitPromptLayers(
  platform: SplitPromptTemplateLayers,
  project: Partial<SplitPromptTemplateLayers> | null,
  repository: Partial<SplitPromptTemplateLayers> | null,
): SplitPromptTemplateLayers {
  if (repository?.enabled === false || project?.enabled === false) {
    return { ...platform, enabled: true };
  }
  const systemBody = pickText(repository?.systemBody, project?.systemBody, platform.systemBody);
  const repoStrategyBody = pickText(
    repository?.repoStrategyBody,
    project?.repoStrategyBody,
    platform.repoStrategyBody,
  );
  const userBody = pickText(repository?.userBody, project?.userBody, platform.userBody);
  const templateId = pickText(repository?.templateId, project?.templateId, platform.templateId);
  const version = pickText(repository?.version, project?.version, platform.version);
  const variables =
    (repository?.variables && repository.variables.length > 0
      ? repository.variables
      : project?.variables && project.variables.length > 0
        ? project.variables
        : platform.variables) ?? SPLIT_PROMPT_STANDARD_VARIABLES;
  return {
    templateId,
    version,
    enabled: true,
    systemBody,
    repoStrategyBody,
    userBody,
    variables,
  };
}

/** 合并后的分层稿（不折叠）：仓库节点用项目+仓库；仅项目节点只用项目覆盖。 */
export async function resolveMergedSplitPromptLayers(
  projectId: string | null,
  repositoryId: number | null,
  slotId: string = PROMPT_SLOT_PRD_TASK_SPLIT,
): Promise<SplitPromptTemplateLayers> {
  try {
    const defaultLayers = getDefaultSplitPromptLayersBySlot(slotId);
    const [platformRaw, projectRaw, repoRaw] = await Promise.all([
      loadPlatformSplitPromptLayers(),
      projectId ? loadProjectSplitPromptLayers(projectId) : Promise.resolve(null),
      repositoryId != null ? loadRepositorySplitPromptLayers(repositoryId) : Promise.resolve(null),
    ]);
    const platformMap = parsePromptStorageRaw(platformRaw);
    const platformDbPartial = platformMap[slotId] ?? null;
    const platformLayers = mergeSplitPromptLayers(
      defaultLayers,
      platformDbPartial,
      null,
    );

    const projectMap = parsePromptStorageRaw(projectRaw);
    const repoMap = parsePromptStorageRaw(repoRaw);
    const project = projectMap[slotId] ?? null;
    const repo = repositoryId != null ? (repoMap[slotId] ?? null) : null;
    return mergeSplitPromptLayers(
      platformLayers,
      project,
      repositoryId != null ? repo : null,
    );
  } catch {
    return { ...getDefaultSplitPromptLayersBySlot(slotId) };
  }
}

/** 供装配拆分包、预览等：按当前项目/仓库解析最终 `SplitPromptTemplate`。 */
export async function resolveEffectiveSplitPromptTemplate(
  projectId: string | null,
  repositoryId: number | null,
  slotId: string = PROMPT_SLOT_PRD_TASK_SPLIT,
): Promise<SplitPromptTemplate> {
  try {
    const merged = await resolveMergedSplitPromptLayers(projectId, repositoryId, slotId);
    return splitPromptLayersToFlatTemplate(merged);
  } catch {
    return splitPromptLayersToFlatTemplate(getDefaultSplitPromptLayersBySlot(slotId));
  }
}

/** 将编辑器状态序列化为可写入的完整 JSON 文档。 */
export function serializeSplitPromptLayers(layers: SplitPromptTemplateLayers): string {
  return JSON.stringify(
    {
      templateId: layers.templateId,
      version: layers.version,
      enabled: layers.enabled,
      systemBody: layers.systemBody,
      repoStrategyBody: layers.repoStrategyBody,
      userBody: layers.userBody,
      variables: [...layers.variables],
    },
    null,
    2,
  );
}

/** 新建覆盖层时的初始稿（空串表示继承下层）。 */
export function createEmptySplitPromptLayersDraft(
  overrides: Partial<SplitPromptTemplateLayers> = {},
): SplitPromptTemplateLayers {
  return {
    templateId: overrides.templateId ?? "custom",
    version: overrides.version ?? "1.0.0",
    enabled: overrides.enabled ?? true,
    systemBody: overrides.systemBody ?? "",
    repoStrategyBody: overrides.repoStrategyBody ?? "",
    userBody: overrides.userBody ?? "",
    variables: overrides.variables?.length
      ? overrides.variables
      : [...SPLIT_PROMPT_STANDARD_VARIABLES],
  };
}

/** 将持久化的部分字段展开为完整分层对象（供表单编辑）。 */
export function splitPromptLayersDraftFromPartial(
  partial: Partial<SplitPromptTemplateLayers> | null,
): SplitPromptTemplateLayers {
  const empty = createEmptySplitPromptLayersDraft();
  if (!partial) return empty;
  return {
    templateId: partial.templateId?.trim() || empty.templateId,
    version: partial.version?.trim() || empty.version,
    enabled: partial.enabled ?? empty.enabled,
    systemBody: partial.systemBody ?? "",
    repoStrategyBody: partial.repoStrategyBody ?? "",
    userBody: partial.userBody ?? "",
    variables: partial.variables?.length ? [...partial.variables] : [...empty.variables],
  };
}
