import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, App, Button, Col, Empty, Form, Input, Modal, Row, Select, Space, Spin, Switch, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  ClaudeHookHandler,
  ClaudeHookSourceScope,
  ClaudeHooksStatusResponse,
  ClaudeHookScopeData,
} from "../types";
import { getClaudeHooksStatus, removeClaudeHook, setClaudeDisableAllHooks, upsertClaudeHook } from "../services/claude";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";

const EMPTY_SCOPE_DATA: ClaudeHookScopeData = {
  sourcePath: "",
  disableAllHooks: false,
  hooks: {},
};

const EMPTY_DATA: ClaudeHooksStatusResponse = {
  user: EMPTY_SCOPE_DATA,
  project: EMPTY_SCOPE_DATA,
  local: EMPTY_SCOPE_DATA,
  omc: EMPTY_SCOPE_DATA,
};

const HOOKS_FLOW_THEME_STORAGE_KEY = "wise.ui.hooks.flow-theme.v1";
const HIDE_OMC_HOOKS_STORAGE_KEY = "wise.ui.hooks.hide-omc.v1";
const LEGACY_APP_SETTING_KEY_HOOKS_FLOW_THEME = "wise-hooks-flow-theme";
const LEGACY_APP_SETTING_KEY_HIDE_OMC_HOOKS = "wise-hide-omc-hooks";

type EditingTarget = {
  scope: ClaudeHookSourceScope;
  eventName: string;
  groupId: string;
  handlerId: string;
} | null;
type HookFlowEntry = {
  scope: ClaudeHookSourceScope;
  eventName: string;
  groupId: string;
  handlerId: string;
  matcher: string;
  type: ClaudeHookHandler["type"];
  summary: string;
};

interface Props {
  repositoryPath?: string;
  active?: boolean;
  /** 与右栏工具条搜索联动，筛选事件 / matcher / handler。 */
  listSearch?: string;
  onBindActions?: (actions: ClaudeHooksConfigPanelHandle | null) => void;
  onCountChange?: (count: number) => void;
}

export interface ClaudeHooksConfigPanelHandle {
  refresh: () => Promise<void>;
  openCreateModal: () => void;
}

type HooksFlowTheme = "neon-blue" | "cyber-purple" | "light-tech";

const SUPPORTED_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
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

