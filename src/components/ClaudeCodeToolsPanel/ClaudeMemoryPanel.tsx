import { FileTextOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { Button, Empty, Spin, Switch, Tag, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClaudeMemoryFileItem, ClaudeMemorySettingsScope, ClaudeMemoryStatusResponse } from "../../types";
import { getClaudeMemoryStatus, setClaudeAutoMemoryEnabled, ensureClaudeRulesDir } from "../../services/claude";
import { openWorkspaceIn } from "../../services/repository";
import { DEFAULT_OPEN_APP_ID, DEFAULT_OPEN_APP_TARGETS } from "../OpenAppMenu/constants";
import { getOpenAppPreferenceSync, hydrateOpenAppPreference } from "../../services/openAppPreference";

interface Props {
  repositoryPath?: string;
  active?: boolean;
  listSearch?: string;
  onBindActions?: (actions: ClaudeMemoryPanelHandle | null) => void;
  onCountChange?: (count: number) => void;
}

export interface ClaudeMemoryPanelHandle {
  refresh: () => void;
  openMemoryRoot: () => void;
  openRulesRoot: () => void;
}

const SCOPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  user: { label: "用户全局", color: "#8b5cf6", bg: "rgba(139, 92, 246, 0.08)" },
  project: { label: "项目", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.08)" },
  local: { label: "本地", color: "#f97316", bg: "rgba(249, 115, 22, 0.08)" },
  auto: { label: "自动", color: "#10b981", bg: "rgba(16, 185, 129, 0.08)" },
};

const KIND_SECTIONS: Array<{ key: ClaudeMemoryFileItem["kind"]; title: string; hint: string }> = [
  { key: "instruction", title: "持久指令", hint: "CLAUDE.md / AGENTS.md" },
  { key: "rule", title: "路径规则", hint: ".claude/rules/" },
  { key: "auto_memory", title: "自动记忆", hint: "MEMORY.md 启动加载前 200 行" },
  { key: "legacy", title: "旧版", hint: "project-memory.md" },
];

function resolvePreferredEditorTarget() {
  const selectedId = getOpenAppPreferenceSync() || DEFAULT_OPEN_APP_ID;
  const selected = DEFAULT_OPEN_APP_TARGETS.find((t) => t.id === selectedId);
  if (selected && selected.kind !== "finder") return selected;
  return DEFAULT_OPEN_APP_TARGETS.find((t) => t.kind !== "finder") ?? null;
}

function memoryMatchesSearch(item: ClaudeMemoryFileItem, listSearch: string): boolean {
  const needle = listSearch.trim().toLowerCase();
  if (!needle) return true;
  const hay = [item.label, item.sourcePath, item.scope, item.kind, ...item.pathPatterns].join("\n").toLowerCase();
  return hay.includes(needle);
}

function shouldShowMemoryItem(item: ClaudeMemoryFileItem, listSearch: string): boolean {
  if (!memoryMatchesSearch(item, listSearch)) return false;
  if (listSearch.trim()) return true;
  if (item.kind === "auto_memory" || item.kind === "rule") return true;
  return item.exists;
}

function isRuleDirAnchor(item: ClaudeMemoryFileItem): boolean {
  return item.id.startsWith("rule_dir:");
}

function formatSettingScopeLabel(scope: string): string {
  if (scope === "user") return "用户 settings";
  if (scope === "project") return "项目 settings";
  if (scope === "local") return "本地 settings";
  if (scope === "default") return "默认值";
  return scope;
}

function compactPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  for (const pattern of [/^\/Users\/[^/]+(\/.*)?$/, /^\/home\/[^/]+(\/.*)?$/]) {
    const match = normalized.match(pattern);
    if (match) return `~${match[1] ?? ""}`;
  }
  return normalized;
}

