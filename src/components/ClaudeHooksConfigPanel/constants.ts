import type { ClaudeHookHandler, ClaudeHookScopeData, ClaudeHooksStatusResponse } from "../../types";

export const EMPTY_SCOPE_DATA: ClaudeHookScopeData = {
  sourcePath: "",
  disableAllHooks: false,
  hooks: {},
};

export const EMPTY_DATA: ClaudeHooksStatusResponse = {
  user: EMPTY_SCOPE_DATA,
  project: EMPTY_SCOPE_DATA,
  local: EMPTY_SCOPE_DATA,
  omc: EMPTY_SCOPE_DATA,
};

export const HOOKS_FLOW_THEME_STORAGE_KEY = "wise.ui.hooks.flow-theme.v1";
export const HIDE_OMC_HOOKS_STORAGE_KEY = "wise.ui.hooks.hide-omc.v1";
export const LEGACY_APP_SETTING_KEY_HOOKS_FLOW_THEME = "wise-hooks-flow-theme";
export const LEGACY_APP_SETTING_KEY_HIDE_OMC_HOOKS = "wise-hide-omc-hooks";

export const SUPPORTED_HOOK_EVENTS = [
  "SessionStart",
  "Setup",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "Notification",
  "MessageDisplay",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "TeammateIdle",
  "InstructionsLoaded",
  "ConfigChange",
  "CwdChanged",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "PostCompact",
  "Elicitation",
  "ElicitationResult",
  "SessionEnd",
] as const;

export const MAIN_FLOW_STEPS: Array<{ eventName?: string; title: string; desc?: string }> = [
  { eventName: "Setup", title: "Setup", desc: "Setup / CI" },
  { eventName: "SessionStart", title: "SessionStart" },
  { eventName: "UserPromptSubmit", title: "UserPromptSubmit" },
  { eventName: "UserPromptExpansion", title: "UserPromptExpansion" },
  { eventName: "PreToolUse", title: "PreToolUse", desc: "Agentic Loop" },
  { eventName: "PermissionRequest", title: "PermissionRequest", desc: "Agentic Loop" },
  { title: "[tool executes]", desc: "Agentic Loop" },
  { eventName: "PostToolUse", title: "PostToolUse", desc: "Agentic Loop" },
  { eventName: "PostToolUseFailure", title: "PostToolUseFailure", desc: "Agentic Loop" },
  { eventName: "PostToolBatch", title: "PostToolBatch", desc: "Agentic Loop" },
  { eventName: "SubagentStart", title: "SubagentStart", desc: "Agentic Loop" },
  { eventName: "SubagentStop", title: "SubagentStop", desc: "Agentic Loop" },
  { eventName: "TaskCreated", title: "TaskCreated", desc: "Agentic Loop" },
  { eventName: "TaskCompleted", title: "TaskCompleted", desc: "Agentic Loop" },
  { eventName: "Stop", title: "Stop" },
  { eventName: "StopFailure", title: "StopFailure" },
  { eventName: "TeammateIdle", title: "TeammateIdle" },
  { eventName: "PreCompact", title: "PreCompact" },
  { eventName: "PostCompact", title: "PostCompact" },
  { eventName: "SessionEnd", title: "SessionEnd" },
];

export const SIDE_EVENTS: Array<{ title: string; eventName: string }> = [
  { title: "PermissionDenied", eventName: "PermissionDenied" },
  { title: "Elicitation", eventName: "Elicitation" },
  { title: "ElicitationResult", eventName: "ElicitationResult" },
  { title: "Notification", eventName: "Notification" },
  { title: "MessageDisplay", eventName: "MessageDisplay" },
  { title: "ConfigChange", eventName: "ConfigChange" },
  { title: "WorktreeCreate", eventName: "WorktreeCreate" },
  { title: "WorktreeRemove", eventName: "WorktreeRemove" },
  { title: "CwdChanged", eventName: "CwdChanged" },
  { title: "FileChanged", eventName: "FileChanged" },
  { title: "InstructionsLoaded", eventName: "InstructionsLoaded" },
];

