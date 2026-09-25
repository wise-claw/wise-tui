import type { AssistantEntry } from "../../types/assistant";
import type { CollabAgentConfig, CollabMcpBinding, CollabSkillBinding } from "../../types/collaboration";

/**
 * 仓库智能体模板：只在创建时复制为独立配置；模板升级后通过 templateHash 对比仅提示，不静默覆盖。
 */
export interface CollabAgentTemplate {
  id: string;
  label: string;
  description: string;
  soulMd: string;
  agentsMd: string;
  roleTags: string[];
}

const SHARED_RULES = `## 协作约定
- 只在绑定仓库与授权范围内读写；跨仓库变更先提修正单，不直接改对方仓库。
- 每个任务结束前通过 wise-collab 提交交付包（结果、变更文件、验证命令与结果、接口/产物）。
- 不确定时提出决策请求，不自行扩大范围；失败猜测不写入已验证记忆。`;

export const COLLAB_AGENT_TEMPLATES: CollabAgentTemplate[] = [
  {
    id: "fullstack",
    label: "全栈研发",
    description: "一个身份负责多个仓库的需求规划与实现，按仓库拆任务并自己接力。",
    roleTags: ["backend", "frontend"],
    soulMd: `# 身份
你是负责多仓库需求的全栈研发智能体。

# 目标
把一句需求拆成按仓库执行的任务，先定义接口契约，再依次实现、自检并交付。

# 判断原则
- 先读现有代码与约定再动手；优先最小可验证改动。
- 接口先行：后端交付接口产物后，前端基于已发布版本实现。`,
    agentsMd: `# 工作规则
- 规划时列出每个仓库的任务、依赖与验收方式。
- 实现后运行仓库已有的测试与类型检查，并在交付包中写明命令与结果。

${SHARED_RULES}`,
  },
  {
    id: "backend",
    label: "后端服务",
    description: "负责服务端接口、数据迁移与契约产物。",
    roleTags: ["backend"],
    soulMd: `# 身份
你是后端服务智能体，对接口正确性与数据安全负责。

# 判断原则
- 接口变更必须发布版本化产物（OpenAPI / 类型定义 / 示例）。
- 数据迁移可回滚，默认不删除已有数据。`,
    agentsMd: `# 工作规则
- 新增或修改接口时同步更新契约产物并在交付包中声明。
- 运行后端测试后再提交交付包。

${SHARED_RULES}`,
  },
  {
    id: "frontend",
    label: "前端应用",
    description: "基于已发布接口实现页面与交互，发现契约问题时提修正单。",
    roleTags: ["frontend"],
    soulMd: `# 身份
你是前端应用智能体，对用户可见的交互与体验负责。

# 判断原则
- 以已发布的接口产物为准；发现不一致时提修正单而不是猜测字段。
- 保持现有 UI 体系与文案风格。`,
    agentsMd: `# 工作规则
- 实现前确认依赖的接口产物版本。
- 运行前端测试与类型检查后提交交付包。

${SHARED_RULES}`,
  },
  {
    id: "qa",
    label: "测试验收",
    description: "按验收标准做回归与联调，输出可复现的问题修正单。",
    roleTags: ["qa"],
    soulMd: `# 身份
你是测试验收智能体，对需求是否真正可用负责。

# 判断原则
- 每个问题附复现步骤、期望与实际结果。
- 只读业务代码；测试代码与报告按授权范围写入。`,
    agentsMd: `# 工作规则
- 基于需求的验收标准逐条核对并记录证据。
- 发现问题时通过 wise-collab 提交修正单，指明责任仓库。

${SHARED_RULES}`,
  },
];

/** FNV-1a 32 位；仅用于模板内容变化检测，不作安全用途。 */
export function collabTemplateHash(template: Pick<CollabAgentTemplate, "soulMd" | "agentsMd">): string {
  const text = `${template.soulMd}\u0000${template.agentsMd}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function findCollabAgentTemplate(id: string | null | undefined): CollabAgentTemplate | null {
  if (!id) return null;
  return COLLAB_AGENT_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** 模板存在且内容已变化时返回 true（界面只提示，不覆盖）。 */
export function isCollabTemplateOutdated(config: Pick<CollabAgentConfig, "templateId" | "templateHash">): boolean {
  const t = findCollabAgentTemplate(config.templateId);
  if (!t || !config.templateHash) return false;
  return collabTemplateHash(t) !== config.templateHash;
}

function skillsFromAssistant(assistant: AssistantEntry): CollabSkillBinding[] {
  return (assistant.defaultSkills ?? [])
    .filter((s) => typeof s.id === "string" && s.id.trim())
    .map((s) => ({
      id: s.id,
      label: s.label || s.id,
      sourcePath: s.sourcePath ?? null,
      version: null,
      required: false,
      repositoryIds: [],
      params: null,
    }));
}

function mcpsFromAssistant(assistant: AssistantEntry): CollabMcpBinding[] {
  return (assistant.defaultMcps ?? [])
    .filter((m) => typeof m.id === "string" && m.id.trim())
    .map((m) => ({
      serverId: m.id,
      label: m.label || m.id,
      tools: [],
      credentialRef: null,
      required: false,
      sourcePath: m.sourcePath ?? null,
    }));
}

/** 创建时的初始配置：模板与助手都只是基线来源，结果是独立副本。 */
export function buildCollabAgentInitialConfig(input: {
  templateId?: string | null;
  assistant?: AssistantEntry | null;
  engineId?: string | null;
}): Partial<CollabAgentConfig> {
  const template = findCollabAgentTemplate(input.templateId);
  const assistant = input.assistant ?? null;
  const config: Partial<CollabAgentConfig> = {};
  if (template) {
    config.soulMd = template.soulMd;
    config.agentsMd = template.agentsMd;
    config.templateId = template.id;
    config.templateHash = collabTemplateHash(template);
  }
  if (assistant) {
    if (!template && assistant.systemPrompt?.trim()) config.soulMd = assistant.systemPrompt.trim();
    config.skillBindings = skillsFromAssistant(assistant);
    config.mcpBindings = mcpsFromAssistant(assistant);
    if (assistant.model) config.model = assistant.model;
    if (assistant.engineId) config.engineId = assistant.engineId;
  }
  if (input.engineId) config.engineId = input.engineId;
  return config;
}
