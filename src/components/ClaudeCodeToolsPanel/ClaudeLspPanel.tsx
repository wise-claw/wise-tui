import { ReloadOutlined } from "@ant-design/icons";
import { HoverHint } from "../shared/HoverHint";
import { App, Button, Empty, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  claudePluginInstallRef,
  getClaudeLspCoreCatalogEntries,
  type ClaudePluginCatalogEntry,
} from "../../constants/claudePluginMarketCatalog";
import {
  claudePluginInstall,
  claudePluginListInstalled,
  claudePluginMarketBootstrap,
  claudePluginUninstall,
  type ClaudePluginInstalledEntry,
} from "../../services/claudePluginMarket";
import { openClaudeLspPluginsDoc } from "../../services/claudeLspUsageGuide";

interface Props {
  active: boolean;
  listSearch: string;
  onCountChange?: (count: number) => void;
}

export function ClaudeLspPanel({ active, listSearch, onCountChange }: Props) {
  const { message } = App.useApp();
  const [installed, setInstalled] = useState<ClaudePluginInstalledEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [busyRef, setBusyRef] = useState<string | null>(null);

  const coreEntries = useMemo(() => getClaudeLspCoreCatalogEntries(), []);

  const installedById = useMemo(() => {
    const map = new Map<string, ClaudePluginInstalledEntry>();
    for (const row of installed) {
      map.set(row.id, row);
    }
    return map;
  }, [installed]);

  const loadInstalled = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await claudePluginListInstalled();
      setInstalled(rows);
      onCountChange?.(rows.filter((row) => coreEntries.some((e) => claudePluginInstallRef(e) === row.id)).length);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
      setInstalled([]);
      onCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [coreEntries, message, onCountChange]);

  const refreshMarket = useCallback(async () => {
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

  useEffect(() => {
    if (!active) return;
    void loadInstalled();
  }, [active, loadInstalled]);

  const filteredEntries = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return coreEntries;
    return coreEntries.filter((entry) => {
      const ref = claudePluginInstallRef(entry);
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.pluginId.toLowerCase().includes(q) ||
        ref.toLowerCase().includes(q)
      );
    });
  }, [coreEntries, listSearch]);

  const handleInstallOne = useCallback(
    async (entry: ClaudePluginCatalogEntry) => {
      const ref = claudePluginInstallRef(entry);
      setBusyRef(ref);
      try {
        await claudePluginInstall(ref, "user");
        await loadInstalled();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyRef(null);
      }
    },
    [loadInstalled, message],
  );

  const handleUninstallOne = useCallback(
    async (entry: ClaudePluginCatalogEntry) => {
      const ref = claudePluginInstallRef(entry);
      setBusyRef(ref);
      try {
        await claudePluginUninstall(ref, "user");
        await loadInstalled();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyRef(null);
      }
    },
    [loadInstalled, message],
  );

  if (!active) return null;

  return (
    <div className="app-claude-lsp-panel">
      <div className="app-claude-lsp-panel-intro">
        <Typography.Text type="secondary" className="app-claude-lsp-panel-intro-text">
          官方 LSP：跳转、引用与诊断；安装后新会话生效。
        </Typography.Text>
        <HoverHint title="刷新插件市场与安装状态">
          <Button
            type="text"
            size="small"
            className="app-claude-lsp-panel-intro-refresh"
            icon={<ReloadOutlined />}
            loading={bootstrapping || loading}
            aria-label="刷新"
            onClick={() => void refreshMarket()}
          />
        </HoverHint>
      </div>
      {loading && installed.length === 0 ? (
        <div className="app-claude-lsp-panel-loading">
          <Spin size="small" />
        </div>
      ) : filteredEntries.length === 0 ? (
        <Empty description="没有符合筛选条件的语言服务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <ul className="app-claude-lsp-panel-list">
          {filteredEntries.map((entry) => {
            const ref = claudePluginInstallRef(entry);
            const isInstalled = installedById.has(ref);
            const busy = busyRef === ref;
            return (
              <li key={ref} className="app-claude-lsp-panel-item">
                <div className="app-claude-lsp-panel-item-main">
                  <div className="app-claude-lsp-panel-item-title">{entry.name}</div>
                  <div className="app-claude-lsp-panel-item-ref">{ref}</div>
                  <p className="app-claude-lsp-panel-item-desc">{entry.description}</p>
                </div>
                <div className="app-claude-lsp-panel-item-actions">
                  {isInstalled ? (
                    <>
                      <Tag color="success" className="app-claude-lsp-panel-item-tag">
                        已安装
                      </Tag>
                      <Button
                        size="small"
                        danger
                        className="app-claude-lsp-panel-item-btn"
                        loading={busy}
                        onClick={() => void handleUninstallOne(entry)}
                      >
                        卸载
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="primary"
                      size="small"
                      className="app-claude-lsp-panel-item-btn"
                      loading={busy}
                      onClick={() => void handleInstallOne(entry)}
                    >
                      安装
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Typography.Link className="app-claude-lsp-panel-more" onClick={() => openClaudeLspPluginsDoc()}>
        更多语言服务见「创作 → 插件市场 → 语言服务」
      </Typography.Link>
    </div>
  );
}
