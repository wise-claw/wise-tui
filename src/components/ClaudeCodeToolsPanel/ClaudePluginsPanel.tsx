import { FolderOpenOutlined } from "@ant-design/icons";
import { App, Button, Empty, Input, Modal, Radio, Segmented, Spin, Tag } from "antd";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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
  claudePluginScanMarketplaceSource,
  claudePluginUninstall,
  type ClaudePluginAvailableEntry,
  type ClaudePluginInstallScope,
  type ClaudePluginInstalledEntry,
} from "../../services/claudePluginMarket";
import { pickFolder } from "../../services/repository";
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
}

type ClaudePluginAddMode = "catalog" | "directory" | "remote" | "command";

function catalogEntryForInstalled(row: ClaudePluginInstalledEntry): ClaudePluginCatalogEntry | null {
  return CLAUDE_PLUGIN_MARKET_CATALOG.find((entry) => claudePluginInstallRef(entry) === row.id) ?? null;
}

export const ClaudePluginsPanel = forwardRef<ClaudePluginsPanelHandle, Props>(function ClaudePluginsPanel(
  { repositoryPath, active, listSearch = "", onCountChange },
  ref,
) {
  const { message } = App.useApp();
  const [installed, setInstalled] = useState<ClaudePluginInstalledEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<ClaudePluginAddMode>("catalog");
  const [addSearch, setAddSearch] = useState("");
  const [marketSource, setMarketSource] = useState("");
  const [marketScanning, setMarketScanning] = useState(false);
  const [marketMarketplaceName, setMarketMarketplaceName] = useState<string | null>(null);
  const [marketAvailable, setMarketAvailable] = useState<ClaudePluginAvailableEntry[]>([]);
  const [installCommandRef, setInstallCommandRef] = useState("");
  const [installCommandBusy, setInstallCommandBusy] = useState(false);
  const [installScope, setInstallScope] = useState<ClaudePluginInstallScope>("user");
  const installLockRef = useRef(false);
  const bootstrapOnceRef = useRef(false);
  const refreshLockRef = useRef(false);
  const hasRepository = Boolean(repositoryPath?.trim());

  const installedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of installed) {
      keys.add(claudePluginInstalledKey(row.id, row.scope));
    }
    return keys;
  }, [installed]);

  const loadInstalled = useCallback(async (opts?: { silent?: boolean }): Promise<ClaudePluginInstalledEntry[]> => {
    if (!opts?.silent) setLoading(true);
    try {
      const rows = await claudePluginListInstalled(repositoryPath);
      setInstalled(rows);
      onCountChange?.(rows.length);
      return rows;
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
      setInstalled([]);
      onCountChange?.(0);
      return [];
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [message, onCountChange, repositoryPath]);

  const refresh = useCallback(async () => {
    if (refreshLockRef.current) return;
    refreshLockRef.current = true;
    setRefreshing(true);
    try {
      await loadInstalled({ silent: true });
    } finally {
      refreshLockRef.current = false;
      setRefreshing(false);
    }
  }, [loadInstalled]);

  const openAddModal = useCallback(() => {
    setAddMode("catalog");
    setAddSearch("");
    setMarketSource("");
    setMarketMarketplaceName(null);
    setMarketAvailable([]);
    setInstallCommandRef("");
    setInstallScope(hasRepository ? "project" : "user");
    setAddOpen(true);
  }, [hasRepository]);

  useImperativeHandle(ref, () => ({ refresh, openAddModal }), [openAddModal, refresh]);

  useEffect(() => {
    if (!active) return;
    void loadInstalled();
  }, [active, loadInstalled]);

  useEffect(() => {
    if (!active || bootstrapOnceRef.current) return;
    bootstrapOnceRef.current = true;
    let cancelled = false;
    void (async () => {
      setBootstrapping(true);
      try {
        const boot = await claudePluginMarketBootstrap();
        if (cancelled) return;
        if (!boot.ok) {
          message.warning("部分插件市场未能自动添加，可稍后重试刷新");
        }
      } catch {
        /* 首次打开失败不阻断列表读取 */
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, message]);

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

  const isMarketScanMode = addMode === "directory" || addMode === "remote";

  const filteredMarketRows = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return marketAvailable;
    return marketAvailable.filter((entry) => {
      return (
        entry.name.toLowerCase().includes(q) ||
        (entry.description ?? "").toLowerCase().includes(q) ||
        entry.pluginId.toLowerCase().includes(q)
      );
    });
  }, [addSearch, marketAvailable]);

  const resetMarketScanResult = useCallback(() => {
    setMarketMarketplaceName(null);
    setMarketAvailable([]);
  }, []);

  const scanMarketplaceSource = useCallback(async () => {
    const source = marketSource.trim();
    if (!source) {
      message.warning(addMode === "directory" ? "请输入本地插件市场目录" : "请输入远程市场来源");
      return;
    }
    setMarketScanning(true);
    const hide = message.loading(
      addMode === "directory" ? "正在扫描本地插件市场…" : "正在拉取远程插件市场…",
      0,
    );
    try {
      const result = await claudePluginScanMarketplaceSource(source, installScope, repositoryPath);
      setMarketMarketplaceName(result.marketplaceName);
      setMarketAvailable(result.available);
      hide();
      if (result.available.length === 0) {
        message.info(`市场「${result.marketplaceName}」中暂无可安装插件`);
      } else {
        message.success(`已加载 ${result.available.length} 个可安装插件`);
      }
    } catch (e) {
      hide();
      message.error(e instanceof Error ? e.message : String(e));
      resetMarketScanResult();
    } finally {
      setMarketScanning(false);
    }
  }, [addMode, installScope, marketSource, message, repositoryPath, resetMarketScanResult]);

  const pickDirectoryPath = useCallback(async () => {
    const picked = await pickFolder();
    if (picked) {
      setMarketSource(picked);
      resetMarketScanResult();
    }
  }, [resetMarketScanResult]);

  const runInstallRef = useCallback(
    async (installRef: string, label: string) => {
      const key = claudePluginInstalledKey(installRef, installScope);
      if (installLockRef.current) {
        message.warning("正在处理其他插件，请稍候");
        return;
      }
      installLockRef.current = true;
      setBusyKey(key);
      const scopeLabel = claudePluginScopeLabel(installScope);
      const hide = message.loading(`正在以「${scopeLabel}」范围安装 ${label}…`, 0);
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

  const runInstall = useCallback(
    async (entry: ClaudePluginCatalogEntry) => {
      await runInstallRef(claudePluginInstallRef(entry), entry.name);
    },
    [runInstallRef],
  );

  const runInstallCommand = useCallback(async () => {
    const installRef = installCommandRef.trim();
    if (!installRef) {
      message.warning("请输入插件标识，格式为 plugin@marketplace");
      return;
    }
    if (!installRef.includes("@")) {
      message.warning("插件标识格式应为 plugin@marketplace");
      return;
    }
    setInstallCommandBusy(true);
    try {
      await runInstallRef(installRef, installRef);
      setInstallCommandRef("");
    } finally {
      setInstallCommandBusy(false);
    }
  }, [installCommandRef, message, runInstallRef]);

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
      <div className={`app-claude-plugins-panel${refreshing ? " app-claude-plugins-panel--refreshing" : ""}`}>
        {refreshing ? (
          <div className="app-claude-plugins-panel-loading" aria-hidden>
            <Spin size="small" />
          </div>
        ) : null}
        {(loading || bootstrapping) && installed.length === 0 ? (
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
        <div className="app-claude-plugins-add-modal-toolbar">
          <Segmented
            size="small"
            className="app-claude-plugins-add-modal-mode"
            value={addMode}
            onChange={(value) => {
              const next = value as ClaudePluginAddMode;
              if (
                (addMode === "directory" && next === "remote") ||
                (addMode === "remote" && next === "directory")
              ) {
                setMarketSource("");
              }
              setAddMode(next);
              if (next !== "directory" && next !== "remote") {
                resetMarketScanResult();
              }
            }}
            options={[
              { label: "精选", value: "catalog" },
              { label: "本地", value: "directory" },
              { label: "远程", value: "remote" },
              { label: "指令", value: "command" },
            ]}
          />
          <Radio.Group
            size="small"
            className="app-claude-plugins-add-modal-scope"
            value={installScope}
            onChange={(e) => setInstallScope(e.target.value as ClaudePluginInstallScope)}
          >
            <Radio.Button value="user">全局</Radio.Button>
            <Radio.Button value="project" disabled={!hasRepository}>项目</Radio.Button>
            <Radio.Button value="local" disabled={!hasRepository}>本地</Radio.Button>
          </Radio.Group>
        </div>
        {isMarketScanMode ? (
          <div className="app-claude-plugins-add-modal-source">
            <div className="app-claude-plugins-add-modal-source-row">
              {addMode === "directory" ? (
                <Button
                  type="text"
                  size="small"
                  className="app-claude-plugins-add-modal-icon-btn"
                  icon={<FolderOpenOutlined />}
                  aria-label="浏览目录"
                  onClick={() => void pickDirectoryPath()}
                />
              ) : null}
              <Input
                allowClear
                size="small"
                className="app-claude-plugins-add-modal-source-input"
                placeholder={addMode === "directory" ? "本地市场目录" : "owner/repo 或 URL"}
                value={marketSource}
                onChange={(e) => {
                  setMarketSource(e.target.value);
                  resetMarketScanResult();
                }}
                onPressEnter={() => void scanMarketplaceSource()}
              />
              {marketMarketplaceName ? (
                <Tag className="app-claude-plugins-add-modal-market-tag">{marketMarketplaceName}</Tag>
              ) : null}
              <Button
                type="primary"
                size="small"
                loading={marketScanning}
                onClick={() => void scanMarketplaceSource()}
              >
                {addMode === "directory" ? "扫描" : "拉取"}
              </Button>
            </div>
          </div>
        ) : null}
        {addMode === "command" ? (
          <div className="app-claude-plugins-add-modal-source">
            <div className="app-claude-plugins-add-modal-source-row">
              <Input
                allowClear
                size="small"
                className="app-claude-plugins-add-modal-source-input"
                placeholder="plugin@marketplace"
                value={installCommandRef}
                onChange={(e) => setInstallCommandRef(e.target.value)}
                onPressEnter={() => void runInstallCommand()}
              />
              <Button
                type="primary"
                size="small"
                loading={installCommandBusy}
                onClick={() => void runInstallCommand()}
              >
                安装
              </Button>
            </div>
          </div>
        ) : null}
        {addMode !== "command" ? (
          <Input
            allowClear
            size="small"
            className="app-claude-plugins-add-modal-search"
            placeholder="搜索…"
            value={addSearch}
            onChange={(e) => setAddSearch(e.target.value)}
          />
        ) : null}
        {addMode === "catalog" ? (
          bootstrapping ? (
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
          )
        ) : isMarketScanMode ? (
          marketScanning ? (
            <div className="app-claude-plugins-panel-loading">
              <Spin size="small" />
            </div>
          ) : filteredMarketRows.length === 0 ? (
            <Empty
              description={marketSource.trim() ? "暂无可安装插件" : "输入来源后扫描"}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <ul className="app-claude-plugins-panel-list app-claude-plugins-add-modal-list">
              {filteredMarketRows.map((entry) => {
              const installRef = entry.pluginId;
              const key = claudePluginInstalledKey(installRef, installScope);
              const busy = busyKey === key;
              const installed = installedKeys.has(key);
              return (
                <li key={installRef} className="app-claude-plugins-panel-item">
                  <div className="app-claude-plugins-panel-item-main">
                    <div className="app-claude-plugins-panel-item-title">{entry.name}</div>
                    <div className="app-claude-plugins-panel-item-ref">{installRef}</div>
                    {entry.description ? (
                      <p className="app-claude-plugins-panel-item-desc">{entry.description}</p>
                    ) : null}
                  </div>
                  <div className="app-claude-plugins-panel-item-actions">
                    <Button
                      type="primary"
                      size="small"
                      className="app-claude-plugins-panel-item-btn"
                      loading={busy}
                      disabled={installed}
                      onClick={() => void runInstallRef(installRef, entry.name)}
                    >
                      {installed ? "已安装" : "安装"}
                    </Button>
                  </div>
                </li>
              );
              })}
            </ul>
          )
        ) : null}
      </Modal>
    </>
  );
});
