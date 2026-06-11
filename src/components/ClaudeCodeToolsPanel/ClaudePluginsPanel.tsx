import { App, Button, Empty, Input, Modal, Radio, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLAUDE_PLUGIN_MARKET_CATALOG,
  claudePluginInstallRef,
  sortClaudePluginCatalogEntries,
  type ClaudePluginCatalogEntry,
} from "../../constants/claudePluginMarketCatalog";
import {
  claudePluginInstall,
  claudePluginListInstalled,
  claudePluginMarketBootstrap,
  claudePluginUninstall,
  type ClaudePluginInstallScope,
  type ClaudePluginInstalledEntry,
} from "../../services/claudePluginMarket";
import {
  claudePluginInstalledKey,
  claudePluginScopeLabel,
  normalizeClaudePluginScope,
} from "../../utils/claudePluginScopeLabel";

export interface ClaudePluginsPanelHandle {
  refresh: () => Promise<void>;
  openAddModal: () => void;
}

interface Props {
  repositoryPath?: string;
  active: boolean;
  listSearch?: string;
  onCountChange?: (count: number) => void;
  onBindActions?: (actions: ClaudePluginsPanelHandle | null) => void;
}

function catalogEntryForInstalled(row: ClaudePluginInstalledEntry): ClaudePluginCatalogEntry | null {
  return CLAUDE_PLUGIN_MARKET_CATALOG.find((entry) => claudePluginInstallRef(entry) === row.id) ?? null;
}