export const EVENT_HELP_TEXT: Record<string, string> = {
  SessionStart: "会话开始或恢复时触发，常用于加载开发上下文或初始化环境。",
  Setup: "以 --init-only 或 -p 模式下 --init/--maintenance 启动时触发，用于 CI 或脚本的一次性环境准备。",
  UserPromptSubmit: "用户提交提示后、Claude 处理前触发，可做提示校验或补充上下文。",
  UserPromptExpansion: "用户输入的斜杠命令扩展为提示前触发，可阻止扩展或补充上下文；覆盖 PreToolUse 不涵盖的直接输入路径。",
  PreToolUse: "工具执行前触发，可允许、拒绝、询问或延迟此次工具调用。",
  PermissionRequest: "权限弹窗出现时触发，可自动允许或拒绝权限请求。",
  PermissionDenied: "自动模式拒绝工具调用时触发，可提示模型是否允许重试。",
  PostToolUse: "工具成功执行后触发，可做后处理或追加上下文。",
  PostToolUseFailure: "工具执行失败后触发，可记录错误并补充失败上下文。",
  PostToolBatch: "并行工具调用整批完成后、下一次模型请求前触发一次，适合注入依赖整批工具结果的上下文。",
  Notification: "Claude Code 发送通知时触发，适合做通知转发或审计。",
  MessageDisplay: "助手消息文本显示时触发，可通过 displayContent 替换屏幕呈现内容（不影响 Claude 与成绩单中的原始文本）。",
  SubagentStart: "子代理启动时触发，可向子代理注入额外上下文。",
  SubagentStop: "子代理结束时触发，可控制是否允许其停止。",
  TaskCreated: "TaskCreate 创建任务时触发，可校验命名与描述规范。",
  TaskCompleted: "任务标记完成时触发，可加质量门（如测试/lint）。",
  Stop: "Claude 完成本轮响应时触发，可阻止停止并要求继续工作。",
  StopFailure: "回合因 API 错误结束时触发，用于日志告警与恢复。",
  TeammateIdle: "队友代理即将空闲时触发，可要求继续执行任务。",
  InstructionsLoaded: "CLAUDE.md 或 rules 文件被加载进上下文时触发。",
  ConfigChange: "会话期间配置文件变化时触发，可审计或阻止变更生效。",
  CwdChanged: "当前工作目录变化时触发，常用于刷新目录相关环境。",
  FileChanged: "监视文件发生变更时触发，用于环境重载或自动处理。",
  WorktreeCreate: "创建 worktree 时触发，可替换默认 git worktree 行为。",
  WorktreeRemove: "删除 worktree 时触发，可执行清理逻辑。",
  PreCompact: "上下文压缩前触发，可阻止压缩或执行压缩前检查。",
  PostCompact: "上下文压缩后触发，可记录摘要并执行后续动作。",
  Elicitation: "MCP 请求用户输入时触发，可编程接管交互输入。",
  ElicitationResult: "用户对 MCP 输入响应后触发，可修改或拦截结果。",
  SessionEnd: "会话终止时触发，适合做收尾清理和统计。",
  HookScripts: "来自仓库 `.claude/hooks/` 目录的脚本；尚未在 settings.json 中注册时会在此展示。",
};

/** 官方文档支持的 hook 展示类型（含尚未在 Wise 编辑器中创建的 mcp_tool）。 */
export type HookDisplayType = ClaudeHookHandler["type"] | "mcp_tool";

const ALL_FIVE_HOOK_TYPES: HookDisplayType[] = ["command", "http", "mcp_tool", "prompt", "agent"];
const COMMAND_HTTP_MCP_HOOK_TYPES: HookDisplayType[] = ["command", "http", "mcp_tool"];
const COMMAND_MCP_HOOK_TYPES: HookDisplayType[] = ["command", "mcp_tool"];

const FULL_SUPPORT_EVENTS = [
  "PermissionDenied",
  "PermissionRequest",
  "PostToolBatch",
  "PostToolUse",
  "PostToolUseFailure",
  "PreToolUse",
  "Stop",
  "SubagentStop",
  "TaskCompleted",
  "TaskCreated",
  "TeammateIdle",
  "UserPromptExpansion",
  "UserPromptSubmit",
] as const;

const COMMAND_HTTP_MCP_EVENTS = [
  "ConfigChange",
  "CwdChanged",
  "Elicitation",
  "ElicitationResult",
  "FileChanged",
  "InstructionsLoaded",
  "MessageDisplay",
  "Notification",
  "PostCompact",
  "PreCompact",
  "SessionEnd",
  "StopFailure",
  "SubagentStart",
  "WorktreeCreate",
  "WorktreeRemove",
] as const;

const COMMAND_MCP_EVENTS = ["SessionStart", "Setup"] as const;

const EVENT_DISPLAY_SUPPORTED_TYPES: Record<string, HookDisplayType[]> = {};

for (const eventName of FULL_SUPPORT_EVENTS) {
  EVENT_DISPLAY_SUPPORTED_TYPES[eventName] = ALL_FIVE_HOOK_TYPES;
}
for (const eventName of COMMAND_HTTP_MCP_EVENTS) {
  EVENT_DISPLAY_SUPPORTED_TYPES[eventName] = COMMAND_HTTP_MCP_HOOK_TYPES;
}
for (const eventName of COMMAND_MCP_EVENTS) {
  EVENT_DISPLAY_SUPPORTED_TYPES[eventName] = COMMAND_MCP_HOOK_TYPES;
}

export function getDefaultDisplaySupportedTypes(): HookDisplayType[] {
  return ALL_FIVE_HOOK_TYPES;
}

export function getDisplaySupportedTypesMap(): Record<string, HookDisplayType[]> {
  return EVENT_DISPLAY_SUPPORTED_TYPES;
}

export function getDefaultEditableSupportedTypes(): ClaudeHookHandler["type"][] {
  return ["command", "http", "prompt", "agent"];
}

