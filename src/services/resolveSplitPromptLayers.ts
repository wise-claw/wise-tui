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
import {
  DEFAULT_PRD_SPLIT_ASSISTANT_ID,
  resolveAssistantRuntime,
} from "./assistantPromptLayers";

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

/** 合并后的分层稿（不折叠）：assistant 层(含项目/仓库 override)叠在平台默认上。
 *
 * 数据来源(2026-05-18 修订,migration 029 把旧 app_settings 行搬入 assistant_overrides):
 *   - 平台默认 = 前端硬编码 `DEFAULT_SPLIT_PROMPT_*_LAYERS`(参与占位符替换);
 *   - 助手层 / 项目层 / 仓库层 = `assistants_resolve_runtime` 一次性返回 merge 后的 prompt bundle。
 *
 * `assistantId` 默认 `builtin:prd-split`,等价旧行为(项目/仓库覆盖关联到内置助手)。
 */
export async function resolveMergedSplitPromptLayers(
  projectId: string | null,
  repositoryId: number | null,
  slotId: string = PROMPT_SLOT_PRD_TASK_SPLIT,
  assistantId: string = DEFAULT_PRD_SPLIT_ASSISTANT_ID,
): Promise<SplitPromptTemplateLayers> {
  try {
    const defaultLayers = getDefaultSplitPromptLayersBySlot(slotId);
    const [platformRaw, runtime] = await Promise.all([
      loadPlatformSplitPromptLayers(),
      resolveAssistantRuntime({
        assistantId,
        projectId,
        repositoryId,
      }).catch(() => null),
    ]);
    const platformMap = parsePromptStorageRaw(platformRaw);
    const platformDbPartial = platformMap[slotId] ?? null;
    const platformLayers = mergeSplitPromptLayers(
      defaultLayers,
      platformDbPartial,
      null,
    );

    if (!runtime) {
      // 退化:沿用旧路径(读 app_settings)。
      const [projectRaw, repoRaw] = await Promise.all([
        projectId ? loadProjectSplitPromptLayers(projectId) : Promise.resolve(null),
        repositoryId != null
          ? loadRepositorySplitPromptLayers(repositoryId)
          : Promise.resolve(null),
      ]);
      const projectMap = parsePromptStorageRaw(projectRaw);
      const repoMap = parsePromptStorageRaw(repoRaw);
      return mergeSplitPromptLayers(
        platformLayers,
        projectMap[slotId] ?? null,
        repositoryId != null ? (repoMap[slotId] ?? null) : null,
      );
    }

    const assistantMap = parsePromptStorageRaw(runtime.promptBundleJson);
    const assistantSlot = assistantMap[slotId] ?? null;
    // assistants_resolve_runtime 已合并 assistant + project + repository 三层;
    // 这里再叠到平台默认上,字段非空者覆盖平台默认。第三参数填 null 是因为
    // 项目/仓库已经被 Rust 端合并进 assistantSlot 了。
    return mergeSplitPromptLayers(platformLayers, assistantSlot, null);
  } catch {
    return { ...getDefaultSplitPromptLayersBySlot(slotId) };
  }
}

/** 供装配拆分包、预览等：按当前项目/仓库解析最终 `SplitPromptTemplate`。 */
export async function resolveEffectiveSplitPromptTemplate(
  projectId: string | null,
  repositoryId: number | null,
  slotId: string = PROMPT_SLOT_PRD_TASK_SPLIT,
  assistantId: string = DEFAULT_PRD_SPLIT_ASSISTANT_ID,
): Promise<SplitPromptTemplate> {
  try {
    const merged = await resolveMergedSplitPromptLayers(
      projectId,
      repositoryId,
      slotId,
      assistantId,
    );
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