export function ClaudePluginsPanel({
  repositoryPath,
  active,
  listSearch = "",
  onCountChange,
  onBindActions,
}: Props) {
  const { message } = App.useApp();
  const [installed, setInstalled] = useState<ClaudePluginInstalledEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [installScope, setInstallScope] = useState<ClaudePluginInstallScope>("user");
  const installLockRef = useRef(false);
  const hasRepository = Boolean(repositoryPath?.trim());

  const installedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of installed) {
      keys.add(claudePluginInstalledKey(row.id, row.scope));
    }
    return keys;
  }, [installed]);

  const loadInstalled = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await claudePluginListInstalled(repositoryPath);
      setInstalled(rows);
      onCountChange?.(rows.length);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
      setInstalled([]);
      onCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [message, onCountChange, repositoryPath]);

  const refresh = useCallback(async () => {
    setBootstrapping(true);
    try {
      const boot = await claudePluginMarketBootstrap();
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

  const openAddModal = useCallback(() => {
    setAddSearch("");
    setInstallScope(hasRepository ? "project" : "user");
    setAddOpen(true);
  }, [hasRepository]);

  useEffect(() => {
    onBindActions?.({ refresh, openAddModal });
    return () => onBindActions?.(null);
  }, [onBindActions, openAddModal, refresh]);

  useEffect(() => {
    if (!active) return;
    void loadInstalled();
  }, [active, loadInstalled]);

  const filteredInstalled = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return installed;
    return installed.filter((row) => {
      const catalog = catalogEntryForInstalled(row);
      const name = catalog?.name ?? row.id;
      const desc = catalog?.description ?? "";
      const scopeLabel = claudePluginScopeLabel(row.scope);
      return (
        name.toLowerCase().includes(q) ||
        desc.toLowerCase().includes(q) ||
        row.id.toLowerCase().includes(q) ||
        scopeLabel.includes(q)
      );
    });
  }, [installed, listSearch]);

  const addCatalogRows = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    const notInstalled = CLAUDE_PLUGIN_MARKET_CATALOG.filter(
      (entry) =>
        entry.oneClickInstall !== false &&
        !installedKeys.has(claudePluginInstalledKey(claudePluginInstallRef(entry), installScope)),
    );
    const filtered = notInstalled.filter((entry) => {
      if (!q) return true;
      const ref = claudePluginInstallRef(entry);
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.pluginId.toLowerCase().includes(q) ||
        ref.toLowerCase().includes(q)
      );
    });
    return sortClaudePluginCatalogEntries(filtered);
  }, [addSearch, installScope, installedKeys]);

  const runInstall = useCallback(
    async (entry: ClaudePluginCatalogEntry) => {
      const installRef = claudePluginInstallRef(entry);
      const key = claudePluginInstalledKey(installRef, installScope);
      if (installLockRef.current) {
        message.warning("正在处理其他插件，请稍候");
        return;
      }
      installLockRef.current = true;
      setBusyKey(key);
      const scopeLabel = claudePluginScopeLabel(installScope);
      const hide = message.loading(`正在以「${scopeLabel}」范围安装 ${entry.name}…`, 0);
      try {
        await claudePluginInstall(installRef, installScope, repositoryPath);
        hide();
        await loadInstalled();
      } catch (e) {
        hide();
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyKey(null);
        installLockRef.current = false;
      }
    },
    [installScope, loadInstalled, message, repositoryPath],
  );

  const runUninstall = useCallback(
    async (row: ClaudePluginInstalledEntry, label: string) => {
      const scope = normalizeClaudePluginScope(row.scope);
      const key = claudePluginInstalledKey(row.id, scope);
      if (installLockRef.current) {
        message.warning("正在处理其他插件，请稍候");
        return;
      }
      installLockRef.current = true;
      setBusyKey(key);
      const scopeLabel = claudePluginScopeLabel(scope);
      const hide = message.loading(`正在从「${scopeLabel}」范围卸载 ${label}…`, 0);
      try {
        await claudePluginUninstall(row.id, scope, repositoryPath);
        hide();
        await loadInstalled();
      } catch (e) {
        hide();
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyKey(null);
        installLockRef.current = false;
      }
    },
    [loadInstalled, message, repositoryPath],
  );

  if (!active) return null;

  return (
    <>
      <div className="app-claude-plugins-panel">
        {loading && installed.length === 0 ? (
          <div className="app-claude-plugins-panel-loading">
            <Spin size="small" />
          </div>
        ) : filteredInstalled.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              listSearch.trim()
                ? "没有符合筛选条件的已安装插件"
                : hasRepository
                  ? "暂无已安装插件（展示全局与当前仓库项目级安装；可点「添加」安装）"
                  : "暂无已安装插件（展示全局安装；选择仓库后可管理项目级插件）"
            }
          />
        ) : (
          <ul className="app-claude-plugins-panel-list">
            {filteredInstalled.map((row) => {
              const catalog = catalogEntryForInstalled(row);
              const label = catalog?.name ?? row.id;
              const scope = normalizeClaudePluginScope(row.scope);
              const key = claudePluginInstalledKey(row.id, scope);
              const busy = busyKey === key;
              return (
                <li key={key} className="app-claude-plugins-panel-item">
                  <div className="app-claude-plugins-panel-item-main">
                    <div className="app-claude-plugins-panel-item-title-row">
                      <span className="app-claude-plugins-panel-item-title">{label}</span>
                      <Tag className="app-claude-plugins-panel-item-scope-tag">
                        {claudePluginScopeLabel(scope)}
                      </Tag>
                      {!row.enabled ? (
                        <Tag color="default" className="app-claude-plugins-panel-item-scope-tag">
                          已禁用
                        </Tag>
                      ) : null}
                    </div>
                    <div className="app-claude-plugins-panel-item-ref">{row.id}</div>
                    {catalog?.description ? (
                      <p className="app-claude-plugins-panel-item-desc">{catalog.description}</p>
                    ) : null}
                  </div>
                  <div className="app-claude-plugins-panel-item-actions">
                    <Button
                      size="small"
                      danger
                      className="app-claude-plugins-panel-item-btn"
                      loading={busy}
                      onClick={() => void runUninstall(row, label)}
                    >
                      卸载
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal
        title="添加插件"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        footer={null}
        width={480}
        destroyOnHidden
        className="app-claude-plugins-add-modal"
      >
        <Typography.Text type="secondary" className="app-claude-plugins-add-modal-hint">
          从精选市场一键安装。全局写入 ~/.claude/settings.json；项目级写入当前仓库 .claude/settings.json。
        </Typography.Text>
        <div className="app-claude-plugins-add-modal-scope">
          <Typography.Text type="secondary" className="app-claude-plugins-add-modal-scope-label">
            安装范围
          </Typography.Text>
          <Radio.Group
            size="small"
            value={installScope}
            onChange={(e) => setInstallScope(e.target.value as ClaudePluginInstallScope)}
          >
            <Radio.Button value="user">全局</Radio.Button>
            <Radio.Button value="project" disabled={!hasRepository}>项目</Radio.Button>
            <Radio.Button value="local" disabled={!hasRepository}>本地</Radio.Button>
          </Radio.Group>
        </div>
        <Input
          allowClear
          size="small"
          className="app-claude-plugins-add-modal-search"
          placeholder="搜索插件…"
          value={addSearch}
          onChange={(e) => setAddSearch(e.target.value)}
        />
        {bootstrapping ? (
          <div className="app-claude-plugins-panel-loading">
            <Spin size="small" />
          </div>
        ) : addCatalogRows.length === 0 ? (
          <Empty description="没有可安装的插件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <ul className="app-claude-plugins-panel-list app-claude-plugins-add-modal-list">
            {addCatalogRows.map((entry) => {
              const installRef = claudePluginInstallRef(entry);
              const key = claudePluginInstalledKey(installRef, installScope);
              const busy = busyKey === key;
              return (
                <li key={installRef} className="app-claude-plugins-panel-item">
                  <div className="app-claude-plugins-panel-item-main">
                    <div className="app-claude-plugins-panel-item-title">{entry.name}</div>
                    <div className="app-claude-plugins-panel-item-ref">{installRef}</div>
                    <p className="app-claude-plugins-panel-item-desc">{entry.description}</p>
                  </div>
                  <div className="app-claude-plugins-panel-item-actions">
                    <Button
                      type="primary"
                      size="small"
                      className="app-claude-plugins-panel-item-btn"
                      loading={busy}
                      onClick={() => void runInstall(entry)}
                    >
                      安装
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
    </>
  );
}