export function ClaudeMemoryPanel({
  repositoryPath,
  active = true,
  listSearch = "",
  onBindActions,
  onCountChange,
}: Props) {
  const [data, setData] = useState<ClaudeMemoryStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [toggleScope, setToggleScope] = useState<ClaudeMemorySettingsScope>("project");
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getClaudeMemoryStatus(repositoryPath ?? null);
      setData(res);
      const scope = res.autoMemoryEnabledSource.scope;
      if (scope === "user" || scope === "project" || scope === "local") {
        setToggleScope(scope);
      } else if (repositoryPath?.trim()) {
        setToggleScope("project");
      } else {
        setToggleScope("user");
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [repositoryPath]);

  const openInPreferredEditor = useCallback(async (path: string) => {
    const target = resolvePreferredEditorTarget();
    if (!target) {
      message.warning("未找到可用编辑器，请先在「打开方式」中配置");
      return;
    }
    if (target.kind === "command") {
      await openWorkspaceIn(path, { command: target.command, args: target.args, gotoLine: 1, gotoColumn: 1 });
    } else {
      await openWorkspaceIn(path, { appName: target.appName, args: target.args, gotoLine: 1, gotoColumn: 1 });
    }
  }, []);

  const openMemoryRoot = useCallback(async () => {
    const root = data?.autoMemoryPath?.trim();
    if (!root) {
      message.warning("未解析到自动记忆目录");
      return;
    }
    const target = resolvePreferredEditorTarget();
    if (!target) {
      message.warning("未找到可用编辑器，请先在「打开方式」中配置");
      return;
    }
    if (target.kind === "command") {
      await openWorkspaceIn(root, { command: target.command, args: target.args });
    } else {
      await openWorkspaceIn(root, { appName: target.appName, args: target.args });
    }
  }, [data?.autoMemoryPath]);

  const openRulesRoot = useCallback(async () => {
    const scope = repositoryPath?.trim() ? "project" : "user";
    const target = resolvePreferredEditorTarget();
    if (!target) {
      message.warning("未找到可用编辑器，请先在「打开方式」中配置");
      return;
    }
    try {
      const dir = await ensureClaudeRulesDir({
        scope,
        repositoryPath: repositoryPath ?? null,
      });
      if (target.kind === "command") {
        await openWorkspaceIn(dir, { command: target.command, args: target.args });
      } else {
        await openWorkspaceIn(dir, { appName: target.appName, args: target.args });
      }
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  }, [load, repositoryPath]);

  useEffect(() => {
    onBindActions?.({
      refresh: () => void load(),
      openMemoryRoot: () => void openMemoryRoot(),
      openRulesRoot: () => void openRulesRoot(),
    });
    return () => onBindActions?.(null);
  }, [load, onBindActions, openMemoryRoot, openRulesRoot]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  useEffect(() => {
    void hydrateOpenAppPreference();
  }, []);

  const sections = useMemo(() => {
    const files = data?.files ?? [];
    return KIND_SECTIONS.map((section) => ({
      ...section,
      items: files.filter((item) => item.kind === section.key && shouldShowMemoryItem(item, listSearch)),
    })).filter((section) => section.items.length > 0 || section.key === "rule");
  }, [data?.files, listSearch]);

  const existingCount = useMemo(
    () => (data?.files ?? []).filter((item) => item.exists).length,
    [data?.files],
  );

  useEffect(() => {
    onCountChange?.(existingCount);
  }, [existingCount, onCountChange]);

  const handleToggleAutoMemory = useCallback(
    async (enabled: boolean) => {
      if (toggleScope !== "user" && !repositoryPath?.trim()) {
        message.warning("项目/本地范围需要先选择仓库");
        return;
      }
      setToggling(true);
      try {
        await setClaudeAutoMemoryEnabled({
          scope: toggleScope,
          enabled,
          repositoryPath: repositoryPath ?? null,
        });
        await load();
        message.success(enabled ? "已启用自动记忆" : "已关闭自动记忆");
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setToggling(false);
      }
    },
    [load, repositoryPath, toggleScope],
  );

  if (loading && !data) {
    return (
      <div className="app-claude-memory-panel-loading">
        <Spin size="small" />
      </div>
    );
  }

  if (!data) {
    return <Empty description="无法加载记忆配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const autoMemoryHint = data.autoMemoryDirectory
    ? `${compactPath(data.autoMemoryPath)} · 自定义 ${compactPath(data.autoMemoryDirectory)}`
    : compactPath(data.autoMemoryPath);

  return (
    <div className="app-claude-memory-panel">
      <div className="app-claude-memory-panel-settings">
        <div className="app-claude-memory-panel-settings-main">
          <span className="app-claude-memory-panel-settings-title">自动记忆</span>
          <span className="app-claude-memory-panel-settings-meta" title={data.autoMemoryPath}>
            {autoMemoryHint}
          </span>
          <span className="app-claude-memory-panel-settings-meta">
            {formatSettingScopeLabel(data.autoMemoryEnabledSource.scope)}
          </span>
        </div>
        <Switch
          size="small"
          checked={data.autoMemoryEnabled}
          loading={toggling}
          onChange={(checked) => void handleToggleAutoMemory(checked)}
        />
      </div>

      {sections.length === 0 ? (
        <Empty description="暂无匹配的记忆文件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        sections.map((section) => (
          <section key={section.key} className="app-claude-memory-section">
            <div className="app-claude-memory-section-head">
              <span className="app-claude-memory-section-title">{section.title}</span>
              <span className="app-claude-memory-section-hint">{section.hint}</span>
            </div>
            <div className="app-claude-memory-list">
              {section.items.length === 0 ? (
                <div className="app-claude-memory-empty">暂无规则文件，可点工具栏 Rules 打开目录新建</div>
              ) : (
                section.items.map((item) => {
                const scopeMeta = SCOPE_LABELS[item.scope] ?? SCOPE_LABELS.project;
                return (
                  <div key={item.id} className="app-claude-memory-card">
                    <div className="app-claude-memory-card-main">
                      <div className="app-claude-memory-card-title-row">
                        <FileTextOutlined className="app-claude-memory-card-icon" />
                        <span className="app-claude-memory-card-title" title={item.label}>
                          {item.label}
                        </span>
                        <Tag
                          variant="filled" className="app-claude-memory-tag"
                          style={{ color: scopeMeta.color, background: scopeMeta.bg }}
                        >
                          {scopeMeta.label}
                        </Tag>
                        {!item.exists ? (
                          <Tag variant="filled" className="app-claude-memory-tag" color="default">
                            {isRuleDirAnchor(item) ? "目录" : "未创建"}
                          </Tag>
                        ) : isRuleDirAnchor(item) ? (
                          <Tag variant="filled" className="app-claude-memory-tag" color="default">
                            目录
                          </Tag>
                        ) : null}
                        {item.loadedAtStartup ? (
                          <Tag variant="filled" className="app-claude-memory-tag" color="processing">
                            启动
                          </Tag>
                        ) : null}
                        {item.exists ? (
                          <span className="app-claude-memory-card-stat">
                            {item.lineCount}行
                          </span>
                        ) : null}
                      </div>
                      <div className="app-claude-memory-card-path" title={item.sourcePath}>
                        {compactPath(item.sourcePath)}
                        {item.pathPatterns.length > 0
                          ? ` · ${item.pathPatterns.slice(0, 2).join("、")}${item.pathPatterns.length > 2 ? "…" : ""}`
                          : null}
                      </div>
                    </div>
                    <Button
                      type="text"
                      size="small"
                      className="app-claude-memory-open-btn"
                      icon={<FolderOpenOutlined />}
                      aria-label="打开"
                      title="打开"
                      onClick={() => void openInPreferredEditor(item.sourcePath)}
                    />
                  </div>
                );
              })
              )}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
