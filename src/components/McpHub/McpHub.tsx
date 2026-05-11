import { CloseOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Badge, Button, Empty, Input, Spin, Switch, Tabs, Tag, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClaudeMcpList } from "../../hooks/useClaudeMcpList";
import { computerUseMcpLikelyRegistered, getCuaDriverStatus, type CuaDriverStatus } from "../../services/cuaDriver";
import { ClaudeMcpAddServerModal } from "../ClaudeMcp/ClaudeMcpAddServerModal";
import { flattenMcpItemsForHub } from "../ClaudeMcp/claudeMcpListModel";
import { ComputerUseMcpSection } from "../ComputerUseMcpSection";
import "../ClaudeMcpLayout.css";
import "./McpHub.css";

interface Props {
  repositoryPath?: string | null;
  /** 关闭 MCP 页（例如返回主对话区）。 */
  onClose?: () => void;
}

export function McpHub({ repositoryPath, onClose }: Props) {
  const [hubSearch, setHubSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [cuaDriverStatus, setCuaDriverStatus] = useState<CuaDriverStatus | null>(null);
  const [activeTab, setActiveTab] = useState<string>("installed");

  const {
    mcpData,
    mcpLoading,
    mcpRefreshing,
    mcpError,
    mcpHasData,
    mcpCount,
    filteredMcpData,
    mcpHasFilteredData,
    refreshMcp,
    handleDelete,
    handleToggleEnabled,
  } = useClaudeMcpList({
    repositoryPath,
    active: true,
    listSearch: hubSearch,
  });

  const flatRows = useMemo(() => flattenMcpItemsForHub(filteredMcpData), [filteredMcpData]);

  const refreshAll = useCallback(async () => {
    await refreshMcp();
    setCuaDriverStatus(await getCuaDriverStatus());
  }, [refreshMcp]);

  useEffect(() => {
    void getCuaDriverStatus().then(setCuaDriverStatus);
  }, []);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const showComputerUseInPending = useMemo(() => {
    if (!cuaDriverStatus) return false;
    if (!cuaDriverStatus.platformMacos) return true;
    if (!cuaDriverStatus.installed) return true;
    return !computerUseMcpLikelyRegistered(mcpData);
  }, [cuaDriverStatus, mcpData]);

  const pendingInstallCount = useMemo(() => {
    if (!cuaDriverStatus?.platformMacos) return 0;
    if (!cuaDriverStatus.installed) return 1;
    return computerUseMcpLikelyRegistered(mcpData) ? 0 : 1;
  }, [cuaDriverStatus, mcpData]);

  if (mcpError) {
    return (
      <div className="app-mcp-hub-root">
        <header className="app-mcp-hub-header">
          <div className="app-mcp-hub-header-top">
            <Typography.Title level={5} className="app-mcp-hub-title">
              MCP
            </Typography.Title>
            {onClose ? (
              <Tooltip title="关闭" mouseEnterDelay={0.35}>
                <Button
                  type="text"
                  size="small"
                  className="app-mcp-hub-close-btn"
                  icon={<CloseOutlined />}
                  aria-label="关闭"
                  onClick={onClose}
                />
              </Tooltip>
            ) : null}
          </div>
        </header>
        <div className="app-claude-mcp-panel-error app-mcp-hub-error-body">{mcpError}</div>
      </div>
    );
  }

  const installedTabLabel =
    mcpCount > 0 ? (
      <span>
        已安装 <Badge count={mcpCount} size="small" style={{ marginLeft: 4 }} />
      </span>
    ) : (
      "已安装"
    );

  const pendingTabLabel =
    pendingInstallCount > 0 ? (
      <span>
        未安装 <Badge count={pendingInstallCount} size="small" style={{ marginLeft: 4 }} />
      </span>
    ) : (
      "未安装"
    );

  const installedPanel =
    mcpLoading && !mcpHasData ? (
      <div className="app-mcp-hub-loading">
        <Spin size="small" />
      </div>
    ) : !mcpHasData ? (
      <Empty
        className="app-mcp-hub-empty"
        description="暂无已配置的 MCP，可在本页「添加」或到「未安装」完成推荐项"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    ) : !mcpHasFilteredData ? (
      <Empty className="app-mcp-hub-empty" description="没有符合搜索条件的 MCP" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    ) : (
      <div className="app-mcp-hub-grid">
        {flatRows.map(({ item, sectionTitle, sectionKey }) => {
          const readOnly = sectionKey === "pluginMcp";
          return (
            <article key={item.id} className="app-mcp-hub-card">
              <div className="app-mcp-hub-card-top">
                <span className="app-mcp-hub-card-avatar" aria-hidden>
                  {item.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="app-mcp-hub-card-headline">
                  <div className="app-mcp-hub-card-name-row">
                    <span className="app-mcp-hub-card-name">{item.name}</span>
                    {item.pluginRef ? (
                      <Tag bordered={false} className="app-mcp-hub-card-tag">
                        {item.pluginRef}
                      </Tag>
                    ) : null}
                    {item.runtimeStatus === "connected" ? (
                      <Tag bordered={false} color="success" className="app-mcp-hub-card-tag">
                        已连通
                      </Tag>
                    ) : item.runtimeStatus === "failed" ? (
                      <Tag bordered={false} color="error" className="app-mcp-hub-card-tag">
                        失败
                      </Tag>
                    ) : null}
                  </div>
                  <div className="app-mcp-hub-card-scope">{sectionTitle}</div>
                </div>
              </div>
              <div className="app-mcp-hub-card-command" title={item.command}>
                {item.command}
              </div>
              {item.tools.length > 0 ? (
                <div className="app-mcp-hub-card-tools">
                  {item.tools.slice(0, 6).map((tool) => (
                    <span key={tool} className="app-mcp-hub-tool-chip">
                      {tool}
                    </span>
                  ))}
                  {item.tools.length > 6 ? <span className="app-mcp-hub-tool-more">+{item.tools.length - 6}</span> : null}
                </div>
              ) : null}
              <div className="app-mcp-hub-card-actions">
                <span className="app-mcp-hub-card-switch-label">{item.enabled ? "已启用" : "已禁用"}</span>
                <Switch
                  size="small"
                  checked={item.enabled}
                  disabled={readOnly}
                  title={readOnly ? "插件内置 MCP 请在 Claude Code 中管理" : undefined}
                  onChange={(next) => void handleToggleEnabled(item, next)}
                />
                {!readOnly ? (
                  <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label="卸载" onClick={() => handleDelete(item)} />
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    );

  const pendingPanel = (
    <div className="app-mcp-hub-pending-pane">
      {!cuaDriverStatus ? (
        <div className="app-mcp-hub-tab-load">
          <Spin size="small" />
          正在检查推荐项…
        </div>
      ) : null}
      {showComputerUseInPending ? (
        <div className="app-mcp-hub-pending-grid">
          <ComputerUseMcpSection repositoryPath={repositoryPath} active onRefreshMcpList={() => void refreshAll()} />
        </div>
      ) : cuaDriverStatus ? (
        <Empty className="app-mcp-hub-empty" description="暂无待安装的推荐项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : null}
    </div>
  );

  return (
    <div className="app-mcp-hub-root">
      <header className="app-mcp-hub-header">
        <div className="app-mcp-hub-header-top">
          <Typography.Title level={5} className="app-mcp-hub-title">
            MCP
          </Typography.Title>
          {onClose ? (
            <Tooltip title="关闭" mouseEnterDelay={0.35}>
              <Button
                type="text"
                size="small"
                className="app-mcp-hub-close-btn"
                icon={<CloseOutlined />}
                aria-label="关闭"
                onClick={onClose}
              />
            </Tooltip>
          ) : null}
        </div>
        <Typography.Paragraph type="secondary" className="app-mcp-hub-subtitle">
          「已安装」为 Claude Code 已配置的 MCP；「未安装」为可一键补齐的推荐项（如 cua-driver）。
        </Typography.Paragraph>
        <div className="app-mcp-hub-toolbar">
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined />}
            placeholder="搜索已安装…"
            value={hubSearch}
            onChange={(e) => setHubSearch(e.target.value)}
            className="app-mcp-hub-search"
          />
          <Button size="small" icon={<ReloadOutlined />} loading={mcpRefreshing} onClick={() => void refreshAll()}>
            刷新
          </Button>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            添加
          </Button>
        </div>
      </header>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="small"
        className="app-mcp-hub-tabs"
        items={[
          { key: "installed", label: installedTabLabel, children: installedPanel },
          { key: "pending", label: pendingTabLabel, children: pendingPanel },
        ]}
      />

      <ClaudeMcpAddServerModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        repositoryPath={repositoryPath}
        onAdded={() => void refreshAll()}
      />
    </div>
  );
}
