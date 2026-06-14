import { DeleteOutlined, EditOutlined, FolderOpenOutlined } from "@ant-design/icons";
import {
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClaudeSubagentItem, ClaudeSubagentScope } from "../../types";
import {
  createClaudeSubagent,
  deleteClaudeSubagent,
  getClaudeMcpStatus,
  getClaudeUserAgentsDir,
  getClaudeSubagentDetail,
  listClaudeSubagents,
  saveClaudeSubagent,
} from "../../services/claude";
import { openWorkspaceIn } from "../../services/repository";
import {
  composeSubagentRawFromForm,
  readFrontmatterField,
  splitCsv,
  validateSubagentForm,
} from "../../utils/subagentFrontmatter";
import { DEFAULT_OPEN_APP_ID, DEFAULT_OPEN_APP_TARGETS } from "../OpenAppMenu/constants";
import { getOpenAppPreferenceSync, hydrateOpenAppPreference } from "../../services/openAppPreference";

interface Props {
  repositoryPath?: string;
  active: boolean;
  /** 与右栏工具条搜索联动，仅影响列表展示。 */
  listSearch?: string;
  onBindActions?: (actions: SubagentsPanelHandle | null) => void;
  onCountChange?: (count: number) => void;
}

function subagentMatchesListSearch(item: ClaudeSubagentItem, listSearch: string): boolean {
  const needle = listSearch.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    item.name,
    item.description,
    item.sourcePath,
    item.scope,
    item.model ?? "",
    item.permissionMode ?? "",
    item.memory ?? "",
    ...item.tools,
    ...item.disallowedTools,
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(needle);
}

export interface SubagentsPanelHandle {
  refresh: () => void;
  openCreateModal: () => void;
  openAgentsRoot: () => void;
}

type EditMode = "form" | "raw";
const BUILTIN_SUBAGENT_TOOL_OPTIONS = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
  "Glob",
  "Grep",
  "LS",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "Task",
];

