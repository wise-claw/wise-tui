import type {
  AssistantBundleItem,
  AssistantEngineeringPreferences,
  AssistantRuntimeBundle,
} from "../../services/assistantPromptLayers";
import type { AssistantBundleRef, AssistantEntry } from "../../types/assistant";

export function assistantRefsToBundleItems(
  refs: AssistantBundleRef[] | undefined,
  origin = "builtin",
): AssistantBundleItem[] {
  return (refs ?? []).map((ref) => ({
    id: ref.id,
    label: ref.label,
    origin,
    sourcePath: ref.sourcePath,
  }));
}

export function getEnabledBundleItems(bundle: AssistantRuntimeBundle): AssistantBundleItem[] {
  const disabled = new Set(bundle.disabled.map((id) => id.trim()).filter(Boolean));
  const out = new Map<string, AssistantBundleItem>();
  for (const item of bundle.custom) {
    if (!item.id || disabled.has(item.id)) continue;
    out.set(item.id, item);
  }
  return [...out.values()];
}

export function buildArtifactAssistantBrief(input: {
  assistant: Pick<AssistantEntry, "id" | "name" | "description" | "engineId">;
  activeProjectName: string | null;
  userRequest: string;
  engineering: AssistantEngineeringPreferences;
  enabledSkills: AssistantBundleItem[];
  enabledMcps: AssistantBundleItem[];
}): string {
  const request = input.userRequest.trim() || "请在这里补充要创建或编辑的产物需求。";
  const formatProfile = input.engineering.formatProfile?.trim() || "未配置;按助手默认质量标准执行。";
  const skills = formatBundleList(input.enabledSkills, "未启用 Skill;请先在助手设置中挂载。");
  const mcps = formatBundleList(input.enabledMcps, "未启用 MCP。");

  return [
    `# ${input.assistant.name} 执行 Brief`,
    "",
    "## 用户需求",
    request,
    "",
    "## 助手上下文",
    `- Assistant: ${input.assistant.name} (${input.assistant.id})`,
    `- Engine: ${input.assistant.engineId}`,
    `- Workspace: ${input.activeProjectName ?? "未绑定工作区;如需落盘到项目,先选择 Workspace。"}`,
    `- Description: ${input.assistant.description || "无"}`,
    "",
    "## 启用 Skills",
    skills,
    "",
    "## 启用 MCP",
    mcps,
    "",
    "## 格式偏好",
    formatProfile,
    "",
    "## 执行要求",
    "- 严格按照启用的 Skill 说明完成任务,不要绕过 Delivery Gate。",
    "- 如果需要写文件,优先写入当前 Wise Workspace 或用户明确指定的位置。",
    "- 开工前确认目标文件没有被系统应用占用。",
    "- 完成后说明输出路径、关键格式决策和验证结果。",
  ].join("\n");
}

function formatBundleList(items: AssistantBundleItem[], emptyText: string): string {
  if (items.length === 0) return `- ${emptyText}`;
  return items
    .map((item) => {
      const label = item.label && item.label !== item.id ? ` (${item.label})` : "";
      const path = item.sourcePath ? ` - ${item.sourcePath}` : "";
      return `- ${item.id}${label}${path}`;
    })
    .join("\n");
}
