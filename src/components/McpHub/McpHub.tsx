import {
  ApiOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Badge, Button, Empty, Input, Spin, Switch, Tabs, Tag, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClaudeMcpList } from "../../hooks/useClaudeMcpList";
import { computerUseMcpLikelyRegistered, getCuaDriverStatus, type CuaDriverStatus } from "../../services/cuaDriver";
import { getExtensionMcpServers } from "../../services/extensions";
import type { ResolvedMcpServer } from "../../types/extension";
import { ClaudeMcpAddServerModal } from "../ClaudeMcp/ClaudeMcpAddServerModal";
import { flattenMcpItemsForHub } from "../ClaudeMcp/claudeMcpListModel";
import { AuthorPanelPageShell } from "../AuthorPanel/AuthorPanelPageShell";
import { ComputerUseMcpSection } from "../ComputerUseMcpSection";
import { RECOMMENDED_MCP_SERVERS, type RecommendedMcp } from "./recommendedMcps";
import { McpOneClickInstallModal } from "./McpOneClickInstallModal";
import "../ClaudeMcpLayout.css";
import "../HubCard/index.css";
import "./McpHub.css";

interface Props {
  repositoryPath?: string | null;
  /** 关闭 MCP 页（例如返回主对话区）。 */
  onClose?: () => void;
}

