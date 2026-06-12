import { DeleteOutlined, FileOutlined, FolderOpenOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { App, Button, Empty, Space, Spin, Switch } from "antd";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { ClaudeMcpItem, ClaudeMcpStatusResponse } from "../types";
import { useClaudeMcpList } from "../hooks/useClaudeMcpList";
import { openWorkspaceIn } from "../services/repository";
import { DEFAULT_OPEN_APP_ID, DEFAULT_OPEN_APP_TARGETS } from "./OpenAppMenu/constants";
import { getOpenAppPreferenceSync, hydrateOpenAppPreference } from "../services/openAppPreference";
import { ClaudeMcpAddServerModal } from "./ClaudeMcp/ClaudeMcpAddServerModal";
import "./ClaudeMcpLayout.css";

const SCOPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  user: { label: "用户全局", color: "#8b5cf6", bg: "rgba(139, 92, 246, 0.08)" },
  local: { label: "本地仓库", color: "#f97316", bg: "rgba(249, 115, 22, 0.08)" },
  pluginMcp: { label: "内置插件", color: "#10b981", bg: "rgba(16, 185, 129, 0.08)" },
  projectShared: { label: "团队共享", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.08)" },
  legacyUserSettings: { label: "兼容全局", color: "#64748b", bg: "rgba(100, 116, 139, 0.08)" },
  legacyProjectSettings: { label: "兼容仓库", color: "#64748b", bg: "rgba(100, 116, 139, 0.08)" },
};

function resolvePreferredEditorTarget() {
  const selectedId = getOpenAppPreferenceSync() || DEFAULT_OPEN_APP_ID;
  const selected = DEFAULT_OPEN_APP_TARGETS.find((t) => t.id === selectedId);
  if (selected && selected.kind !== "finder") return selected;
  return DEFAULT_OPEN_APP_TARGETS.find((t) => t.kind !== "finder") ?? null;
}

export type ClaudeMcpConfigPanelHandle = {
  openAddModal: () => void;
  refreshMcp: () => Promise<void>;
};

interface Props {
  repositoryPath?: string;
  active?: boolean;
  omcInstalled?: boolean;
  hideToolbar?: boolean;
  listSearch?: string;
  onCountChange?: (count: number) => void;
}

