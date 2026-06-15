import { Alert, App, Empty, Form, Spin, Tag } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClaudeHookHandler,
  ClaudeHookSourceScope,
  ClaudeHookScopeData,
  ClaudeHooksStatusResponse,
} from "../types";
import { getClaudeHooksStatus, removeClaudeHook, setClaudeDisableAllHooks, upsertClaudeHook } from "../services/claude";
import { listRepositoryExplorerChildren } from "../services/repositoryFiles";
import {
  OPEN_WORKSPACE_ERROR,
  openRepositoryEntryInPreferredEditor,
} from "../services/openWorkspaceWithPreference";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";
import { EMPTY_DATA, HOOKS_FLOW_THEME_STORAGE_KEY, LEGACY_APP_SETTING_KEY_HOOKS_FLOW_THEME, SUPPORTED_HOOK_EVENTS } from "./ClaudeHooksConfigPanel/constants";
import { HookScopeSection } from "./ClaudeHooksConfigPanel/HookScopeSection";
import { HookEditModal } from "./ClaudeHooksConfigPanel/HookEditModal";
import { HooksFlowModal } from "./ClaudeHooksConfigPanel/HooksFlowModal";
import { HooksImportModal } from "./ClaudeHooksConfigPanel/HooksImportModal";
import type { ClaudeHooksConfigPanelHandle, EditingTarget, HookEditFormValues, HookFlowEntry, HooksFlowTheme } from "./ClaudeHooksConfigPanel/types";
import { getSupportedTypesByEvent, handlerSummary, resolveHookHandlerTargetPath } from "./ClaudeHooksConfigPanel/helpers";
import { useHooksImport } from "./ClaudeHooksConfigPanel/useHooksImport";
import { filterOmcFromHooksStatus } from "../utils/omcPluginDetect";
import "./ClaudeCodeToolsPanel/index.css";

export type { ClaudeHooksConfigPanelHandle } from "./ClaudeHooksConfigPanel/types";