const MAIN_FLOW_STEPS: Array<{ eventName?: string; title: string; desc?: string }> = [
  { eventName: "SessionStart", title: "SessionStart" },
  { eventName: "UserPromptSubmit", title: "UserPromptSubmit" },
  { eventName: "PreToolUse", title: "PreToolUse", desc: "Agentic Loop" },
  { eventName: "PermissionRequest", title: "PermissionRequest", desc: "Agentic Loop" },
  { title: "[tool executes]", desc: "Agentic Loop" },
  { eventName: "PostToolUse", title: "PostToolUse", desc: "Agentic Loop" },
  { eventName: "PostToolUseFailure", title: "PostToolUseFailure", desc: "Agentic Loop" },
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

const SIDE_EVENTS: Array<{ title: string; eventName: string }> = [
  { title: "PermissionDenied", eventName: "PermissionDenied" },
  { title: "Elicitation", eventName: "Elicitation" },
  { title: "ElicitationResult", eventName: "ElicitationResult" },
  { title: "Notification", eventName: "Notification" },
  { title: "ConfigChange", eventName: "ConfigChange" },
  { title: "WorktreeCreate", eventName: "WorktreeCreate" },
  { title: "WorktreeRemove", eventName: "WorktreeRemove" },
  { title: "CwdChanged", eventName: "CwdChanged" },
  { title: "FileChanged", eventName: "FileChanged" },
  { title: "InstructionsLoaded", eventName: "InstructionsLoaded" },
];

const EVENT_HELP_TEXT: Record<string, string> = {
  SessionStart: "会话开始或恢复时触发，常用于加载开发上下文或初始化环境。",
  UserPromptSubmit: "用户提交提示后、Claude 处理前触发，可做提示校验或补充上下文。",
  PreToolUse: "工具执行前触发，可允许、拒绝、询问或延迟此次工具调用。",
  PermissionRequest: "权限弹窗出现时触发，可自动允许或拒绝权限请求。",
  PermissionDenied: "自动模式拒绝工具调用时触发，可提示模型是否允许重试。",
  PostToolUse: "工具成功执行后触发，可做后处理或追加上下文。",
  PostToolUseFailure: "工具执行失败后触发，可记录错误并补充失败上下文。",
  Notification: "Claude Code 发送通知时触发，适合做通知转发或审计。",
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
};

function getHelpTextByTitle(title: string, eventName?: string): string {
  if (title.includes("PostToolUse / PostToolUseFailure")) {
    return `${EVENT_HELP_TEXT.PostToolUse} ${EVENT_HELP_TEXT.PostToolUseFailure}`;
  }
  if (title.includes("SubagentStart / SubagentStop")) {
    return `${EVENT_HELP_TEXT.SubagentStart} ${EVENT_HELP_TEXT.SubagentStop}`;
  }
  if (title.includes("Stop / StopFailure")) {
    return `${EVENT_HELP_TEXT.Stop} ${EVENT_HELP_TEXT.StopFailure}`;
  }
  if (eventName) return EVENT_HELP_TEXT[eventName] ?? "该流程说明暂未配置。";
  return "该步骤用于表示 Claude Code 生命周期中的中间过程。";
}

function HelpIcon({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip title={text} placement="topLeft">
      <span className={`app-hooks-flow-help-icon ${className ?? ""}`.trim()} aria-label="查看该事件说明">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M6.4 5.9c0-1 0.82-1.7 1.9-1.7 1.05 0 1.85 0.64 1.85 1.62 0 0.68-0.35 1.13-1.03 1.58-0.69 0.46-0.92 0.73-0.92 1.35v0.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <circle cx="8.2" cy="11.7" r="0.8" fill="currentColor" />
        </svg>
      </span>
    </Tooltip>
  );
}

const EVENT_SUPPORTED_TYPES: Record<string, ClaudeHookHandler["type"][]> = {
  SessionStart: ["command"],
  PermissionRequest: ["command", "http", "prompt", "agent"],
  PostToolUse: ["command", "http", "prompt", "agent"],
  PostToolUseFailure: ["command", "http", "prompt", "agent"],
  PreToolUse: ["command", "http", "prompt", "agent"],
  Stop: ["command", "http", "prompt", "agent"],
  SubagentStop: ["command", "http", "prompt", "agent"],
  TaskCompleted: ["command", "http", "prompt", "agent"],
  TaskCreated: ["command", "http", "prompt", "agent"],
  UserPromptSubmit: ["command", "http", "prompt", "agent"],
};

const COMMAND_HTTP_ONLY_EVENTS = [
  "ConfigChange",
  "CwdChanged",
  "Elicitation",
  "ElicitationResult",
  "FileChanged",
  "InstructionsLoaded",
  "Notification",
  "PermissionDenied",
  "PostCompact",
  "PreCompact",
  "SessionEnd",
  "StopFailure",
  "SubagentStart",
  "TeammateIdle",
  "WorktreeCreate",
  "WorktreeRemove",
] as const;

for (const eventName of COMMAND_HTTP_ONLY_EVENTS) {
  EVENT_SUPPORTED_TYPES[eventName] = ["command", "http"];
}

function getSupportedTypesByEvent(eventName?: string): ClaudeHookHandler["type"][] {
  if (!eventName) return ["command", "http", "prompt", "agent"];
  return EVENT_SUPPORTED_TYPES[eventName] ?? ["command", "http", "prompt", "agent"];
}

function getSupportedTypesText(eventName: string): string {
  return getSupportedTypesByEvent(eventName).join(" / ");
}

function handlerSummary(h: ClaudeHookHandler): string {
  if (h.type === "command") return h.command?.trim() || "(空命令)";
  if (h.type === "http") return h.url?.trim() || "(空 URL)";
  return h.prompt?.trim() || "(空 prompt)";
}

function HookScopeSection({
  scope,
  title,
  data,
  onCreate,
  onEdit,
  onDelete,
  onToggleDisableAll,
  sectionRef,
  onClone,
  keyword,
  readOnly = false,
}: {
  scope: ClaudeHookSourceScope | "omc";
  title: string;
  data: ClaudeHookScopeData;
  onCreate: (scope: ClaudeHookSourceScope, eventName: string, groupId: string) => void;
  onEdit: (scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => void;
  onDelete: (scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => void;
  onToggleDisableAll: (scope: ClaudeHookSourceScope, next: boolean) => void;
  sectionRef?: RefObject<HTMLElement | null>;
  onClone: (scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => void;
  keyword: string;
  readOnly?: boolean;
}) {
  const kw = keyword.trim().toLowerCase();
  const matchText = (text: string) => !kw || text.toLowerCase().includes(kw);
  const eventNames = Object.keys(data.hooks)
    .filter((eventName) => {
      if (!kw) return true;
      const groups = data.hooks[eventName] ?? [];
      if (matchText(eventName)) return true;
      return groups.some((group) => {
        if (matchText(group.matcher?.trim() || "*")) return true;
        return group.hooks.some((h) => {
          return (
            matchText(handlerSummary(h)) ||
            matchText(h.type) ||
            matchText(h.command ?? "") ||
            matchText(h.url ?? "")
          );
        });
      });
    })
    .sort((a, b) => a.localeCompare(b));

  function groupsForEvent(eventName: string) {
    const groupsRaw = data.hooks[eventName] ?? [];
    if (!kw) return groupsRaw;
    const eventHit = matchText(eventName);
    return groupsRaw
      .map((group) => {
        const matcherHit = matchText(group.matcher?.trim() || "*");
        const hooksFiltered = eventHit
          ? group.hooks
          : group.hooks.filter(
              (h) =>
                matcherHit ||
                matchText(handlerSummary(h)) ||
                matchText(h.type) ||
                matchText(h.command ?? "") ||
                matchText(h.url ?? ""),
            );
        return { ...group, hooks: hooksFiltered };
      })
      .filter((g) => g.hooks.length > 0);
  }

  const hasData = eventNames.length > 0;
  return (
    <section className="app-hooks-section" ref={sectionRef}>
      <div className="app-hooks-section-head">
        <div className="app-hooks-section-title">{title}</div>
        <div className="app-hooks-section-switch">
          <span>禁用全部</span>
          <Switch
            size="small"
            checked={data.disableAllHooks}
            disabled={readOnly}
            onChange={(next) => {
              if (readOnly) return;
              onToggleDisableAll(scope as ClaudeHookSourceScope, next);
            }}
          />
        </div>
      </div>
      <div className="app-hooks-section-path">{data.sourcePath || "(未设置路径)"}</div>
      {!hasData ? (
        <div className="app-hooks-empty">暂无 hooks</div>
      ) : (
        <div className="app-hooks-event-list">
          {eventNames.map((eventName) => (
            <div key={eventName} className="app-hooks-event-block">
              <div className="app-hooks-event-head">
                <span className="app-hooks-event-btn" title={eventName}>
                  <span>{eventName}</span>
                  <HelpIcon
                    className="app-hooks-event-help-icon"
                    text={EVENT_HELP_TEXT[eventName] ?? "该事件说明暂未配置。"}
                  />
                  <Tag className="app-hooks-event-tag" bordered={false}>
                    {groupsForEvent(eventName).reduce((acc, g) => acc + g.hooks.length, 0)} 条
                  </Tag>
                </span>
              </div>
              <div className="app-hooks-group-list">
                {groupsForEvent(eventName).map((group) => (
                  <div key={group.id} className="app-hooks-group-item">
                    <div className="app-hooks-group-head">
                      <Tag bordered={false}>{group.matcher?.trim() || "*"}</Tag>
                      {!readOnly ? (
                        <Button
                          type="text"
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => onCreate(scope as ClaudeHookSourceScope, eventName, group.id)}
                        >
                          添加 handler
                        </Button>
                      ) : null}
                    </div>
                    <div className="app-hooks-handler-list">
                      {group.hooks.map((h) => (
                        <div key={h.id} className="app-hooks-handler-item">
                          <div className="app-hooks-handler-main">
                            <span className="app-hooks-handler-summary">{handlerSummary(h)}</span>
                          </div>
                          <div className="app-hooks-handler-head">
                            <Tag color="blue" bordered={false}>
                              {h.type}
                            </Tag>
                            {!readOnly ? (
                              <Space size={2}>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => onEdit(scope as ClaudeHookSourceScope, eventName, group.id, h.id)}
                                />
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CopyOutlined />}
                                  onClick={() => onClone(scope as ClaudeHookSourceScope, eventName, group.id, h.id)}
                                />
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  icon={<DeleteOutlined />}
                                  onClick={() => onDelete(scope as ClaudeHookSourceScope, eventName, group.id, h.id)}
                                />
                              </Space>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ClaudeHooksConfigPanel({
  repositoryPath,
  active = true,
  listSearch = "",
  onBindActions,
  onCountChange,
}: Props) {
  const { message, modal } = App.useApp();
  const [data, setData] = useState<ClaudeHooksStatusResponse>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingAndContinue, setSubmittingAndContinue] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<{
    validCount: number;
    invalidCount: number;
    errors: string[];
  } | null>(null);
  const [importDryRun, setImportDryRun] = useState<{
    addCount: number;
    deleteCount: number;
  } | null>(null);
  const [importExecutionLog, setImportExecutionLog] = useState<string[]>([]);
  const [importFailedItems, setImportFailedItems] = useState<Array<{
    eventName: string;
    matcher: string | null;
    handler: Omit<ClaudeHookHandler, "id">;
    error: string;
  }>>([]);
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditingTarget>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const [flowTheme, setFlowTheme] = useState<HooksFlowTheme>("light-tech");
  const [hideOmcHooks, setHideOmcHooks] = useState(false);
  const userSectionRef = useRef<HTMLElement | null>(null);
  const projectSectionRef = useRef<HTMLElement | null>(null);
  const localSectionRef = useRef<HTMLElement | null>(null);
  const omcSectionRef = useRef<HTMLElement | null>(null);
  const [form] = Form.useForm<{
    scope: ClaudeHookSourceScope;
    eventName: string;
    matcher?: string;
    type: ClaudeHookHandler["type"];
    if?: string;
    timeout?: number;
    statusMessage?: string;
    shell?: "bash" | "powershell";
    async?: boolean;
    asyncRewake?: boolean;
    command?: string;
    url?: string;
    headersText?: string;
    allowedEnvVarsText?: string;
    prompt?: string;
    model?: string;
  }>();
  const [importForm] = Form.useForm<{
    scope: ClaudeHookSourceScope;
    mode: "append" | "overwrite_event";
    payload: string;
  }>();
  const selectedEventName = Form.useWatch("eventName", form);
  const selectedType = Form.useWatch("type", form);
  const supportedTypesForSelectedEvent = useMemo(
    () => getSupportedTypesByEvent(selectedEventName),
    [selectedEventName],
  );
  const typeOptionsForSelectedEvent = useMemo(
    () =>
      [
        { value: "command", label: "command" },
        { value: "http", label: "http" },
        { value: "prompt", label: "prompt" },
        { value: "agent", label: "agent" },
      ].filter((opt) => supportedTypesForSelectedEvent.includes(opt.value as ClaudeHookHandler["type"])),
    [supportedTypesForSelectedEvent],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getClaudeHooksStatus(repositoryPath ?? null);
      setData(res);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [message, repositoryPath]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  useEffect(() => {
    void (async () => {
      const raw =
        (await getAppSetting(HOOKS_FLOW_THEME_STORAGE_KEY)) ??
        (await getAppSetting(LEGACY_APP_SETTING_KEY_HOOKS_FLOW_THEME));
      if (raw != null) {
        void setAppSetting(HOOKS_FLOW_THEME_STORAGE_KEY, raw);
      }
      if (raw === "neon-blue" || raw === "cyber-purple" || raw === "light-tech") {
        setFlowTheme(raw);
      }
    })();
  }, []);

  useEffect(() => {
    void setAppSetting(HOOKS_FLOW_THEME_STORAGE_KEY, flowTheme);
  }, [flowTheme]);
  useEffect(() => {
    void (async () => {
      const raw =
        (await getAppSetting(HIDE_OMC_HOOKS_STORAGE_KEY)) ??
        (await getAppSetting(LEGACY_APP_SETTING_KEY_HIDE_OMC_HOOKS));
      if (raw != null) {
        void setAppSetting(HIDE_OMC_HOOKS_STORAGE_KEY, raw);
      }
      setHideOmcHooks(raw === "1");
    })();
  }, []);
  useEffect(() => {
    void setAppSetting(HIDE_OMC_HOOKS_STORAGE_KEY, hideOmcHooks ? "1" : "0");
  }, [hideOmcHooks]);

  const eventOptions = useMemo(() => {
    const existing = new Set<string>([
      ...Object.keys(data.user.hooks),
      ...Object.keys(data.project.hooks),
      ...Object.keys(data.local.hooks),
      ...Object.keys(data.omc.hooks),
    ]);
    for (const eventName of SUPPORTED_HOOK_EVENTS) existing.add(eventName);
    return Array.from(existing)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v }));
  }, [data.local.hooks, data.omc.hooks, data.project.hooks, data.user.hooks]);

  const openCreate = useCallback((scope: ClaudeHookSourceScope, eventName?: string, groupId?: string) => {
    const initialEvent = eventName ?? "PreToolUse";
    form.setFieldsValue({
      scope,
      eventName: initialEvent,
      matcher: "",
      type: "command",
      timeout: 30,
      command: "",
      url: "",
      prompt: "",
      model: "",
    });
    setEditing(eventName && groupId ? { scope, eventName, groupId, handlerId: "" } : null);
    setOpen(true);
  }, [form]);

  const openEdit = useCallback((scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => {
    const scopeData = data[scope];
    const group = (scopeData.hooks[eventName] ?? []).find((g) => g.id === groupId);
    const handler = group?.hooks.find((h) => h.id === handlerId);
    if (!handler) return;
    form.setFieldsValue({
      scope,
      eventName,
      matcher: group?.matcher ?? "",
      type: handler.type,
      if: handler.if ?? "",
      timeout: handler.timeout ?? undefined,
      statusMessage: handler.statusMessage ?? "",
      shell: (handler.shell as "bash" | "powershell" | null) ?? undefined,
      async: handler.async ?? false,
      asyncRewake: handler.asyncRewake ?? false,
      command: handler.command ?? "",
      url: handler.url ?? "",
      headersText: handler.headers
        ? Object.entries(handler.headers)
          .map(([k, val]) => `${k}: ${val}`)
          .join("\n")
        : "",
      allowedEnvVarsText: handler.allowedEnvVars?.join("\n") ?? "",
      prompt: handler.prompt ?? "",
      model: handler.model ?? "",
    });
    setEditing({ scope, eventName, groupId, handlerId });
    setOpen(true);
  }, [data, form]);

  const openClone = useCallback((scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => {
    const scopeData = data[scope];
    const group = (scopeData.hooks[eventName] ?? []).find((g) => g.id === groupId);
    const handler = group?.hooks.find((h) => h.id === handlerId);
    if (!handler) return;
    form.setFieldsValue({
      scope,
      eventName,
      matcher: group?.matcher ?? "",
      type: handler.type,
      if: handler.if ?? "",
      timeout: handler.timeout ?? 30,
      statusMessage: handler.statusMessage ?? "",
      shell: (handler.shell as "bash" | "powershell" | null) ?? undefined,
      async: handler.async ?? false,
      asyncRewake: handler.asyncRewake ?? false,
      command: handler.command ?? "",
      url: handler.url ?? "",
      headersText: handler.headers
        ? Object.entries(handler.headers)
          .map(([k, val]) => `${k}: ${val}`)
          .join("\n")
        : "",
      allowedEnvVarsText: handler.allowedEnvVars?.join("\n") ?? "",
      prompt: handler.prompt ?? "",
      model: handler.model ?? "",
    });
    // 克隆视为新增：不绑定目标 handlerId，保存后会新建一条
    setEditing({ scope, eventName, groupId, handlerId: "" });
    setOpen(true);
  }, [data, form]);

  const onSubmit = useCallback(async (keepOpen: boolean = false) => {
    const v = await form.validateFields();
    const headersMap: Record<string, string> = {};
    for (const line of (v.headersText ?? "").split("\n").map((x) => x.trim()).filter(Boolean)) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        if (k && val) headersMap[k] = val;
      }
    }
    const allowedEnvVars = (v.allowedEnvVarsText ?? "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    if (keepOpen) setSubmittingAndContinue(true);
    else setSubmitting(true);
    try {
      await upsertClaudeHook({
        scope: v.scope,
        repositoryPath: repositoryPath ?? null,
        eventName: v.eventName,
        matcher: v.matcher?.trim() || null,
        handler: {
          type: v.type,
          if: v.if?.trim() || null,
          timeout: v.timeout ?? null,
          statusMessage: v.statusMessage?.trim() || null,
          shell: v.shell ?? null,
          async: v.async ?? null,
          asyncRewake: v.asyncRewake ?? null,
          command: v.command?.trim() || null,
          url: v.url?.trim() || null,
          headers: Object.keys(headersMap).length > 0 ? headersMap : null,
          allowedEnvVars: allowedEnvVars.length > 0 ? allowedEnvVars : null,
          prompt: v.prompt?.trim() || null,
          model: v.model?.trim() || null,
        },
        targetGroupId: editing?.groupId || null,
        targetHandlerId: editing?.handlerId || null,
      });
      message.success("已保存 Hook");
      if (!keepOpen) {
        setOpen(false);
      } else {
        form.setFieldsValue({
          matcher: v.matcher ?? "",
          type: v.type,
          if: "",
          timeout: v.timeout ?? 30,
          statusMessage: "",
          shell: v.shell,
          async: v.async ?? false,
          asyncRewake: v.asyncRewake ?? false,
          command: "",
          url: "",
          headersText: "",
          allowedEnvVarsText: "",
          prompt: "",
          model: v.model ?? "",
        });
      }
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (keepOpen) setSubmittingAndContinue(false);
      else setSubmitting(false);
    }
  }, [editing?.groupId, editing?.handlerId, form, load, message, repositoryPath]);

  const onDelete = useCallback((scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => {
    modal.confirm({
      title: "删除该 Hook？",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        await removeClaudeHook({ scope, eventName, groupId, handlerId, repositoryPath: repositoryPath ?? null });
        message.success("已删除");
        await load();
      },
    });
  }, [load, message, modal, repositoryPath]);

  const onToggleDisableAll = useCallback(async (scope: ClaudeHookSourceScope, next: boolean) => {
    try {
      await setClaudeDisableAllHooks({ scope, disableAllHooks: next, repositoryPath: repositoryPath ?? null });
      setData((prev) => ({ ...prev, [scope]: { ...prev[scope], disableAllHooks: next } }));
      message.success(next ? "已禁用全部 hooks" : "已恢复 hooks");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  }, [message, repositoryPath]);

  const onCopyEventName = useCallback(async (eventName: string) => {
    try {
      await navigator.clipboard.writeText(eventName);
      message.success(`已复制事件名：${eventName}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  }, [message]);

  const scrollToScope = useCallback((scope: ClaudeHookSourceScope | "omc") => {
    const el = scope === "user"
      ? userSectionRef.current
      : scope === "project"
        ? projectSectionRef.current
        : scope === "local"
          ? localSectionRef.current
          : omcSectionRef.current;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const visibleScopes = useMemo(
    () => (hideOmcHooks ? [data.user, data.project, data.local] : [data.user, data.project, data.local, data.omc]),
    [data.local, data.omc, data.project, data.user, hideOmcHooks],
  );
  const hasAnyData = visibleScopes.some((scope) => Object.keys(scope.hooks).length > 0);
  const projectScopeUnavailable = Boolean(repositoryPath) && data.project.sourcePath.startsWith("<请选择项目");
  const filterStats = useMemo(() => {
    const count = (scopeData: ClaudeHookScopeData) =>
      Object.values(scopeData.hooks).reduce(
        (acc, groups) => acc + groups.reduce((sum, g) => sum + g.hooks.length, 0),
        0,
      );
    const omcCount = count(data.omc);
    return {
      user: count(data.user),
      project: count(data.project),
      local: count(data.local),
      omc: hideOmcHooks ? 0 : omcCount,
    };
  }, [data.local, data.omc, data.project, data.user, hideOmcHooks]);
  const hooksCount = useMemo(
    () => filterStats.user + filterStats.project + filterStats.local + filterStats.omc,
    [filterStats.local, filterStats.omc, filterStats.project, filterStats.user],
  );
  useEffect(() => {
    onCountChange?.(hooksCount);
  }, [hooksCount, onCountChange]);
  const eventHookCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    const allScopes = [data.user, data.project, data.local, data.omc];
    for (const scopeData of allScopes) {
      for (const [eventName, groups] of Object.entries(scopeData.hooks)) {
        const count = groups.reduce((sum, group) => sum + group.hooks.length, 0);
        map[eventName] = (map[eventName] ?? 0) + count;
      }
    }
    return map;
  }, [data.local, data.omc, data.project, data.user]);
  const flowEventEntriesMap = useMemo(() => {
    const map: Record<string, HookFlowEntry[]> = {};
    const allScopes: Array<{ scope: ClaudeHookSourceScope; scopeData: ClaudeHookScopeData }> = [
      { scope: "user", scopeData: data.user },
      { scope: "project", scopeData: data.project },
      { scope: "local", scopeData: data.local },
    ];
    for (const { scope, scopeData } of allScopes) {
      for (const [eventName, groups] of Object.entries(scopeData.hooks)) {
        for (const group of groups) {
          const matcher = group.matcher?.trim() || "*";
          for (const handler of group.hooks) {
            if (!map[eventName]) map[eventName] = [];
            map[eventName].push({
              scope,
              eventName,
              groupId: group.id,
              handlerId: handler.id,
              matcher,
              type: handler.type,
              summary: handlerSummary(handler),
            });
          }
        }
      }
    }
    return map;
  }, [data.local, data.omc, data.project, data.user]);

  const validateImportPayload = useCallback((rawPayload: string) => {
    const errors: string[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      return {
        parsed: null,
        report: {
          validCount: 0,
          invalidCount: 1,
          errors: ["JSON 解析失败"],
        },
      };
    }
    const obj = parsed as {
      disableAllHooks?: boolean;
      hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<Record<string, unknown>> }>>;
    };
    if (!obj || typeof obj !== "object" || !obj.hooks || typeof obj.hooks !== "object") {
      return {
        parsed: null,
        report: {
          validCount: 0,
          invalidCount: 1,
          errors: ["结构不合法：需要 hooks 对象"],
        },
      };
    }
    const hooksObj = obj.hooks ?? {};
    for (const [eventName, groups] of Object.entries(hooksObj)) {
      if (!Array.isArray(groups)) {
        invalidCount += 1;
        errors.push(`${eventName}: group 不是数组`);
        continue;
      }
      for (const group of groups) {
        if (!Array.isArray(group.hooks)) {
          invalidCount += 1;
          errors.push(`${eventName}: hooks 不是数组`);
          continue;
        }
        for (const handler of group.hooks) {
          const type = typeof handler.type === "string" ? handler.type : "";
          if (!["command", "http", "prompt", "agent"].includes(type)) {
            invalidCount += 1;
            errors.push(`${eventName}: 无效 type(${String(handler.type)})`);
            continue;
          }
          if (type === "command" && typeof handler.command !== "string") {
            invalidCount += 1;
            errors.push(`${eventName}: command hook 缺少 command`);
            continue;
          }
          if (type === "http" && typeof handler.url !== "string") {
            invalidCount += 1;
            errors.push(`${eventName}: http hook 缺少 url`);
            continue;
          }
          if ((type === "prompt" || type === "agent") && typeof handler.prompt !== "string") {
            invalidCount += 1;
            errors.push(`${eventName}: ${type} hook 缺少 prompt`);
            continue;
          }
          validCount += 1;
        }
      }
    }
    return {
      parsed: obj,
      report: {
        validCount,
        invalidCount,
        errors: errors.slice(0, 20),
      },
    };
  }, []);

  const onPreviewImport = useCallback(async () => {
    const payload = importForm.getFieldValue("payload");
    const mode = importForm.getFieldValue("mode") as "append" | "overwrite_event" | undefined;
    const scope = (importForm.getFieldValue("scope") as ClaudeHookSourceScope | undefined) ?? "user";
    if (!payload || !String(payload).trim()) {
      message.warning("请先粘贴 JSON");
      return;
    }
    const { report, parsed } = validateImportPayload(String(payload));
    setImportReport(report);
    if (parsed) {
      const addCount = report.validCount;
      let deleteCount = 0;
      if ((mode ?? "append") === "overwrite_event") {
        const scopeData = data[scope];
        for (const eventName of Object.keys(parsed.hooks ?? {})) {
          const groups = scopeData.hooks[eventName] ?? [];
          deleteCount += groups.reduce((acc, g) => acc + g.hooks.length, 0);
        }
      }
      setImportDryRun({ addCount, deleteCount });
      setImportStep(2);
    } else {
      setImportDryRun(null);
      setImportStep(1);
    }
  }, [data, importForm, message, validateImportPayload]);

  const onImportHooks = useCallback(async () => {
    const v = await importForm.validateFields();
    const { parsed, report } = validateImportPayload(v.payload);
    setImportReport(report);
    if (!parsed) {
      message.error("导入 JSON 不合法");
      setImportStep(1);
      return;
    }
    if (report.validCount <= 0) {
      message.error("没有可导入的有效 hooks");
      setImportStep(1);
      return;
    }
    const obj = parsed;
    let deleteCount = 0;
    if (v.mode === "overwrite_event") {
      const scopeData = data[v.scope];
      for (const eventName of Object.keys(obj.hooks ?? {})) {
        const groups = scopeData.hooks[eventName] ?? [];
        deleteCount += groups.reduce((acc, g) => acc + g.hooks.length, 0);
      }
    }
    setImportDryRun({ addCount: report.validCount, deleteCount });

    if (v.mode === "overwrite_event" && deleteCount > 0) {
      const confirmed = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: "确认覆盖导入？",
          content: `将删除 ${deleteCount} 条同事件现有 hooks，并新增 ${report.validCount} 条。`,
          okText: "确认覆盖",
          okType: "danger",
          cancelText: "取消",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) {
        return;
      }
    }

    setImportExecutionLog([]);
    setImportFailedItems([]);
    setImportStep(3);
    setImporting(true);
    try {
      if (v.mode === "overwrite_event") {
        const scopeData = data[v.scope];
        for (const eventName of Object.keys(obj.hooks ?? {})) {
          const groups = scopeData.hooks[eventName] ?? [];
          setImportExecutionLog((prev) => [...prev, `[${eventName}] 覆盖模式：准备删除 ${groups.reduce((acc, g) => acc + g.hooks.length, 0)} 条`]);
          for (const group of groups) {
            for (const handler of group.hooks) {
              await removeClaudeHook({
                scope: v.scope,
                eventName,
                groupId: group.id,
                handlerId: handler.id,
                repositoryPath: repositoryPath ?? null,
              });
              setImportExecutionLog((prev) => [...prev, `[${eventName}] 已删除 ${handler.id}`]);
            }
          }
        }
      }
      if (typeof obj.disableAllHooks === "boolean") {
        await setClaudeDisableAllHooks({
          scope: v.scope,
          disableAllHooks: obj.disableAllHooks,
          repositoryPath: repositoryPath ?? null,
        });
      }
      for (const [eventName, groups] of Object.entries(obj.hooks ?? {})) {
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
          const matcher = typeof group.matcher === "string" ? group.matcher : null;
          if (!Array.isArray(group.hooks)) continue;
          for (const handler of group.hooks) {
            const type = typeof handler.type === "string" ? handler.type : "";
            if (!type) continue;
            const normalizedHandler: Omit<ClaudeHookHandler, "id"> = {
              type: type as ClaudeHookHandler["type"],
              if: typeof handler.if === "string" ? handler.if : null,
              timeout: typeof handler.timeout === "number" ? handler.timeout : null,
              statusMessage: typeof handler.statusMessage === "string" ? handler.statusMessage : null,
              shell: typeof handler.shell === "string" ? (handler.shell as "bash" | "powershell") : null,
              async: typeof handler.async === "boolean" ? handler.async : null,
              asyncRewake: typeof handler.asyncRewake === "boolean" ? handler.asyncRewake : null,
              command: typeof handler.command === "string" ? handler.command : null,
              url: typeof handler.url === "string" ? handler.url : null,
              headers: handler.headers && typeof handler.headers === "object" ? (handler.headers as Record<string, string>) : null,
              allowedEnvVars: Array.isArray(handler.allowedEnvVars) ? (handler.allowedEnvVars as string[]) : null,
              prompt: typeof handler.prompt === "string" ? handler.prompt : null,
              model: typeof handler.model === "string" ? handler.model : null,
            };
            try {
              await upsertClaudeHook({
                scope: v.scope,
                repositoryPath: repositoryPath ?? null,
                eventName,
                matcher,
                handler: normalizedHandler,
              });
              setImportExecutionLog((prev) => [...prev, `[${eventName}] 导入成功 type=${type} matcher=${matcher ?? "*"}`]);
            } catch (e) {
              const errorText = e instanceof Error ? e.message : String(e);
              setImportFailedItems((prev) => [
                ...prev,
                {
                  eventName,
                  matcher,
                  handler: normalizedHandler,
                  error: errorText,
                },
              ]);
              setImportExecutionLog((prev) => [
                ...prev,
                `[${eventName}] 导入失败 type=${type} matcher=${matcher ?? "*"}: ${errorText}`,
              ]);
            }
          }
        }
      }
      message.success(v.mode === "overwrite_event" ? "导入完成（覆盖同事件）" : "导入完成（追加模式）");
      setImportOpen(false);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }, [data, importForm, load, message, modal, repositoryPath, validateImportPayload]);

  const onCopyImportLog = useCallback(async () => {
    if (importExecutionLog.length === 0) {
      message.warning("暂无可复制的执行日志");
      return;
    }
    const scope = importForm.getFieldValue("scope") as ClaudeHookSourceScope | undefined;
    const mode = importForm.getFieldValue("mode") as "append" | "overwrite_event" | undefined;
    const text = [
      `Hooks 导入日志`,
      `time: ${new Date().toISOString()}`,
      `scope: ${scope ?? "-"}`,
      `mode: ${mode ?? "-"}`,
      "",
      ...importExecutionLog,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    message.success("已复制执行日志");
  }, [importExecutionLog, importForm, message]);

  const onRetryFailedImports = useCallback(async () => {
    const scope = importForm.getFieldValue("scope") as ClaudeHookSourceScope | undefined;
    if (!scope) {
      message.error("缺少导入 scope，无法重试");
      return;
    }
    if (importFailedItems.length === 0) {
      message.warning("当前没有失败项");
      return;
    }
    const current = [...importFailedItems];
    setImporting(true);
    setImportFailedItems([]);
    try {
      for (const item of current) {
        try {
          await upsertClaudeHook({
            scope,
            repositoryPath: repositoryPath ?? null,
            eventName: item.eventName,
            matcher: item.matcher,
            handler: item.handler,
          });
          setImportExecutionLog((prev) => [
            ...prev,
            `[${item.eventName}] 重试成功 type=${item.handler.type} matcher=${item.matcher ?? "*"}`,
          ]);
        } catch (e) {
          const errorText = e instanceof Error ? e.message : String(e);
          setImportFailedItems((prev) => [
            ...prev,
            { ...item, error: errorText },
          ]);
          setImportExecutionLog((prev) => [
            ...prev,
            `[${item.eventName}] 重试失败 type=${item.handler.type} matcher=${item.matcher ?? "*"}: ${errorText}`,
          ]);
        }
      }
      await load();
    } finally {
      setImporting(false);
    }
  }, [importFailedItems, importForm, load, message, repositoryPath]);

  const onCopyFailedAsReplayJson = useCallback(async () => {
    const scope = importForm.getFieldValue("scope") as ClaudeHookSourceScope | undefined;
    if (!scope) {
      message.error("缺少 scope，无法导出失败项");
      return;
    }
    if (importFailedItems.length === 0) {
      message.warning("当前没有失败项");
      return;
    }
    const grouped: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>> = {};
    for (const item of importFailedItems) {
      if (!grouped[item.eventName]) grouped[item.eventName] = [];
      const handlerJson: Record<string, unknown> = {
        type: item.handler.type,
      };
      if (item.handler.if) handlerJson.if = item.handler.if;
      if (item.handler.timeout) handlerJson.timeout = item.handler.timeout;
      if (item.handler.statusMessage) handlerJson.statusMessage = item.handler.statusMessage;
      if (item.handler.shell) handlerJson.shell = item.handler.shell;
      if (typeof item.handler.async === "boolean") handlerJson.async = item.handler.async;
      if (typeof item.handler.asyncRewake === "boolean") handlerJson.asyncRewake = item.handler.asyncRewake;
      if (item.handler.command) handlerJson.command = item.handler.command;
      if (item.handler.url) handlerJson.url = item.handler.url;
      if (item.handler.headers) handlerJson.headers = item.handler.headers;
      if (item.handler.allowedEnvVars) handlerJson.allowedEnvVars = item.handler.allowedEnvVars;
      if (item.handler.prompt) handlerJson.prompt = item.handler.prompt;
      if (item.handler.model) handlerJson.model = item.handler.model;

      grouped[item.eventName].push({
        matcher: item.matcher ?? undefined,
        hooks: [handlerJson],
      });
    }
    const replayJson = {
      scope,
      mode: "append",
      hooks: grouped,
      meta: {
        exportedAt: new Date().toISOString(),
        failedCount: importFailedItems.length,
      },
    };
    await navigator.clipboard.writeText(JSON.stringify(replayJson, null, 2));
    message.success("已复制失败项重放 JSON");
  }, [importFailedItems, importForm, message]);

  const onFillFailedAsReplayJson = useCallback(() => {
    const scope = (importForm.getFieldValue("scope") as ClaudeHookSourceScope | undefined) ?? "user";
    if (importFailedItems.length === 0) {
      message.warning("当前没有失败项");
      return;
    }
    const grouped: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>> = {};
    for (const item of importFailedItems) {
      if (!grouped[item.eventName]) grouped[item.eventName] = [];
      const handlerJson: Record<string, unknown> = {
        type: item.handler.type,
      };
      if (item.handler.if) handlerJson.if = item.handler.if;
      if (item.handler.timeout) handlerJson.timeout = item.handler.timeout;
      if (item.handler.statusMessage) handlerJson.statusMessage = item.handler.statusMessage;
      if (item.handler.shell) handlerJson.shell = item.handler.shell;
      if (typeof item.handler.async === "boolean") handlerJson.async = item.handler.async;
      if (typeof item.handler.asyncRewake === "boolean") handlerJson.asyncRewake = item.handler.asyncRewake;
      if (item.handler.command) handlerJson.command = item.handler.command;
      if (item.handler.url) handlerJson.url = item.handler.url;
      if (item.handler.headers) handlerJson.headers = item.handler.headers;
      if (item.handler.allowedEnvVars) handlerJson.allowedEnvVars = item.handler.allowedEnvVars;
      if (item.handler.prompt) handlerJson.prompt = item.handler.prompt;
      if (item.handler.model) handlerJson.model = item.handler.model;

      grouped[item.eventName].push({
        matcher: item.matcher ?? undefined,
        hooks: [handlerJson],
      });
    }
    const replayJson = {
      disableAllHooks: undefined,
      hooks: grouped,
      meta: {
        generatedFromFailedItems: true,
        generatedAt: new Date().toISOString(),
        failedCount: importFailedItems.length,
      },
    };
    importForm.setFieldsValue({
      scope,
      mode: "append",
      payload: JSON.stringify(replayJson, null, 2),
    });
    setImportReport(null);
    setImportDryRun(null);
    message.success("已将失败项 JSON 回填到导入框");
  }, [importFailedItems, importForm, message]);

  useEffect(() => {
    const handleOpenFlow = () => setFlowOpen(true);
    window.addEventListener("wise:open-hooks-flow", handleOpenFlow);
    return () => {
      window.removeEventListener("wise:open-hooks-flow", handleOpenFlow);
    };
  }, []);

  useEffect(() => {
    if (!onBindActions) return;
    onBindActions({
      refresh: load,
      openCreateModal: () => openCreate(repositoryPath ? "project" : "user"),
    });
    return () => onBindActions(null);
  }, [load, onBindActions, openCreate, repositoryPath]);

  useEffect(() => {
    if (!selectedEventName || !selectedType) return;
    if (!supportedTypesForSelectedEvent.includes(selectedType)) {
      const fallbackType = supportedTypesForSelectedEvent[0] ?? "command";
      form.setFieldValue("type", fallbackType);
      message.warning(`事件 ${selectedEventName} 不支持 ${selectedType}，已切换为 ${fallbackType}`);
    }
  }, [form, message, selectedEventName, selectedType, supportedTypesForSelectedEvent]);

  return (
    <div className="app-claude-code-tools-tab">
      {projectScopeUnavailable ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          message="当前未获取到有效仓库路径，已回退展示全局（user）Hooks；project/local 暂不可用。"
        />
      ) : null}
      <div style={{ marginBottom: 8, display: "flex", justifyContent: "flex-end" }}>
        <Space size={6}>
          <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 12 }}>隐藏 OMC 内置项</span>
          <Switch size="small" checked={hideOmcHooks} onChange={setHideOmcHooks} />
        </Space>
      </div>
      <div className="app-hooks-stats-bar">
        <button type="button" className="app-hooks-stats-btn" onClick={() => scrollToScope("user")}>
          <Tag bordered={false}>user: {filterStats.user}</Tag>
        </button>
        <button type="button" className="app-hooks-stats-btn" onClick={() => scrollToScope("project")}>
          <Tag bordered={false}>project: {filterStats.project}</Tag>
        </button>
        <button type="button" className="app-hooks-stats-btn" onClick={() => scrollToScope("local")}>
          <Tag bordered={false}>local: {filterStats.local}</Tag>
        </button>
        <button type="button" className="app-hooks-stats-btn" onClick={() => scrollToScope("omc")}>
          <Tag bordered={false}>omc: {filterStats.omc}</Tag>
        </button>
      </div>
      {loading ? (
        <div className="app-hooks-loading"><Spin size="small" /></div>
      ) : !hasAnyData ? (
        <Empty description="暂无 Hook 配置，可点击「新增 Hook」" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="app-hooks-scope-list">
          <HookScopeSection
            scope="user"
            title="用户范围"
            data={data.user}
            onCreate={openCreate}
            onEdit={openEdit}
            onDelete={onDelete}
            onToggleDisableAll={onToggleDisableAll}
            sectionRef={userSectionRef}
            onClone={openClone}
            keyword={listSearch}
          />
          <HookScopeSection
            scope="project"
            title="仓库共享"
            data={data.project}
            onCreate={openCreate}
            onEdit={openEdit}
            onDelete={onDelete}
            onToggleDisableAll={onToggleDisableAll}
            sectionRef={projectSectionRef}
            onClone={openClone}
            keyword={listSearch}
          />
          <HookScopeSection
            scope="local"
            title="仓库本地"
            data={data.local}
            onCreate={openCreate}
            onEdit={openEdit}
            onDelete={onDelete}
            onToggleDisableAll={onToggleDisableAll}
            sectionRef={localSectionRef}
            onClone={openClone}
            keyword={listSearch}
          />
          {!hideOmcHooks ? (
            <HookScopeSection
              scope="omc"
              title="OMC 插件内置（只读）"
              data={data.omc}
              onCreate={openCreate}
              onEdit={openEdit}
              onDelete={onDelete}
              onToggleDisableAll={onToggleDisableAll}
              onClone={openClone}
              keyword={listSearch}
              sectionRef={omcSectionRef}
              readOnly
            />
          ) : null}
        </div>
      )}

      <Modal
        title={(
          <div className="app-hooks-flow-modal-title">
            <span>仓库 Hooks 与 Claude Code 生命周期</span>
            <Button.Group size="small">
              <Button
                type={flowTheme === "light-tech" ? "primary" : "default"}
                onClick={() => setFlowTheme("light-tech")}
              >
                亮色
              </Button>
              <Button
                type={flowTheme === "neon-blue" ? "primary" : "default"}
                onClick={() => setFlowTheme("neon-blue")}
              >
                霓虹蓝
              </Button>
              <Button
                type={flowTheme === "cyber-purple" ? "primary" : "default"}
                onClick={() => setFlowTheme("cyber-purple")}
              >
                赛博紫
              </Button>
            </Button.Group>
          </div>
        )}
        open={flowOpen}
        onCancel={() => setFlowOpen(false)}
        footer={null}
        width="100vw"
        rootClassName="app-hooks-flow-modal"
        destroyOnHidden
      >
        <div className="app-hooks-flow-body">
          <div className={`app-hooks-flow-visual app-hooks-flow-visual--horizontal app-hooks-flow-theme-${flowTheme}`}>
            <div className="app-hooks-flow-horizontal-main">
              <div className="app-hooks-flow-lifecycle-tag app-hooks-flow-lifecycle-tag--turn">EACH TURN</div>
              <div className="app-hooks-flow-lifecycle-tag app-hooks-flow-lifecycle-tag--agentic">AGENTIC LOOP</div>
              <div className="app-hooks-flow-horizontal-track">
                {MAIN_FLOW_STEPS.map((step, idx) => {
                  const eventName = step.eventName;
                  const count = eventName ? (eventHookCountMap[eventName] ?? 0) : 0;
                  const entries = eventName ? (flowEventEntriesMap[eventName] ?? []) : [];
                  const isClickable = Boolean(eventName);
                  return (
                    <div key={`${step.title}-${idx}`} className="app-hooks-flow-h-step-wrap">
                      <div className={`app-hooks-flow-life-step ${isClickable ? "is-clickable" : ""} ${count > 0 ? "is-configured" : ""}`}>
                        {eventName ? (
                          <button
                            type="button"
                            className="app-hooks-flow-life-step-btn"
                            onClick={() => {
                              // no event filtering; keep as plain workflow label
                            }}
                            title={`按 ${eventName} 过滤`}
                          >
                            {step.title}
                          </button>
                        ) : (
                          <div className="app-hooks-flow-life-step-label">{step.title}</div>
                        )}
                        <HelpIcon text={getHelpTextByTitle(step.title, eventName)} />
                        {step.desc ? <div className="app-hooks-flow-life-step-chip">{step.desc}</div> : null}
                        {eventName ? (
                          <div className="app-hooks-flow-life-step-meta">
                            <span>配置: {count}</span>
                            <div className="app-hooks-flow-card-actions">
                              <Button
                                size="small"
                                type="default"
                                className="app-hooks-flow-action-btn"
                                onClick={() => {
                                  openCreate(repositoryPath ? "project" : "user", eventName);
                                }}
                              >
                                + Hook
                              </Button>
                              <Button
                                size="small"
                                type="default"
                                className="app-hooks-flow-action-btn"
                                onClick={() => void onCopyEventName(eventName)}
                              >
                                复制名
                              </Button>
                            </div>
                            <span>类型: {getSupportedTypesText(eventName)}</span>
                            {entries.length > 0 ? (
                              <div className="app-hooks-flow-config-list">
                                {entries.map((entry) => (
                                  <button
                                    key={entry.handlerId}
                                    type="button"
                                    className="app-hooks-flow-config-item"
                                    onClick={() => openEdit(entry.scope, entry.eventName, entry.groupId, entry.handlerId)}
                                    title={`${entry.scope} · ${entry.matcher} · ${entry.summary}`}
                                  >
                                    [{entry.scope}] {entry.matcher} · {entry.type} · {entry.summary}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {idx < MAIN_FLOW_STEPS.length - 1 ? <div className="app-hooks-flow-life-arrow">→</div> : null}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="app-hooks-flow-horizontal-side">
              <div className="app-hooks-flow-side-title">侧挂 / 异步事件</div>
              <div className="app-hooks-flow-horizontal-side-track">
                {SIDE_EVENTS.map((item) => {
                  const count = eventHookCountMap[item.eventName] ?? 0;
                  const entries = flowEventEntriesMap[item.eventName] ?? [];
                  return (
                    <div key={item.eventName} className={`app-hooks-flow-side-item ${count > 0 ? "is-configured" : ""}`}>
                      <button
                        type="button"
                        className="app-hooks-flow-side-btn"
                        onClick={() => {
                          // no event filtering; keep as plain workflow label
                        }}
                      >
                        {item.title}
                      </button>
                      <HelpIcon text={getHelpTextByTitle(item.title, item.eventName)} />
                      <div className="app-hooks-flow-side-meta">配置: {count}</div>
                      <div className="app-hooks-flow-card-actions app-hooks-flow-card-actions--side">
                        <Button
                          size="small"
                          type="default"
                          className="app-hooks-flow-action-btn"
                          onClick={() => {
                            openCreate(repositoryPath ? "project" : "user", item.eventName);
                          }}
                        >
                          + Hook
                        </Button>
                        <Button
                          size="small"
                          type="default"
                          className="app-hooks-flow-action-btn"
                          onClick={() => void onCopyEventName(item.eventName)}
                        >
                          复制名
                        </Button>
                      </div>
                      {entries.length > 0 ? (
                        <div className="app-hooks-flow-config-list app-hooks-flow-config-list--side">
                          {entries.map((entry) => (
                            <button
                              key={entry.handlerId}
                              type="button"
                              className="app-hooks-flow-config-item"
                              onClick={() => openEdit(entry.scope, entry.eventName, entry.groupId, entry.handlerId)}
                              title={`${entry.scope} · ${entry.matcher} · ${entry.summary}`}
                            >
                              [{entry.scope}] {entry.matcher} · {entry.type} · {entry.summary}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </Modal>
      <Modal
        title={editing?.handlerId ? "编辑 Hook" : "新增 Hook"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void onSubmit(false)}
        confirmLoading={submitting}
        width={760}
        className="app-hooks-edit-modal"
        destroyOnHidden
        okText={editing?.handlerId ? "保存" : "保存"}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            <CancelBtn />
            {!editing?.handlerId ? (
              <Button loading={submittingAndContinue} onClick={() => void onSubmit(true)}>
                保存并继续
              </Button>
            ) : null}
            <OkBtn />
          </Space>
        )}
      >
        <Form form={form}  layout="vertical" size="small" colon={false} className="app-hooks-edit-form">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="scope" label="范围" rules={[{ required: true }]}>
                <Select options={[
                  { value: "user", label: "user" },
                  { value: "project", label: "project" },
                  { value: "local", label: "local" },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="eventName" label="事件" rules={[{ required: true }]}>
                <Select options={eventOptions} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <div className="app-hooks-type-hint">
                支持类型：{selectedEventName ? getSupportedTypesText(selectedEventName) : "command / http / prompt / agent"}
              </div>
            </Col>
            <Col span={12}>
              <Form.Item name="matcher" label="Matcher（可选）">
                <Input placeholder="如 Bash 或 Edit|Write 或 mcp__.*" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                <Select options={typeOptionsForSelectedEvent} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="if" label="if（可选）">
                <Input placeholder='如 Bash(git *)' />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="timeout" label="timeout（秒）">
                <Input type="number" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="statusMessage" label="statusMessage（可选）">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.type !== cur.type}>
            {({ getFieldValue }) => {
              const t = getFieldValue("type");
              if (t === "command") {
                return (
                  <Row gutter={12}>
                    <Col span={24}>
                      <Form.Item name="command" label="command" rules={[{ required: true, message: "请输入 command" }]}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="shell" label="shell（可选）">
                        <Select allowClear options={[{ value: "bash", label: "bash" }, { value: "powershell", label: "powershell" }]} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="async" valuePropName="checked" label="async">
                        <Switch size="small" />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="asyncRewake" valuePropName="checked" label="asyncRewake">
                        <Switch size="small" />
                      </Form.Item>
                    </Col>
                  </Row>
                );
              }
              if (t === "http") {
                return (
                  <Row gutter={12}>
                    <Col span={24}>
                      <Form.Item name="url" label="url" rules={[{ required: true, message: "请输入 url" }]}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="headersText" label="headers（每行 Key: Value）">
                        <Input.TextArea rows={3} placeholder={"Authorization: Bearer $TOKEN\nX-Team: dev"} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="allowedEnvVarsText" label="allowedEnvVars（每行一个）">
                        <Input.TextArea rows={3} placeholder={"TOKEN\nAPI_KEY"} />
                      </Form.Item>
                    </Col>
                  </Row>
                );
              }
              return (
                <Row gutter={12}>
                  <Col span={24}>
                    <Form.Item name="prompt" label="prompt" rules={[{ required: true, message: "请输入 prompt" }]}>
                      <Input.TextArea rows={3} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="model" label="model（可选）">
                      <Input />
                    </Form.Item>
                  </Col>
                </Row>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="导入 Hooks（追加）"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={() => void onImportHooks()}
        confirmLoading={importing}
        width={520}
        destroyOnHidden
        okButtonProps={{ style: { display: "none" } }}
      >
        <Form form={importForm} layout="vertical" size="small" colon={false}>
          <Form.Item>
            <Alert
              type="info"
              showIcon
              message="导入步骤"
              description={
                importStep === 1
                  ? "Step 1/3：粘贴 JSON 并点击「预校验」"
                  : importStep === 2
                    ? "Step 2/3：确认预校验与 Dry-run 结果"
                    : "Step 3/3：执行导入并查看执行日志/失败重试"
              }
            />
          </Form.Item>
          <Form.Item name="scope" label="导入到范围" rules={[{ required: true }]}>
            <Select options={[
              { value: "user", label: "user" },
              { value: "project", label: "project" },
              { value: "local", label: "local" },
            ]} />
          </Form.Item>
          <Form.Item name="mode" label="导入模式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "append", label: "追加（保留现有）" },
                { value: "overwrite_event", label: "覆盖同事件（先删后导）" },
              ]}
            />
          </Form.Item>
          <Form.Item name="payload" label="JSON 内容" rules={[{ required: true, message: "请粘贴 JSON" }]}>
            <Input.TextArea rows={12} placeholder='{"disableAllHooks":false,"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"echo hi"}]}]}}' />
          </Form.Item>
          <Form.Item>
            <Space size={8}>
              <Button onClick={() => void onPreviewImport()}>预校验</Button>
              <Button
                type="primary"
                onClick={() => void onImportHooks()}
                disabled={!importReport || importReport.validCount <= 0}
                loading={importing}
              >
                执行导入
              </Button>
              {importReport ? (
                <>
                  <Tag bordered={false} color={importReport.validCount > 0 ? "success" : "default"}>
                    可导入: {importReport.validCount}
                  </Tag>
                  <Tag bordered={false} color={importReport.invalidCount > 0 ? "warning" : "default"}>
                    无效: {importReport.invalidCount}
                  </Tag>
                </>
              ) : null}
            </Space>
          </Form.Item>
          {importDryRun ? (
            <Form.Item label="Dry-run 影响">
              <Space size={8}>
                <Tag bordered={false} color="success">预计新增: {importDryRun.addCount}</Tag>
                <Tag bordered={false} color={importDryRun.deleteCount > 0 ? "warning" : "default"}>
                  预计删除: {importDryRun.deleteCount}
                </Tag>
              </Space>
            </Form.Item>
          ) : null}
          {importReport?.errors?.length ? (
            <Form.Item label="预校验问题（最多显示 20 条）">
              <div className="app-hooks-import-errors">
                {importReport.errors.map((err) => (
                  <div key={err}>{err}</div>
                ))}
              </div>
            </Form.Item>
          ) : null}
          {importExecutionLog.length > 0 ? (
            <Form.Item label="执行日志">
              <div className="app-hooks-import-log-head">
                <Button size="small" onClick={() => void onCopyImportLog()}>
                  复制日志
                </Button>
                <Button size="small" onClick={() => void onCopyFailedAsReplayJson()} disabled={importFailedItems.length === 0}>
                  复制失败项 JSON
                </Button>
                <Button size="small" onClick={() => onFillFailedAsReplayJson()} disabled={importFailedItems.length === 0}>
                  回填失败项 JSON
                </Button>
                <Button size="small" onClick={() => void onRetryFailedImports()} disabled={importFailedItems.length === 0} loading={importing}>
                  重试失败项（{importFailedItems.length}）
                </Button>
              </div>
              <div className="app-hooks-import-errors">
                {importExecutionLog.map((line, idx) => (
                  <div key={`${idx}-${line}`}>{line}</div>
                ))}
              </div>
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