export function SubagentsPanel({
  repositoryPath,
  active,
  listSearch = "",
  onBindActions,
  onCountChange,
}: Props) {
  function resolvePreferredEditorTarget() {
    const selectedId = getOpenAppPreferenceSync() || DEFAULT_OPEN_APP_ID;
    const selected = DEFAULT_OPEN_APP_TARGETS.find((t) => t.id === selectedId);
    if (selected && selected.kind !== "finder") return selected;
    return DEFAULT_OPEN_APP_TARGETS.find((t) => t.kind !== "finder") ?? null;
  }

  async function openInPreferredEditor(path: string) {
    const target = resolvePreferredEditorTarget();
    if (!target) {
      message.warning("未找到可用编辑器，请先在“打开方式”中配置");
      return;
    }
    if (target.kind === "command") {
      await openWorkspaceIn(path, { command: target.command, args: target.args });
    } else {
      await openWorkspaceIn(path, { appName: target.appName, args: target.args });
    }
  }

  const [list, setList] = useState<ClaudeSubagentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newScope, setNewScope] = useState<ClaudeSubagentScope>("project");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newTools, setNewTools] = useState("");
  const [newDisallowedTools, setNewDisallowedTools] = useState("");
  const [newPermissionMode, setNewPermissionMode] = useState("");
  const [newMemory, setNewMemory] = useState("");
  const [newEffort, setNewEffort] = useState("");
  const [newBackground, setNewBackground] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [editing, setEditing] = useState<ClaudeSubagentItem | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("form");
  const [editRaw, setEditRaw] = useState("");
  const [editBaseline, setEditBaseline] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editTools, setEditTools] = useState("");
  const [editDisallowedTools, setEditDisallowedTools] = useState("");
  const [editPermissionMode, setEditPermissionMode] = useState("");
  const [editMemory, setEditMemory] = useState("");
  const [editEffort, setEditEffort] = useState("");
  const [editBackground, setEditBackground] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [mcpToolOptions, setMcpToolOptions] = useState<string[]>([]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listClaudeSubagents(repositoryPath ?? null);
      setList(rows);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [repositoryPath]);
  const visibleSorted = useMemo(() => {
    return [...list].sort((a, b) => {
      if (a.isCollaborationMode !== b.isCollaborationMode) {
        return a.isCollaborationMode ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [list]);

  const displayList = useMemo(() => {
    if (!listSearch.trim()) return visibleSorted;
    return visibleSorted.filter((item) => subagentMatchesListSearch(item, listSearch));
  }, [visibleSorted, listSearch]);

  useEffect(() => {
    onBindActions?.({
      refresh: () => void load(),
      openCreateModal: () => setCreateOpen(true),
      openAgentsRoot: () => void openAgentsRoot(),
    });
    return () => onBindActions?.(null);
  }, [load, onBindActions, repositoryPath]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  useEffect(() => {
    onCountChange?.(visibleSorted.length);
  }, [visibleSorted.length, onCountChange]);

  useEffect(() => {
    void hydrateOpenAppPreference();
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    async function loadMcpTools() {
      try {
        const status = await getClaudeMcpStatus(repositoryPath ?? null);
        const tools = new Set<string>();
        for (const row of [
          ...status.user,
          ...status.local,
          ...status.projectShared,
          ...status.legacyUserSettings,
          ...status.legacyProjectSettings,
        ]) {
          for (const t of row.tools) {
            const name = t.trim();
            if (name) tools.add(name);
          }
        }
        if (!cancelled) setMcpToolOptions(Array.from(tools));
      } catch {
        if (!cancelled) setMcpToolOptions([]);
      }
    }
    void loadMcpTools();
    return () => {
      cancelled = true;
    };
  }, [active, repositoryPath]);

  const byId = useMemo(() => {
    const m = new Map<string, ClaudeSubagentItem>();
    for (const item of list) m.set(item.id, item);
    return m;
  }, [list]);
  const formValidation = useMemo(
    () =>
      validateSubagentForm({
        description: editDescription,
        model: editModel,
        tools: editTools,
        disallowedTools: editDisallowedTools,
        permissionMode: editPermissionMode,
        memory: editMemory,
        effort: editEffort,
        background: editBackground,
        prompt: editPrompt,
      }),
    [editBackground, editDescription, editDisallowedTools, editEffort, editMemory, editModel, editPermissionMode, editPrompt, editTools],
  );
  const pendingRaw = useMemo(
    () =>
      editMode === "form"
        ? composeSubagentRawFromForm(editing?.name ?? "", {
            description: editDescription,
            model: editModel,
            tools: editTools,
            disallowedTools: editDisallowedTools,
            permissionMode: editPermissionMode,
            memory: editMemory,
            effort: editEffort,
            background: editBackground,
            prompt: editPrompt,
          })
        : editRaw,
    [
      editMode,
      editRaw,
      editing?.name,
      editDescription,
      editModel,
      editTools,
      editDisallowedTools,
      editPermissionMode,
      editMemory,
      editEffort,
      editBackground,
      editPrompt,
    ],
  );
  const editSaveDisabled = editLoading || pendingRaw === editBaseline || (editMode === "form" && formValidation.length > 0);
  const createValidation = useMemo(
    () =>
      validateSubagentForm({
        description: newDescription,
        model: newModel,
        tools: newTools,
        disallowedTools: newDisallowedTools,
        permissionMode: newPermissionMode,
        memory: newMemory,
        effort: newEffort,
        background: newBackground,
        prompt: newPrompt,
      }),
    [newBackground, newDescription, newDisallowedTools, newEffort, newMemory, newModel, newPermissionMode, newPrompt, newTools],
  );
  const createToolsValues = useMemo(() => splitCsv(newTools), [newTools]);
  const createDisallowedToolValues = useMemo(() => splitCsv(newDisallowedTools), [newDisallowedTools]);
  const editToolsValues = useMemo(() => splitCsv(editTools), [editTools]);
  const editDisallowedToolValues = useMemo(() => splitCsv(editDisallowedTools), [editDisallowedTools]);
  const toolSelectOptions = useMemo(() => {
    const all = new Set<string>([
      ...BUILTIN_SUBAGENT_TOOL_OPTIONS,
      ...mcpToolOptions,
      ...createToolsValues,
      ...createDisallowedToolValues,
      ...editToolsValues,
      ...editDisallowedToolValues,
    ]);
    return Array.from(all).map((value) => ({ value, label: value }));
  }, [createDisallowedToolValues, createToolsValues, editDisallowedToolValues, editToolsValues, mcpToolOptions]);
  const displayDescription = (raw: string) => {
    const t = raw.trim();
    if (!t || t === "|" || t === "-" || t === "—") return "未填写描述";
    return t;
  };

  async function openAgentsRoot() {
    try {
      if (repositoryPath) {
        const target = resolvePreferredEditorTarget();
        if (!target) {
          message.warning("未找到可用编辑器，请先在“打开方式”中配置");
          return;
        }
        const locateOptions = { graphIdeFolderRelative: ".claude/agents" };
        if (target.kind === "command") {
          await openWorkspaceIn(repositoryPath, { command: target.command, args: target.args, ...locateOptions });
        } else {
          await openWorkspaceIn(repositoryPath, { appName: target.appName, args: target.args, ...locateOptions });
        }
      } else {
        const userAgentsDir = await getClaudeUserAgentsDir();
        await openInPreferredEditor(userAgentsDir);
      }
    } catch {
      message.warning("无法打开目录");
    }
  }

  async function openSubagentLocation(item: ClaudeSubagentItem) {
    if (item.scope === "project") {
      if (!repositoryPath) {
        message.warning("请先选择仓库");
        return;
      }
      const target = resolvePreferredEditorTarget();
      if (!target) {
        message.warning("未找到可用编辑器，请先在“打开方式”中配置");
        return;
      }
      const filename = item.sourcePath.split(/[\\/]/).pop()?.trim() || `${item.name}.md`;
      const locateOptions = { ideGotoRelative: `.claude/agents/${filename}`, gotoLine: 1, gotoColumn: 1 };
      try {
        if (target.kind === "command") {
          await openWorkspaceIn(repositoryPath, { command: target.command, args: target.args, ...locateOptions });
        } else {
          await openWorkspaceIn(repositoryPath, { appName: target.appName, args: target.args, ...locateOptions });
        }
      } catch {
        message.warning("该子代理文件不存在");
      }
      return;
    }
    if (item.scope === "plugin") {
      const source = item.sourcePath;
      const agentsDir = source?.replace(/[\\/][^\\/]+$/, "");
      if (!agentsDir) {
        message.warning("未找到插件子代理目录");
        return;
      }
      try {
        await openInPreferredEditor(agentsDir);
      } catch {
        message.warning("无法打开插件子代理目录");
      }
      return;
    }
    try {
      await openInPreferredEditor(item.sourcePath);
    } catch {
      message.warning("无法打开用户级子代理文件");
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      message.warning("名称仅允许小写字母、数字和连字符，且必须以字母/数字开头");
      return;
    }
    if (createValidation.length > 0) {
      message.warning(createValidation[0]);
      return;
    }
    if (newScope === "project" && !repositoryPath) {
      message.warning("project 作用域需要先选择仓库");
      return;
    }
    setCreating(true);
    try {
      await createClaudeSubagent({
        scope: newScope,
        name,
        description: newDescription.trim(),
        repositoryPath: repositoryPath ?? null,
      });
      await saveClaudeSubagent({
        scope: newScope,
        name,
        rawContent: composeSubagentRawFromForm(name, {
          description: newDescription,
          model: newModel,
          tools: newTools,
          disallowedTools: newDisallowedTools,
          permissionMode: newPermissionMode,
          memory: newMemory,
          effort: newEffort,
          background: newBackground,
          prompt: newPrompt,
        }),
        repositoryPath: repositoryPath ?? null,
      });
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      setNewModel("");
      setNewTools("");
      setNewDisallowedTools("");
      setNewPermissionMode("");
      setNewMemory("");
      setNewEffort("");
      setNewBackground("");
      setNewPrompt("");
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleEdit(item: ClaudeSubagentItem) {
    setEditing(item);
    setEditLoading(true);
    try {
      const d = await getClaudeSubagentDetail({
        scope: item.scope,
        name: item.name,
        repositoryPath: repositoryPath ?? null,
      });
      setEditRaw(d.rawContent);
      setEditBaseline(d.rawContent);
      setEditDescription(d.description ?? "");
      setEditModel(d.model ?? "");
      setEditTools(d.tools.join(", "));
      setEditDisallowedTools(d.disallowedTools.join(", "));
      setEditPermissionMode(readFrontmatterField(d.frontmatter, "permissionMode"));
      setEditMemory(readFrontmatterField(d.frontmatter, "memory"));
      setEditEffort(readFrontmatterField(d.frontmatter, "effort"));
      setEditBackground(readFrontmatterField(d.frontmatter, "background"));
      setEditPrompt(d.prompt ?? "");
      setEditMode("form");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
      setEditing(null);
    } finally {
      setEditLoading(false);
    }
  }

  async function handleSaveEdit() {
    if (!editing) return;
    if (editMode === "form" && formValidation.length > 0) {
      message.warning(formValidation[0]);
      return;
    }
    const content = pendingRaw;
    setEditSaving(true);
    try {
      await saveClaudeSubagent({
        scope: editing.scope,
        name: editing.name,
        rawContent: content,
        repositoryPath: repositoryPath ?? null,
      });
      setEditRaw(content);
      setEditBaseline(content);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(item: ClaudeSubagentItem) {
    try {
      await deleteClaudeSubagent({
        scope: item.scope,
        name: item.name,
        repositoryPath: repositoryPath ?? null,
      });
      if (editing && editing.id === item.id) {
        setEditing(null);
      }
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="app-subagents-panel">
      <div className="app-subagents-list-wrap">
        <div className="app-subagents-count">
          结果：{displayList.length} / {visibleSorted.length}
        </div>
        {loading && visibleSorted.length === 0 ? (
          <div className="app-subagents-loading">
            <Spin size="small" />
          </div>
        ) : visibleSorted.length === 0 ? (
          <Empty description="暂无 subagents，点击「新建」创建" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : displayList.length === 0 ? (
          <Empty description="没有符合筛选的子代理" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="app-subagents-list">
            {displayList.map((item) => (
              <div key={item.id} className="app-subagents-card">
                <div className="app-subagents-card-head">
                  <span className="app-subagents-name">{item.name}</span>
                  <Space size={4}>
                    <Tag color={item.scope === "project" ? "blue" : item.scope === "plugin" ? "gold" : "purple"}>{item.scope}</Tag>
                    {item.isCollaborationMode ? <Tag color="cyan">协作模式</Tag> : null}
                    <Tag color={item.isActive ? "green" : "default"}>
                      {item.isActive ? "生效中" : "已被覆盖"}
                    </Tag>
                  </Space>
                </div>
                <div className="app-subagents-desc">{displayDescription(item.description)}</div>
                <div className="app-subagents-card-meta">
                  {item.model ? (
                    <div className="app-subagents-meta-row">
                      <span className="app-subagents-meta-key">model</span>
                      <span className="app-subagents-meta-value">{item.model}</span>
                    </div>
                  ) : null}
                  {item.tools.length > 0 ? (
                    <div className="app-subagents-meta-row">
                      <span className="app-subagents-meta-key">tools</span>
                      <span className="app-subagents-meta-value app-subagents-meta-value--tools">
                        {item.tools.join(", ")}
                      </span>
                    </div>
                  ) : null}
                  <div className="app-subagents-tags">
                    {item.permissionMode ? <Tag>{`permission: ${item.permissionMode}`}</Tag> : null}
                    {item.memory ? <Tag>{`memory: ${item.memory}`}</Tag> : null}
                  </div>
                  {!item.isActive && item.overriddenById ? (
                    <span className="app-subagents-overridden">
                      覆盖者:{" "}
                      {(() => {
                        const over = byId.get(item.overriddenById);
                        return over ? `${over.name} (${over.scope})` : item.overriddenById;
                      })()}
                    </span>
                  ) : null}
                </div>
                <div className="app-subagents-card-actions">
                  {item.scope !== "plugin" ? (
                    <Button
                      size="small"
                      type="text"
                      className="app-subagents-action-btn"
                      icon={<EditOutlined />}
                      onClick={() => void handleEdit(item)}
                    >
                      编辑
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    type="text"
                    className="app-subagents-action-btn"
                    icon={<FolderOpenOutlined />}
                    onClick={() => void openSubagentLocation(item)}
                  >
                    {item.scope === "project" ? "打开文件" : "打开目录"}
                  </Button>
                  {item.scope !== "plugin" ? (
                    <Popconfirm
                      title={`删除 ${item.name}？`}
                      description="将删除该 subagent 文件，且不可恢复。"
                      okText="删除"
                      okType="danger"
                      cancelText="取消"
                      onConfirm={() => void handleDelete(item)}
                    >
                      <Button size="small" type="text" danger className="app-subagents-action-btn" icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        title="新建 Subagent"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreate()}
        okText="创建"
        width={920}
        okButtonProps={{ disabled: creating || createValidation.length > 0 }}
        confirmLoading={creating}
        destroyOnHidden
      >
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Select
            value={newScope}
            onChange={(v) => setNewScope(v)}
            style={{ width: "100%" }}
            options={[
              { value: "project", label: "project（当前仓库）" },
              { value: "user", label: "user（全局）" },
            ]}
          />
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="name（如 code-reviewer）" />
          <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="description" />
          <Input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="model（如 inherit/sonnet）" />
          <Select
            mode="tags"
            value={createToolsValues}
            onChange={(values) => setNewTools(values.join(", "))}
            options={toolSelectOptions}
            placeholder="tools（可多选，可输入自定义）"
            style={{ width: "100%" }}
          />
          <Select
            mode="tags"
            value={createDisallowedToolValues}
            onChange={(values) => setNewDisallowedTools(values.join(", "))}
            options={toolSelectOptions}
            placeholder="disallowedTools（可多选，可输入自定义）"
            style={{ width: "100%" }}
          />
          <div className="app-subagents-select-row-four">
            <Select
              value={newPermissionMode || undefined}
              allowClear
              onChange={(v) => setNewPermissionMode(v ?? "")}
              placeholder="permissionMode"
              options={[
                { value: "default", label: "default" },
                { value: "acceptEdits", label: "acceptEdits" },
                { value: "auto", label: "auto" },
                { value: "dontAsk", label: "dontAsk" },
                { value: "bypassPermissions", label: "bypassPermissions" },
                { value: "plan", label: "plan" },
              ]}
            />
            <Select
              value={newMemory || undefined}
              allowClear
              onChange={(v) => setNewMemory(v ?? "")}
              placeholder="memory"
              options={[
                { value: "user", label: "user" },
                { value: "project", label: "project" },
                { value: "local", label: "local" },
              ]}
            />
            <Select
              value={newEffort || undefined}
              allowClear
              onChange={(v) => setNewEffort(v ?? "")}
              placeholder="effort"
              options={[
                { value: "low", label: "low" },
                { value: "medium", label: "medium" },
                { value: "high", label: "high" },
                { value: "max", label: "max" },
              ]}
            />
            <Select
              value={newBackground || undefined}
              allowClear
              onChange={(v) => setNewBackground(v ?? "")}
              placeholder="background"
              options={[
                { value: "true", label: "true" },
                { value: "false", label: "false" },
              ]}
            />
          </div>
          <Input.TextArea
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            rows={12}
            placeholder="subagent system prompt"
          />
          {createValidation.length > 0 ? (
            <Typography.Text type="danger">校验失败：{createValidation.join("；")}</Typography.Text>
          ) : null}
        </Space>
      </Modal>

      <Modal
        title={editing ? `编辑 ${editing.name}` : "编辑 Subagent"}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void handleSaveEdit()}
        okText="保存"
        width={920}
        confirmLoading={editSaving}
        okButtonProps={{ disabled: editSaveDisabled }}
        destroyOnHidden
      >
        {editLoading ? (
          <div className="app-subagents-loading">
            <Spin size="small" />
          </div>
        ) : (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Typography.Text type="secondary">支持字段化编辑与 Raw 双模式。</Typography.Text>
              <Radio.Group
                size="small"
                value={editMode}
                onChange={(e) => setEditMode(e.target.value as EditMode)}
                options={[
                  { label: "字段模式", value: "form" },
                  { label: "Raw 模式", value: "raw" },
                ]}
                optionType="button"
                buttonStyle="solid"
              />
            </Space>
            {editMode === "form" ? (
              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                <Input value={editing?.name} disabled />
                <Input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="description"
                />
                <Input value={editModel} onChange={(e) => setEditModel(e.target.value)} placeholder="model（如 inherit/sonnet）" />
                <Select
                  mode="tags"
                  value={editToolsValues}
                  onChange={(values) => setEditTools(values.join(", "))}
                  options={toolSelectOptions}
                  placeholder="tools（可多选，可输入自定义）"
                />
                <Select
                  mode="tags"
                  value={editDisallowedToolValues}
                  onChange={(values) => setEditDisallowedTools(values.join(", "))}
                  options={toolSelectOptions}
                  placeholder="disallowedTools（可多选，可输入自定义）"
                  style={{ width: "100%" }}
                />
                <div className="app-subagents-select-row-four">
                  <Select
                    value={editPermissionMode || undefined}
                    allowClear
                    onChange={(v) => setEditPermissionMode(v ?? "")}
                    placeholder="permissionMode"
                    options={[
                      { value: "default", label: "default" },
                      { value: "acceptEdits", label: "acceptEdits" },
                      { value: "auto", label: "auto" },
                      { value: "dontAsk", label: "dontAsk" },
                      { value: "bypassPermissions", label: "bypassPermissions" },
                      { value: "plan", label: "plan" },
                    ]}
                  />
                  <Select
                    value={editMemory || undefined}
                    allowClear
                    onChange={(v) => setEditMemory(v ?? "")}
                    placeholder="memory"
                    options={[
                      { value: "user", label: "user" },
                      { value: "project", label: "project" },
                      { value: "local", label: "local" },
                    ]}
                  />
                  <Select
                    value={editEffort || undefined}
                    allowClear
                    onChange={(v) => setEditEffort(v ?? "")}
                    placeholder="effort"
                    options={[
                      { value: "low", label: "low" },
                      { value: "medium", label: "medium" },
                      { value: "high", label: "high" },
                      { value: "max", label: "max" },
                    ]}
                  />
                  <Select
                    value={editBackground || undefined}
                    allowClear
                    onChange={(v) => setEditBackground(v ?? "")}
                    placeholder="background"
                    options={[
                      { value: "true", label: "true" },
                      { value: "false", label: "false" },
                    ]}
                  />
                </div>
                <Input.TextArea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  rows={12}
                  placeholder="subagent system prompt"
                />
                {formValidation.length > 0 ? (
                  <Typography.Text type="danger">校验失败：{formValidation.join("；")}</Typography.Text>
                ) : null}
              </Space>
            ) : (
              <Input.TextArea value={editRaw} onChange={(e) => setEditRaw(e.target.value)} rows={22} />
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
}