export function McpHub({ repositoryPath, onClose }: Props) {
  const embeddedInAuthor = !onClose;
  const [hubSearch, setHubSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [selectedMcpForInstall, setSelectedMcpForInstall] = useState<RecommendedMcp | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [cuaDriverStatus, setCuaDriverStatus] = useState<CuaDriverStatus | null>(null);
  const [activeTab, setActiveTab] = useState<string>("installed");
  const [extServers, setExtServers] = useState<ResolvedMcpServer[]>([]);
  const [extLoading, setExtLoading] = useState(false);

  const refreshExtServers = useCallback(async () => {
    setExtLoading(true);
    try {
      const next = await getExtensionMcpServers();
      setExtServers(next);
    } catch {
      // silent — extension subsystem may be uninitialized; not fatal
    } finally {
      setExtLoading(false);
    }
  }, []);

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
    await refreshExtServers();
  }, [refreshMcp, refreshExtServers]);

  useEffect(() => {
    void getCuaDriverStatus().then(setCuaDriverStatus);
    void refreshExtServers();
  }, [refreshExtServers]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const installedNames = useMemo(() => {
    const names = new Set<string>();
    const sections: (keyof typeof mcpData)[] = [
      "user",
      "local",
      "projectShared",
      "legacyUserSettings",
      "legacyProjectSettings",
      "pluginMcp",
    ];
    for (const key of sections) {
      if (mcpData[key]) {
        for (const item of mcpData[key]) {
          names.add(item.name.toLowerCase());
        }
      }
    }
    return names;
  }, [mcpData]);

  const filteredRecommendations = useMemo(() => {
    const needle = hubSearch.trim().toLowerCase();
    return RECOMMENDED_MCP_SERVERS.filter((mcp) => {
      if (!needle) return true;
      return (
        mcp.name.toLowerCase().includes(needle) ||
        mcp.category.toLowerCase().includes(needle) ||
        mcp.description.toLowerCase().includes(needle) ||
        mcp.tools.some((t) => t.toLowerCase().includes(needle))
      );
    });
  }, [hubSearch]);

  const showComputerUseInPending = useMemo(() => {
    if (!cuaDriverStatus) return false;
    if (!cuaDriverStatus.platformMacos) return true;
    if (!cuaDriverStatus.installed) return true;
    return !computerUseMcpLikelyRegistered(mcpData);
  }, [cuaDriverStatus, mcpData]);

  const uninstalledCount = useMemo(() => {
    let count = 0;
    for (const mcp of RECOMMENDED_MCP_SERVERS) {
      if (!installedNames.has(mcp.name.toLowerCase())) {
        count++;
      }
    }
    return count;
  }, [installedNames]);

  const pendingInstallCount = useMemo(() => {
    let count = uninstalledCount;
    if (cuaDriverStatus?.platformMacos && !computerUseMcpLikelyRegistered(mcpData)) {
      count++;
    }
    return count;
  }, [cuaDriverStatus, mcpData, uninstalledCount]);

  if (mcpError) {
    return (
      <div className="app-mcp-hub-root">
        <header className="app-mcp-hub-header">
          <div className="app-mcp-hub-header-top">
            <Typography.Title level={5} className="app-mcp-hub-title">
              MCP 工具市场
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

  const extensionTabLabel =
    extServers.length > 0 ? (
      <span>
        来自扩展 <Badge count={extServers.length} size="small" style={{ marginLeft: 4 }} />
      </span>
    ) : (
      "来自扩展"
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
          const isConnected = item.runtimeStatus === "connected";
          const isFailed = item.runtimeStatus === "failed";
          const cardClass = `app-mcp-hub-card ${
            isConnected ? "app-mcp-hub-card--connected" : isFailed ? "app-mcp-hub-card--failed" : ""
          } ${readOnly ? "app-mcp-hub-card--readonly" : ""}`;
          return (
            <article key={item.id} className={cardClass}>
              <div className="app-mcp-hub-card-top">
                <span className="app-mcp-hub-card-avatar" aria-hidden>
                  {item.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="app-mcp-hub-card-headline">
                  <div className="app-mcp-hub-card-name-row">
                    <span className="app-mcp-hub-card-name" title={item.name}>
                      {item.name}
                    </span>
                    {item.runtimeStatus === "connected" ? (
                      <Tag variant="filled" color="success" className="app-mcp-hub-card-tag">
                        已连通
                      </Tag>
                    ) : item.runtimeStatus === "failed" ? (
                      <Tag variant="filled" color="error" className="app-mcp-hub-card-tag">
                        失败
                      </Tag>
                    ) : null}
                  </div>
                  {item.pluginRef ? (
                    <div className="app-mcp-hub-card-ref" title={item.pluginRef}>
                      {item.pluginRef}
                    </div>
                  ) : (
                    <div className="app-mcp-hub-card-scope" title={sectionTitle}>
                      {sectionTitle}
                    </div>
                  )}
                  {item.pluginRef ? (
                    <div className="app-mcp-hub-card-scope" title={sectionTitle}>
                      {sectionTitle}
                    </div>
                  ) : null}
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
        <div className="app-mcp-hub-pending-section">
          <div className="app-mcp-hub-pending-subtitle">
            系统辅助驱动
          </div>
          <div className="app-mcp-hub-pending-grid">
            <ComputerUseMcpSection repositoryPath={repositoryPath} active onRefreshMcpList={() => void refreshAll()} />
          </div>
        </div>
      ) : null}

      <div className="app-mcp-hub-pending-section">
        <div className="app-mcp-hub-pending-subtitle-row">
          <span className="app-mcp-hub-pending-subtitle">常用工具一键安装</span>
          {hubSearch && (
            <span className="app-mcp-hub-pending-subtitle-side">
              已筛选出 {filteredRecommendations.length} 项
            </span>
          )}
        </div>

        {filteredRecommendations.length === 0 ? (
          <Empty
            className="app-mcp-hub-empty"
            description="没有符合搜索条件的推荐 MCP"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <div className="app-mcp-hub-grid">
            {filteredRecommendations.map((mcp) => {
              const isInstalled = installedNames.has(mcp.name.toLowerCase());
              let categoryColor = "default";
              if (mcp.category === "开发与数据") categoryColor = "success";
              else if (mcp.category === "搜索与信息") categoryColor = "processing";
              else if (mcp.category === "办公与写作") categoryColor = "warning";
              else if (mcp.category === "智能辅助") categoryColor = "purple";

              const commandPreview = `${mcp.command} ${mcp.args.join(" ")}`;
              const cardClass = `app-mcp-hub-card app-mcp-hub-card--recommend ${
                isInstalled ? "app-mcp-hub-card--installed" : ""
              }`;

              return (
                <article key={mcp.name} className={cardClass}>
                  <div className="app-mcp-hub-card-top">
                    <span className="app-mcp-hub-card-avatar" aria-hidden>
                      {mcp.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="app-mcp-hub-card-headline">
                      <div className="app-mcp-hub-card-name-row">
                        <span className="app-mcp-hub-card-name">{mcp.name}</span>
                        <Tag className="app-mcp-hub-card-tag" color={categoryColor}>
                          {mcp.category}
                        </Tag>
                      </div>
                      <div className="app-mcp-hub-card-scope">推荐 Stdio MCP</div>
                    </div>
                  </div>
                  <div className="app-mcp-hub-card-command" title={commandPreview}>
                    {commandPreview}
                  </div>
                  <div className="app-mcp-hub-card-desc" title={mcp.description}>
                    {mcp.description}
                  </div>
                  {mcp.tools.length > 0 ? (
                    <div className="app-mcp-hub-card-tools" style={{ marginTop: "4px" }}>
                      {mcp.tools.map((tool) => (
                        <span key={tool} className="app-mcp-hub-tool-chip">
                          {tool}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="app-mcp-hub-card-actions" style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
                    {isInstalled ? (
                      <Tag icon={<CheckOutlined />} color="success" style={{ marginInlineEnd: 0 }}>
                        已连通就绪
                      </Tag>
                    ) : (
                      <Button
                        type="primary"
                        size="small"
                        className="app-mcp-hub-btn-install"
                        onClick={() => {
                          setSelectedMcpForInstall(mcp);
                          setInstallOpen(true);
                        }}
                      >
                        安装
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const extensionPanel = extLoading && extServers.length === 0 ? (
    <div className="app-mcp-hub-loading">
      <Spin size="small" />
    </div>
  ) : extServers.length === 0 ? (
    <Empty
      className="app-mcp-hub-empty"
      description="暂无扩展贡献的 MCP 服务器。安装一个声明 contributes.mcpServers 的扩展即可在此显示。"
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  ) : (
    <div className="app-mcp-hub-grid">
      {extServers.map((s) => {
        const command = s.transport.type === "stdio"
          ? [s.transport.command ?? "", ...(s.transport.args ?? [])].filter(Boolean).join(" ")
          : s.transport.url ?? "";
        const cardClass = "app-mcp-hub-card app-mcp-hub-card--extension";
        return (
          <article key={s.id} className={cardClass}>
            <div className="app-mcp-hub-card-top">
              <span className="app-mcp-hub-card-avatar" aria-hidden>
                {s.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="app-mcp-hub-card-headline">
                <div className="app-mcp-hub-card-name-row">
                  <span className="app-mcp-hub-card-name" title={s.name}>
                    {s.name}
                  </span>
                  <Tag color="purple" className="app-mcp-hub-card-tag">
                    {s.transport.type}
                  </Tag>
                </div>
                <div className="app-mcp-hub-card-ref" title={`来自扩展 ${s.extension}`}>
                  来自扩展 {s.extension} · 只读
                </div>
              </div>
            </div>
            <div className="app-mcp-hub-card-command" title={command}>
              {command || "—"}
            </div>
            {s.description ? (
              <div className="app-mcp-hub-card-desc" title={s.description}>
                {s.description}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );

  const headerActions = (
    <>
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
    </>
  );

  const hubBody = (
    <>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="small"
        className="app-mcp-hub-tabs"
        items={[
          { key: "installed", label: installedTabLabel, children: installedPanel },
          { key: "pending", label: pendingTabLabel, children: pendingPanel },
          { key: "extension", label: extensionTabLabel, children: extensionPanel },
        ]}
      />

      <ClaudeMcpAddServerModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        repositoryPath={repositoryPath}
        onAdded={() => void refreshAll()}
      />

      <McpOneClickInstallModal
        open={installOpen}
        onClose={() => {
          setInstallOpen(false);
          setSelectedMcpForInstall(null);
        }}
        mcp={selectedMcpForInstall}
        repositoryPath={repositoryPath}
        onInstalled={() => void refreshAll()}
      />
    </>
  );

  if (embeddedInAuthor) {
    return (
      <AuthorPanelPageShell
        className="app-mcp-hub-root"
        icon={<ApiOutlined />}
        title="MCP 工具"
        subtitle="服务器、推荐项和扩展工具协议"
        actions={headerActions}
      >
        {hubBody}
      </AuthorPanelPageShell>
    );
  }

  return (
    <div className="app-mcp-hub-root">
      <header className="app-mcp-hub-header">
        <div className="app-mcp-hub-header-top">
          <Typography.Title level={5} className="app-mcp-hub-title">
            MCP 工具市场
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
        <div className="app-mcp-hub-toolbar">{headerActions}</div>
      </header>
      {hubBody}
    </div>
  );
}
