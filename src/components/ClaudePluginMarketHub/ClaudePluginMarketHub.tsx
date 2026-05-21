import { CloseOutlined, BlockOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { App, Badge, Button, Empty, Input, Segmented, Spin, Tabs, Tag, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CLAUDE_PLUGIN_CATEGORY_LABELS,
  CLAUDE_PLUGIN_MARKET_CATALOG,
  claudePluginInstallRef,
  sortClaudePluginCatalogEntries,
  type ClaudePluginCatalogEntry,
  type ClaudePluginMarketCategory,
} from "../../constants/claudePluginMarketCatalog";
import {
  claudePluginInstall,
  claudePluginListInstalled,
  claudePluginMarketBootstrap,
  claudePluginUninstall,
  type ClaudePluginInstalledEntry,
} from "../../services/claudePluginMarket";
import { AuthorPanelPageShell } from "../AuthorPanel/AuthorPanelPageShell";
import "./ClaudePluginMarketHub.css";

interface Props {
  onClose?: () => void;
}

type HubTab = "catalog" | "installed";
type CategoryFilter = ClaudePluginMarketCategory | "all";

export function ClaudePluginMarketHub({ onClose }: Props) {
  const embeddedInAuthor = !onClose;
  const { message } = App.useApp();
  const [hubSearch, setHubSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [activeTab, setActiveTab] = useState<HubTab>("catalog");
  const [installed, setInstalled] = useState<ClaudePluginInstalledEntry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [bootstrapHint, setBootstrapHint] = useState<string | null>(null);

  const installedById = useMemo(() => {
    const map = new Map<string, ClaudePluginInstalledEntry>();
    for (const row of installed) {
      map.set(row.id, row);
    }
    return map;
  }, [installed]);

  const loadInstalled = useCallback(async () => {
    setListLoading(true);
    try {
      const rows = await claudePluginListInstalled();
      setInstalled(rows);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
      setInstalled([]);
    } finally {
      setListLoading(false);
    }
  }, [message]);

  const refreshAll = useCallback(async () => {
    setBootstrapping(true);
    try {
      const boot = await claudePluginMarketBootstrap();
      setBootstrapHint(boot.log.trim() || null);
      if (!boot.ok) {
        message.warning("部分插件市场未能自动添加，可稍后重试刷新");
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBootstrapping(false);
    }
    await loadInstalled();
  }, [loadInstalled, message]);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filteredCatalog = useMemo(() => {
    const q = hubSearch.trim().toLowerCase();
    const rows = CLAUDE_PLUGIN_MARKET_CATALOG.filter((entry) => {
      if (category !== "all" && entry.category !== category) return false;
      if (!q) return true;
      const ref = claudePluginInstallRef(entry);
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.pluginId.toLowerCase().includes(q) ||
        ref.toLowerCase().includes(q)
      );
    });
    return sortClaudePluginCatalogEntries(rows);
  }, [category, hubSearch]);

  const installedCatalogRows = useMemo(() => {
    return installed
      .map((row) => {
        const catalog = CLAUDE_PLUGIN_MARKET_CATALOG.find((c) => claudePluginInstallRef(c) === row.id);
        return { row, catalog };
      })
      .filter(({ row, catalog }) => {
        const q = hubSearch.trim().toLowerCase();
        if (!q) return true;
        const name = catalog?.name ?? row.id;
        const desc = catalog?.description ?? "";
        return (
          name.toLowerCase().includes(q) ||
          desc.toLowerCase().includes(q) ||
          row.id.toLowerCase().includes(q)
        );
      });
  }, [hubSearch, installed]);

  const handleInstall = useCallback(
    async (entry: ClaudePluginCatalogEntry) => {
      const ref = claudePluginInstallRef(entry);
      setBusyRef(ref);
      try {
        await claudePluginInstall(ref, "user");
        message.success(`已安装 ${entry.name}`);
        await loadInstalled();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyRef(null);
      }
    },
    [loadInstalled, message],
  );

  const handleUninstall = useCallback(
    async (installRef: string, label: string) => {
      setBusyRef(installRef);
      try {
        await claudePluginUninstall(installRef, "user");
        message.success(`已卸载 ${label}`);
        await loadInstalled();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyRef(null);
      }
    },
    [loadInstalled, message],
  );

  const installedCount = installed.length;
  const catalogNotInstalledCount = useMemo(() => {
    return CLAUDE_PLUGIN_MARKET_CATALOG.filter((e) => !installedById.has(claudePluginInstallRef(e))).length;
  }, [installedById]);

  const renderCardAction = (
    entry: ClaudePluginCatalogEntry,
    ref: string,
    oneClickInstall: boolean,
    isInstalled: boolean,
    busy: boolean,
  ) => {
    if (!oneClickInstall) {
      return (
        <Button
          size="small"
          type="link"
          className="app-claude-plugin-hub-card-cta"
          href={entry.installGuideUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          安装说明
        </Button>
      );
    }
    if (isInstalled) {
      return (
        <span className="app-claude-plugin-hub-card-cta-group">
          <Tag color="success" className="app-claude-plugin-hub-card-installed-tag">
            已安装
          </Tag>
          <Button
            size="small"
            danger
            className="app-claude-plugin-hub-card-cta"
            loading={busy}
            onClick={() => void handleUninstall(ref, entry.name)}
          >
            卸载
          </Button>
        </span>
      );
    }
    return (
      <Tooltip title="一键安装">
        <Button
          type="primary"
          size="small"
          className="app-claude-plugin-hub-card-cta"
          loading={busy}
          onClick={() => void handleInstall(entry)}
        >
          安装
        </Button>
      </Tooltip>
    );
  };

  const renderCard = (entry: ClaudePluginCatalogEntry, installedRow?: ClaudePluginInstalledEntry) => {
    const ref = claudePluginInstallRef(entry);
    const oneClickInstall = entry.oneClickInstall !== false;
    const isInstalled = oneClickInstall && Boolean(installedRow);
    const busy = busyRef === ref;
    return (
      <article key={ref} className="app-claude-plugin-hub-card">
        <div className="app-claude-plugin-hub-card-title-row">
          <div className="app-claude-plugin-hub-card-name">{entry.name}</div>
          {renderCardAction(entry, ref, oneClickInstall, isInstalled, busy)}
        </div>
        <div className="app-claude-plugin-hub-card-ref">{ref}</div>
        {entry.featured ? (
          <div className="app-claude-plugin-hub-card-tags">
            <Tag color="blue">精选</Tag>
          </div>
        ) : null}
        <p className="app-claude-plugin-hub-card-desc">{entry.description}</p>
      </article>
    );
  };

  const catalogPanel =
    filteredCatalog.length === 0 ? (
      <div className="app-claude-plugin-hub-empty-wrap">
        <Empty description="没有符合筛选条件的插件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    ) : (
      <div className="app-claude-plugin-hub-grid">
        {filteredCatalog.map((entry) =>
          renderCard(entry, installedById.get(claudePluginInstallRef(entry))),
        )}
      </div>
    );

  const installedPanel =
    listLoading && installed.length === 0 ? (
      <div className="app-claude-plugin-hub-loading">
        <Spin size="small" />
      </div>
    ) : installedCatalogRows.length === 0 ? (
      <div className="app-claude-plugin-hub-empty-wrap">
        <Empty description="暂无已安装插件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    ) : (
      <div className="app-claude-plugin-hub-grid">
        {installedCatalogRows.map(({ row, catalog }) => {
          if (catalog) return renderCard(catalog, row);
          const fallback: ClaudePluginCatalogEntry = {
            pluginId: row.id.split("@")[0] ?? row.id,
            marketplace: row.id.split("@")[1] ?? "",
            name: row.id,
            description: "已安装（未在精选目录中）",
            category: "featured",
          };
          return renderCard(fallback, row);
        })}
      </div>
    );

  const catalogTabLabel =
    catalogNotInstalledCount > 0 ? (
      <span>
        精选市场 <Badge count={catalogNotInstalledCount} size="small" style={{ marginLeft: 4 }} />
      </span>
    ) : (
      "精选市场"
    );

  const installedTabLabel =
    installedCount > 0 ? (
      <span>
        已安装 <Badge count={installedCount} size="small" style={{ marginLeft: 4 }} />
      </span>
    ) : (
      "已安装"
    );

  const headerActions = (
    <>
      <Button
        size="small"
        icon={<ReloadOutlined />}
        loading={bootstrapping || listLoading}
        onClick={() => void refreshAll()}
      >
        刷新市场
      </Button>
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
    </>
  );

  const headerToolbar = (
    <>
      <Input
        allowClear
        size="small"
        className="app-claude-plugin-hub-search"
        prefix={<SearchOutlined />}
        placeholder="搜索插件…"
        value={hubSearch}
        onChange={(e) => setHubSearch(e.target.value)}
      />
      {activeTab === "catalog" ? (
        <Segmented
          size="small"
          className="app-claude-plugin-hub-category"
          options={(["all", "featured", "workflow", "superpowers", "integration", "lsp"] as const).map(
            (key) => ({
              label: CLAUDE_PLUGIN_CATEGORY_LABELS[key],
              value: key,
            }),
          )}
          value={category}
          onChange={(v) => setCategory(v as CategoryFilter)}
        />
      ) : null}
    </>
  );

  const hubBody = (
    <>
      {bootstrapHint ? (
        <Typography.Text type="secondary" className="app-claude-plugin-hub-bootstrap-hint">
          {bootstrapHint.split("\n").slice(-2).join(" · ")}
        </Typography.Text>
      ) : null}
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as HubTab)}
        size="small"
        className="app-claude-plugin-hub-tabs"
        items={[
          { key: "catalog", label: catalogTabLabel, children: catalogPanel },
          { key: "installed", label: installedTabLabel, children: installedPanel },
        ]}
      />
    </>
  );

  if (embeddedInAuthor) {
    return (
      <AuthorPanelPageShell
        className="app-claude-plugin-hub-root"
        icon={<BlockOutlined />}
        title="Claude Code 插件"
        subtitle="精选 56+ 个主流插件，支持一键安装"
        actions={headerActions}
        toolbar={headerToolbar}
        toolbarLayout="stacked"
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
            Claude Code 插件市场
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
