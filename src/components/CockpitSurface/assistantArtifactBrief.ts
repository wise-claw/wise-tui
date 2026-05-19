import type {
  AssistantBundleItem,
  AssistantEngineeringPreferences,
  AssistantRuntimeBundle,
} from "../../services/assistantPromptLayers";
import type { AssistantBundleRef, AssistantEntry } from "../../types/assistant";
import { resolveAssistantKind } from "./assistantKind";

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
  const assistantKind = resolveAssistantKind({
    id: input.assistant.id,
    defaultWorkflows: [],
    defaultSkills: input.enabledSkills.map((skill) => ({ id: skill.id, label: skill.label })),
  });
  const artifactRequirements = buildArtifactRequirements(assistantKind);

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
    "## 产物要求",
    artifactRequirements,
    "",
    "## 执行要求",
    "- 严格按照启用的 Skill 说明完成任务,不要绕过 Delivery Gate。",
    "- 如果需要写文件,优先写入当前 Wise Workspace 或用户明确指定的位置。",
    "- 开工前确认目标文件没有被系统应用占用。",
    "- 完成后说明输出路径、关键格式决策和验证结果。",
  ].join("\n");
}

function buildArtifactRequirements(kind: ReturnType<typeof resolveAssistantKind>): string {
  switch (kind) {
    case "office-doc":
      return [
        "- 必须使用 `officecli-docx` Skill 创建、读取、编辑或验证文档。",
        "- 交付物必须是 `.docx` 文件;需要预览时可补充 HTML/render-check,但不能替代 DOCX。",
        "- 文档结构、标题层级、表格、页眉页脚、页码和模板约束都是交付质量的一部分。",
      ].join("\n");
    case "office-deck":
      return [
        "- 必须使用 `officecli-pptx` Skill 创建、读取、编辑或验证演示稿。",
        "- 交付物必须是 `.pptx` 文件;需要预览时可补充逐页 render-check,但不能替代 PPTX。",
        "- 每页要有明确观点、可读排版和视觉检查;避免占位符、溢出和低对比文本。",
      ].join("\n");
    default:
      return "- 按启用 Skill 的交付物格式执行;如格式不明确,开工前先确认。";
  }
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