export const ClaudeMcpConfigPanel = forwardRef<ClaudeMcpConfigPanelHandle, Props>(function ClaudeMcpConfigPanel(
  { repositoryPath, active = true, omcInstalled = false, hideToolbar = false, listSearch = "", onCountChange },
  ref,
) {
  const { message } = App.useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const {
    mcpLoading,
    mcpRefreshing,
    mcpError,
    mcpHasData,
    filteredMcpData,
    mcpHasFilteredData,
    mcpSectionsToRender,
    refreshMcp,
    reload,
    handleDelete,
    handleToggleEnabled,
  } = useClaudeMcpList({
    repositoryPath,
    active,
    omcInstalled,
    listSearch,
    onCountChange,
  });

  const openAddModal = useCallback(() => {
    setAddOpen(true);
  }, []);

  useImperativeHandle(ref, () => ({ openAddModal, refreshMcp }), [openAddModal, refreshMcp]);

  useEffect(() => {
    void hydrateOpenAppPreference();
  }, []);

  const openMcpConfigFile = useCallback(
    async (item: ClaudeMcpItem) => {
      const sourcePath = item.sourcePath.trim();
      if (!sourcePath) {
        message.warning("未记录 MCP 配置文件路径");
        return;
      }
      const target = resolvePreferredEditorTarget();
      if (!target) {
        message.warning("未找到可用编辑器，请先在「打开方式」中配置");
        return;
      }
      const repo = repositoryPath?.trim();
      const sourceNormalized = sourcePath.replace(/\\/g, "/");
      const repoNormalized = repo?.replace(/\\/g, "/").replace(/\/+$/, "");
      const relative = repoNormalized && sourceNormalized.startsWith(`${repoNormalized}/`)
        ? sourceNormalized.slice(repoNormalized.length + 1)
        : null;
      try {
        if (relative && repo) {
          if (target.kind === "command") {
            await openWorkspaceIn(repo, {
              command: target.command,
              args: target.args,
              ideGotoRelative: relative,
              gotoLine: 1,
              gotoColumn: 1,
            });
          } else {
            await openWorkspaceIn(repo, {
              appName: target.appName,
              args: target.args,
              ideGotoRelative: relative,
              gotoLine: 1,
              gotoColumn: 1,
            });
          }
          return;
        }
        if (target.kind === "command") {
          await openWorkspaceIn(sourcePath, { command: target.command, args: target.args, gotoLine: 1, gotoColumn: 1 });
        } else {
          await openWorkspaceIn(sourcePath, { appName: target.appName, args: target.args, gotoLine: 1, gotoColumn: 1 });
        }
      } catch (e) {
        message.warning(e instanceof Error ? e.message : "无法在编辑器中打开该配置文件");
      }
    },
    [message, repositoryPath],
  );

  const allItems = useMemo(() => {
    const list: Array<
      ClaudeMcpItem & {
        sectionKey: keyof ClaudeMcpStatusResponse;
        sectionTitle: string;
        sectionHint: string;
      }
    > = [];
    mcpSectionsToRender.forEach(({ key, title, hint }) => {
      const items = filteredMcpData[key] || [];
      items.forEach((item) => {
        list.push({
          ...item,
          sectionKey: key,
          sectionTitle: title,
          sectionHint: hint,
        });
      });
    });
    return list;
  }, [filteredMcpData, mcpSectionsToRender]);

  if (mcpError) {
    return <div className="app-claude-mcp-panel-error">{mcpError}</div>;
  }

  return (
    <div className="app-mcp-panel-root">
      {!hideToolbar && (
        <div className="app-mcp-panel-toolbar">
          <Space size={4}>
            <Button
              type="text"
              size="small"
              className="app-tab-extra-mcp-btn"
              icon={<ReloadOutlined />}
              loading={mcpRefreshing}
              onClick={() => void refreshMcp()}
            >
              刷新
            </Button>
            <Button type="text" size="small" className="app-tab-extra-mcp-btn" icon={<PlusOutlined />} onClick={openAddModal}>
              添加 MCP
            </Button>
          </Space>
        </div>
      )}
      {mcpLoading && !mcpHasData ? (
        <div className="app-claude-mcp-panel-loading">
          <Spin size="small" />
        </div>
      ) : !mcpHasData ? (
        <Empty
          description="未发现 MCP 配置（可「添加 MCP」、点「刷新」同步本机；完整管理见左栏 MCP）"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : !mcpHasFilteredData ? (
        <Empty description="没有符合筛选的 MCP" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="app-mcp-unified-container">
          <div className="app-mcp-unified-list">
            {allItems.map((item) => {
              const readOnly = item.sectionKey === "pluginMcp";
              const isConnected = item.runtimeStatus === "connected";
              const isFailed = item.runtimeStatus === "failed";
              const scopeInfo = SCOPE_LABELS[item.sectionKey] || {
                label: "未知范围",
                color: "#64748b",
                bg: "rgba(100, 116, 139, 0.08)",
              };

              return (
                <article
                  key={item.id}
                  className={`app-mcp-card-premium ${
                    item.enabled ? "app-mcp-card-premium--enabled" : "app-mcp-card-premium--disabled"
                  } ${isConnected ? "app-mcp-card-premium--connected" : ""} ${
                    isFailed ? "app-mcp-card-premium--failed" : ""
                  }`}
                >
                  <div className="app-mcp-card-header">
                    <div className="app-mcp-card-avatar-wrap">
                      <span
                        className={`app-mcp-card-avatar ${
                          item.enabled ? "app-mcp-card-avatar--gradient" : "app-mcp-card-avatar--disabled"
                        }`}
                        aria-hidden
                      >
                        {item.name.slice(0, 1).toUpperCase()}
                      </span>
                    </div>

                    <div className="app-mcp-card-title-row">
                      <div className="app-mcp-card-title-line">
                        <span className="app-mcp-card-name" title={item.name}>
                          {item.name}
                        </span>

                        <span
                          className="app-mcp-scope-badge"
                          style={{
                            color: scopeInfo.color,
                            backgroundColor: scopeInfo.bg,
                            borderColor: `${scopeInfo.color}2b`,
                          }}
                        >
                          {scopeInfo.label}
                        </span>
                      </div>

                      <div className="app-mcp-card-status-line">
                        {item.runtimeStatus === "connected" ? (
                          <span className="app-mcp-status-pill app-mcp-status-pill--connected" title="来自本机 claude mcp list 健康检查">
                            <span className="app-mcp-status-dot app-mcp-status-dot--pulse-success" />
                            已连通
                          </span>
                        ) : item.runtimeStatus === "failed" ? (
                          <span className="app-mcp-status-pill app-mcp-status-pill--failed" title="来自本机 claude mcp list；可用 claude --debug 查看日志">
                            <span className="app-mcp-status-dot app-mcp-status-dot--pulse-error" />
                            连接失败
                          </span>
                        ) : item.enabled ? (
                          <span className="app-mcp-status-pill app-mcp-status-pill--pending">
                            <span className="app-mcp-status-dot app-mcp-status-dot--pulse-pending" />
                            已就绪
                          </span>
                        ) : (
                          <span className="app-mcp-status-pill app-mcp-status-pill--disabled">
                            <span className="app-mcp-status-dot" />
                            已禁用
                          </span>
                        )}

                        {item.pluginRef && (
                          <span className="app-mcp-card-ref-badge" title={item.pluginRef}>
                            {item.pluginRef}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="app-mcp-card-actions">
                      <Button
                        type="text"
                        size="small"
                        icon={<FileOutlined />}
                        className="app-mcp-card-action-btn"
                        title="打开配置文件"
                        aria-label="打开配置文件"
                        onClick={() => void openMcpConfigFile(item)}
                      />
                      {!readOnly && (
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          className="app-mcp-card-action-btn app-mcp-card-action-btn--delete"
                          title="删除"
                          aria-label="删除"
                          onClick={() => handleDelete(item)}
                        />
                      )}
                      <Switch
                        size="small"
                        checked={item.enabled}
                        disabled={readOnly}
                        title={readOnly ? "插件内置 MCP 请在 Claude Code 中管理" : undefined}
                        onChange={(next) => void handleToggleEnabled(item, next)}
                      />
                    </div>
                  </div>

                  <div className="app-mcp-card-body">
                    <div className="app-mcp-card-command-box">
                      <code className="app-mcp-card-command-text" title={item.command}>
                        {item.command}
                      </code>
                    </div>

                    {item.tools.length > 0 && (
                      <div className="app-mcp-card-tools">
                        {item.tools.slice(0, 5).map((tool) => (
                          <span key={tool} className="app-mcp-card-tool-tag" title={tool}>
                            {tool}
                          </span>
                        ))}
                        {item.tools.length > 5 && (
                          <span className="app-mcp-card-tool-tag app-mcp-card-tool-tag--more" title={item.tools.slice(5).join(", ")}>
                            +{item.tools.length - 5}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="app-mcp-card-footer">
                    <span className="app-mcp-card-path-label">配置文件: </span>
                    <span className="app-mcp-card-path-text" title={item.sourcePath}>
                      {item.sourcePath}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="app-mcp-sources-panel">
            <button
              type="button"
              className={`app-mcp-sources-toggle ${sourcesExpanded ? "app-mcp-sources-toggle--expanded" : ""}`}
              onClick={() => setSourcesExpanded(!sourcesExpanded)}
            >
              <FolderOpenOutlined className="app-mcp-sources-toggle-icon" />
              <span className="app-mcp-sources-toggle-text">管理与配置文件源 ({mcpSectionsToRender.length})</span>
              <span className="app-mcp-sources-toggle-arrow">{sourcesExpanded ? "▲" : "▼"}</span>
            </button>
            {sourcesExpanded && (
              <div className="app-mcp-sources-list">
                {mcpSectionsToRender.map(({ key, title, hint }) => {
                  const count = filteredMcpData[key]?.length || 0;
                  return (
                    <div key={key} className="app-mcp-source-row">
                      <div className="app-mcp-source-info">
                        <span className="app-mcp-source-name">{title}</span>
                        <span className="app-mcp-source-count-badge">{count} 个服务</span>
                      </div>
                      <div className="app-mcp-source-path" title={hint}>
                        {hint}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <ClaudeMcpAddServerModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        repositoryPath={repositoryPath}
        onAdded={() => void reload()}
      />
    </div>
  );
});