interface Props {
  repositoryPath?: string;
  active?: boolean;
  /** 与右栏工具条搜索联动，筛选事件 / matcher / handler。 */
  listSearch?: string;
  onBindActions?: (actions: ClaudeHooksConfigPanelHandle | null) => void;
  onCountChange?: (count: number) => void;
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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditingTarget>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const [flowTheme, setFlowTheme] = useState<HooksFlowTheme>("light-tech");
  const userSectionRef = useRef<HTMLElement | null>(null);
  const projectSectionRef = useRef<HTMLElement | null>(null);
  const localSectionRef = useRef<HTMLElement | null>(null);
  const [form] = Form.useForm<HookEditFormValues>();
  const selectedEventName = Form.useWatch("eventName", form);
  const selectedType = Form.useWatch("type", form);
  const supportedTypesForSelectedEvent = useMemo(
    () => getSupportedTypesByEvent(selectedEventName),
    [selectedEventName],
  );
  const typeOptionsForSelectedEvent = useMemo<Array<{ value: ClaudeHookHandler["type"]; label: string }>>(
    () =>
      [
        { value: "command" as const, label: "command" },
        { value: "http" as const, label: "http" },
        { value: "prompt" as const, label: "prompt" },
        { value: "agent" as const, label: "agent" },
      ].filter((opt) => supportedTypesForSelectedEvent.includes(opt.value)),
    [supportedTypesForSelectedEvent],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getClaudeHooksStatus(repositoryPath ?? null);
      setData(filterOmcFromHooksStatus(res));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [message, repositoryPath]);
  const hooksImport = useHooksImport({
    data,
    repositoryPath,
    load,
    message,
    modal,
  });

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
  const eventOptions = useMemo(() => {
    const existing = new Set<string>([
      ...Object.keys(data.user.hooks),
      ...Object.keys(data.project.hooks),
      ...Object.keys(data.local.hooks),
    ]);
    for (const eventName of SUPPORTED_HOOK_EVENTS) existing.add(eventName);
    return Array.from(existing)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v }));
  }, [data.local.hooks, data.project.hooks, data.user.hooks]);

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

  const openHookTarget = useCallback(
    async (handler: ClaudeHookHandler, matcher?: string | null) => {
      const repo = repositoryPath?.trim() ?? "";
      const relativePath = resolveHookHandlerTargetPath(handler, matcher);
      if (!repo) {
        message.warning("请先选择仓库");
        return;
      }
      if (!relativePath) {
        message.warning("无法解析该处理器对应的文件路径");
        return;
      }
      const normalizedPath = relativePath.replace(/\/+$/, "");
      let isDirectory = normalizedPath.endsWith("/");
      if (!isDirectory) {
        try {
          const parent = normalizedPath.includes("/")
            ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/"))
            : "";
          const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
          const entries = await listRepositoryExplorerChildren(repo, parent);
          const hit = entries.find(
            (entry) =>
              entry.path === normalizedPath ||
              entry.path.endsWith(`/${baseName}`) ||
              entry.path.split("/").pop() === baseName,
          );
          isDirectory = hit?.isDir ?? false;
        } catch {
          isDirectory = false;
        }
      }
      try {
        await openRepositoryEntryInPreferredEditor(repo, normalizedPath, { isDirectory });
      } catch (error) {
        const code = error instanceof Error ? error.message : String(error);
        if (code === OPEN_WORKSPACE_ERROR.NO_TARGET || code === OPEN_WORKSPACE_ERROR.NOT_CONFIGURED) {
          message.warning("未找到可用编辑器，请先在「打开方式」中配置");
          return;
        }
        message.warning(isDirectory ? "该目录不存在或无法打开" : "该文件不存在或无法打开");
      }
    },
    [message, repositoryPath],
  );

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
        await load();
      },
    });
  }, [load, message, modal, repositoryPath]);

  const onToggleDisableAll = useCallback(async (scope: ClaudeHookSourceScope, next: boolean) => {
    try {
      await setClaudeDisableAllHooks({ scope, disableAllHooks: next, repositoryPath: repositoryPath ?? null });
      setData((prev) => ({ ...prev, [scope]: { ...prev[scope], disableAllHooks: next } }));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  }, [message, repositoryPath]);

  const onCopyEventName = useCallback(async (eventName: string) => {
    try {
      await navigator.clipboard.writeText(eventName);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  }, [message]);

  const scrollToScope = useCallback((scope: ClaudeHookSourceScope) => {
    const el = scope === "user"
      ? userSectionRef.current
      : scope === "project"
        ? projectSectionRef.current
        : localSectionRef.current;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const visibleScopes = useMemo(
    () => [data.user, data.project, data.local, ...(data.plugins ?? [])],
    [data.local, data.plugins, data.project, data.user],
  );
  const hasAnyData = visibleScopes.some((scope) => Object.keys(scope.hooks).length > 0);
  const projectScopeUnavailable = Boolean(repositoryPath) && data.project.sourcePath.startsWith("<请选择项目");
  const pluginHookCount = useMemo(
    () =>
      (data.plugins ?? []).reduce(
        (acc, scopeData) =>
          acc
          + Object.values(scopeData.hooks).reduce(
            (sum, groups) => sum + groups.reduce((gSum, g) => gSum + g.hooks.length, 0),
            0,
          ),
        0,
      ),
    [data.plugins],
  );
  const filterStats = useMemo(() => {
    const count = (scopeData: ClaudeHookScopeData) =>
      Object.values(scopeData.hooks).reduce(
        (acc, groups) => acc + groups.reduce((sum, g) => sum + g.hooks.length, 0),
        0,
      );
    return {
      user: count(data.user),
      project: count(data.project),
      local: count(data.local),
      plugin: pluginHookCount,
    };
  }, [data.local, data.project, data.user, pluginHookCount]);
  const hooksCount = useMemo(
    () => filterStats.user + filterStats.project + filterStats.local + filterStats.plugin,
    [filterStats.local, filterStats.plugin, filterStats.project, filterStats.user],
  );
  useEffect(() => {
    onCountChange?.(hooksCount);
  }, [hooksCount, onCountChange]);
  const eventHookCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    const allScopes = [data.user, data.project, data.local, ...(data.plugins ?? [])];
    for (const scopeData of allScopes) {
      for (const [eventName, groups] of Object.entries(scopeData.hooks)) {
        const count = groups.reduce((sum, group) => sum + group.hooks.length, 0);
        map[eventName] = (map[eventName] ?? 0) + count;
      }
    }
    return map;
  }, [data.local, data.plugins, data.project, data.user]);
  const flowEventEntriesMap = useMemo(() => {
    const map: Record<string, HookFlowEntry[]> = {};
    const allScopes: Array<{ scope: ClaudeHookSourceScope; scopeData: ClaudeHookScopeData }> = [
      { scope: "user", scopeData: data.user },
      { scope: "project", scopeData: data.project },
      { scope: "local", scopeData: data.local },
      ...(data.plugins ?? []).map((scopeData) => ({ scope: "user" as const, scopeData })),
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
  }, [data.local, data.plugins, data.project, data.user]);

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
      <div className="app-hooks-stats-bar">
        <button type="button" className="app-hooks-stats-btn" onClick={() => scrollToScope("user")}>
          <Tag variant="filled">user: {filterStats.user}</Tag>
        </button>
        <button type="button" className="app-hooks-stats-btn" onClick={() => scrollToScope("project")}>
          <Tag variant="filled">project: {filterStats.project}</Tag>
        </button>
        <button type="button" className="app-hooks-stats-btn" onClick={() => scrollToScope("local")}>
          <Tag variant="filled">local: {filterStats.local}</Tag>
        </button>
        {filterStats.plugin > 0 ? (
          <Tag variant="filled">plugin: {filterStats.plugin}</Tag>
        ) : null}
      </div>
      {loading ? (
        <div className="app-hooks-loading"><Spin size="small" /></div>
      ) : !hasAnyData ? (
        <Empty description="暂无触发器规则，可点击「新增触发器」" image={Empty.PRESENTED_IMAGE_SIMPLE} />
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
            onOpenTarget={openHookTarget}
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
            onOpenTarget={openHookTarget}
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
            onOpenTarget={openHookTarget}
            keyword={listSearch}
          />
          {(data.plugins ?? []).map((pluginScope, index) => (
            <HookScopeSection
              key={pluginScope.sourcePath || `plugin-${index}`}
              scope="user"
              title={`插件 Hooks（只读）${pluginScope.sourcePath ? ` · ${pluginScope.sourcePath.split("/").slice(-3, -1).join("/")}` : ""}`}
              data={pluginScope}
              onCreate={openCreate}
              onEdit={openEdit}
              onDelete={onDelete}
              onToggleDisableAll={onToggleDisableAll}
              onOpenTarget={openHookTarget}
              keyword={listSearch}
              readOnly
            />
          ))}
        </div>
      )}

      <HooksFlowModal
        open={flowOpen}
        flowTheme={flowTheme}
        eventHookCountMap={eventHookCountMap}
        flowEventEntriesMap={flowEventEntriesMap}
        defaultCreateScope={repositoryPath ? "project" : "user"}
        onClose={() => setFlowOpen(false)}
        onThemeChange={setFlowTheme}
        onCreate={(scope, eventName) => openCreate(scope, eventName)}
        onCopyEventName={(eventName) => void onCopyEventName(eventName)}
        onEdit={openEdit}
      />
      <HookEditModal
        open={open}
        editing={editing}
        form={form}
        eventOptions={eventOptions}
        typeOptions={typeOptionsForSelectedEvent}
        selectedEventName={selectedEventName}
        submitting={submitting}
        submittingAndContinue={submittingAndContinue}
        onClose={() => setOpen(false)}
        onSubmit={(keepOpen) => void onSubmit(keepOpen)}
      />
      <HooksImportModal
        open={hooksImport.importOpen}
        form={hooksImport.importForm}
        importing={hooksImport.importing}
        importStep={hooksImport.importStep}
        importReport={hooksImport.importReport}
        importDryRun={hooksImport.importDryRun}
        importExecutionLog={hooksImport.importExecutionLog}
        importFailedCount={hooksImport.importFailedCount}
        onClose={() => hooksImport.setImportOpen(false)}
        onPreview={() => void hooksImport.onPreviewImport()}
        onImport={() => void hooksImport.onImportHooks()}
        onCopyLog={() => void hooksImport.onCopyImportLog()}
        onCopyFailedAsReplayJson={() => void hooksImport.onCopyFailedAsReplayJson()}
        onFillFailedAsReplayJson={hooksImport.onFillFailedAsReplayJson}
        onRetryFailedImports={() => void hooksImport.onRetryFailedImports()}
      />
    </div>
  );
}
