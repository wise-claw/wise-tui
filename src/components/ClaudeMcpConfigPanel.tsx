import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Empty, Space, Spin, Switch, Tag } from "antd";
import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import type { ClaudeMcpItem } from "../types";
import { useClaudeMcpList } from "../hooks/useClaudeMcpList";
import { ClaudeMcpAddServerModal } from "./ClaudeMcp/ClaudeMcpAddServerModal";
import "./ClaudeMcpLayout.css";

interface McpSectionProps {
  title: string;
  hint: string;
  items: ClaudeMcpItem[];
  readOnly?: boolean;
  onDelete: (item: ClaudeMcpItem) => void;
  onToggleEnabled: (item: ClaudeMcpItem, enabled: boolean) => void;
}

function McpSection({ title, hint, items, readOnly = false, onDelete, onToggleEnabled }: McpSectionProps) {
  return (
    <section className="app-mcp-section">
      <div className="app-mcp-section-head">
        <div className="app-mcp-section-title">{title}</div>
        <div className="app-mcp-section-hint">{hint}</div>
      </div>
      {items.length === 0 ? (
        <div className="app-mcp-empty">无 MCP 配置</div>
      ) : (
        <div className="app-mcp-list">
          {items.map((item) => (
            <article key={item.id} className="app-mcp-item">
              <div className="app-mcp-item-head">
                <div className="app-mcp-item-left">
                  <span className="app-mcp-avatar" aria-hidden>
                    {item.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="app-mcp-item-meta">
                    <div className="app-mcp-item-name-row">
                      <span className="app-mcp-item-name-text">{item.name}</span>
                      {item.pluginRef ? (
                        <Tag variant="filled" className="app-mcp-runtime-tag" title="Claude Code 插件标识">
                          {item.pluginRef}
                        </Tag>
                      ) : null}
                      {item.runtimeStatus === "connected" ? (
                        <Tag
                          variant="filled"
                          color="success"
                          className="app-mcp-runtime-tag"
                          title="来自本机 claude mcp list 健康检查"
                        >
                          已连通
                        </Tag>
                      ) : item.runtimeStatus === "failed" ? (
                        <Tag
                          variant="filled"
                          color="error"
                          className="app-mcp-runtime-tag"
                          title="来自本机 claude mcp list；可用 claude --debug 查看日志"
                        >
                          失败
                        </Tag>
                      ) : null}
                    </div>
                    <div className="app-mcp-item-command">{item.command}</div>
                    <div className="app-mcp-item-source" title={item.sourcePath}>
                      {item.sourcePath}
                    </div>
                  </div>
                </div>
                <div className="app-mcp-item-actions">
                  {!readOnly ? (
                    <button
                      type="button"
                      className="app-mcp-icon-btn"
                      title="删除"
                      aria-label="删除"
                      onClick={() => onDelete(item)}
                    >
                      <DeleteOutlined />
                    </button>
                  ) : null}
                  <Switch
                    size="small"
                    checked={item.enabled}
                    disabled={readOnly}
                    title={readOnly ? "插件内置 MCP 请在 Claude Code 中管理" : undefined}
                    onChange={(next) => onToggleEnabled(item, next)}
                  />
                </div>
              </div>
              {item.tools.length > 0 && (
                <div className="app-mcp-tools">
                  {item.tools.map((tool) => (
                    <span key={tool} className="app-mcp-tool-tag">
                      {tool}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
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
  const [addOpen, setAddOpen] = useState(false);

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
        <div className="app-mcp-groups">
          {mcpSectionsToRender.map(({ key, title, hint }) => (
            <McpSection
              key={key}
              title={title}
              hint={hint}
              items={filteredMcpData[key]}
              readOnly={key === "pluginMcp"}
              onDelete={handleDelete}
              onToggleEnabled={handleToggleEnabled}
            />
          ))}
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
