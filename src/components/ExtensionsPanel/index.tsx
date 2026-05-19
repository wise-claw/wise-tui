import {
  AppstoreAddOutlined,
  DownOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { App, Button, Empty, Input, Space, Spin, Switch } from "antd";
import { openPath } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AuthorPanelEmptyShell,
  AuthorPanelHubTab,
  AuthorPanelHubTabs,
  AuthorPanelListShell,
  AuthorPanelPageShell,
} from "../AuthorPanel/AuthorPanelPageShell";
import { HubDot, HubItem, HubItems, HubTag } from "../HubCard";
import {
  listExtensions,
  reloadExtensions,
  setExtensionEnabled,
} from "../../services/extensions";
import type {
  ExtensionListEntry,
  ResolvedSettingsDeclaration,
  ResolvedSkill,
  ResolvedTheme,
} from "../../types/extension";
import {
  getExtensionSettingsDeclarations,
  getExtensionSkills,
  getExtensionThemes,
} from "../../services/extensions";
import "./index.css";

interface ContributeCounts {
  skills: number;
  themes: number;
  settings: number;
}

interface ExtensionView extends ExtensionListEntry {
  contributes: ContributeCounts;
}

function countContributes(
  name: string,
  skills: ResolvedSkill[],
  themes: ResolvedTheme[],
  settings: ResolvedSettingsDeclaration[],
): ContributeCounts {
  return {
    skills: skills.filter((s) => s.extension === name).length,
    themes: themes.filter((t) => t.extension === name).length,
    settings: settings.filter((s) => s.extension === name).length,
  };
}

export function ExtensionsPanel() {
  const { message } = App.useApp();
  const [list, setList] = useState<ExtensionListEntry[]>([]);
  const [skills, setSkills] = useState<ResolvedSkill[]>([]);
  const [themes, setThemes] = useState<ResolvedTheme[]>([]);
  const [decls, setDecls] = useState<ResolvedSettingsDeclaration[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"installed" | "disabled" | "errors">("installed");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [l, s, t, d] = await Promise.all([
        listExtensions(),
        getExtensionSkills(),
        getExtensionThemes(),
        getExtensionSettingsDeclarations(),
      ]);
      setList(l);
      setSkills(s);
      setThemes(t);
      setDecls(d);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const handleReload = useCallback(async () => {
    setReloading(true);
    try {
      const next = await reloadExtensions();
      setList(next);
      const [s, t, d] = await Promise.all([
        getExtensionSkills(),
        getExtensionThemes(),
        getExtensionSettingsDeclarations(),
      ]);
      setSkills(s);
      setThemes(t);
      setDecls(d);
      message.success("已重新扫描扩展目录");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setReloading(false);
    }
  }, [message]);

  const handleToggle = useCallback(
    async (name: string, enabled: boolean) => {
      setBusy(name);
      try {
        await setExtensionEnabled(name, enabled);
        setList((prev) => prev.map((e) => (e.name === name ? { ...e, enabled } : e)));
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [message],
  );

  const toggleExpanded = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleOpenExtensionsDir = useCallback(async () => {
    try {
      const home = await import("@tauri-apps/api/path").then((m) => m.homeDir());
      await openPath(`${home}/.wise/extensions`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  }, [message]);

  const enriched: ExtensionView[] = useMemo(
    () => list.map((e) => ({ ...e, contributes: countContributes(e.name, skills, themes, decls) })),
    [list, skills, themes, decls],
  );

  const filtered = useMemo(() => {
    let xs = enriched;
    if (scope === "installed") xs = xs.filter((e) => e.installed && !e.error);
    else if (scope === "disabled") xs = xs.filter((e) => !e.enabled);
    else xs = xs.filter((e) => Boolean(e.error));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      xs = xs.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q),
      );
    }
    return xs;
  }, [enriched, scope, query]);

  const counts = useMemo(
    () => ({
      installed: enriched.filter((e) => e.installed && !e.error).length,
      disabled: enriched.filter((e) => !e.enabled).length,
      errors: enriched.filter((e) => Boolean(e.error)).length,
    }),
    [enriched],
  );

  return (
    <AuthorPanelPageShell
      className="app-extensions-panel"
      id="extensions"
      icon={<AppstoreAddOutlined />}
      title="扩展市场"
      subtitle="本地扩展、远程索引和贡献能力"
      actions={
        <Space size={8} wrap>
          <Input
            size="small"
            allowClear
            className="app-extensions-panel__search"
            prefix={<SearchOutlined />}
            placeholder="搜索扩展…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={reloading}
            onClick={() => void handleReload()}
          >
            重新扫描
          </Button>
          <Button
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={() => void handleOpenExtensionsDir()}
          >
            打开目录
          </Button>
        </Space>
      }
      toolbar={
        <AuthorPanelHubTabs aria-label="扩展筛选">
          <AuthorPanelHubTab
            active={scope === "installed"}
            label="已安装"
            count={counts.installed}
            onClick={() => setScope("installed")}
          />
          <AuthorPanelHubTab
            active={scope === "disabled"}
            label="已禁用"
            count={counts.disabled}
            onClick={() => setScope("disabled")}
          />
          <AuthorPanelHubTab
            active={scope === "errors"}
            label="异常"
            count={counts.errors}
            onClick={() => setScope("errors")}
          />
        </AuthorPanelHubTabs>
      }
    >
        {loading && enriched.length === 0 ? (
          <div className="author-panel-page__loading">
            <Spin size="small" />
          </div>
        ) : filtered.length === 0 ? (
          <AuthorPanelEmptyShell>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                scope === "installed"
                  ? "暂无扩展。把 wise-extension.json 目录放入 ~/.wise/extensions/ 后点重新扫描。"
                  : scope === "disabled"
                    ? "没有禁用的扩展"
                    : "没有异常的扩展"
              }
            />
          </AuthorPanelEmptyShell>
        ) : (
          <AuthorPanelListShell>
            <HubItems>
              {filtered.map((ext) => {
                const tone: "success" | "danger" | "default" = ext.error
                  ? "danger"
                  : ext.enabled
                    ? "success"
                    : "default";
                const dot: "on" | "warn" | "off" = ext.error
                  ? "warn"
                  : ext.enabled
                    ? "on"
                    : "off";
                const statusLabel = ext.error
                  ? "异常"
                  : ext.enabled
                    ? "启用"
                    : "已禁用";
                const isOpen = expanded.has(ext.name);
                const extSkills = skills.filter((s) => s.extension === ext.name);
                const extThemes = themes.filter((t) => t.extension === ext.name);
                const extDecls = decls.filter((d) => d.extension === ext.name);
                const hasContributes = extSkills.length + extThemes.length + extDecls.length > 0;
                return (
                  <div key={ext.name}>
                    <HubItem
                      avatarText={ext.name || "·"}
                      title={ext.name}
                      tags={
                        <>
                          {ext.version ? <HubTag mono>v{ext.version}</HubTag> : null}
                          <HubTag tone={tone}>
                            <HubDot tone={dot} /> {statusLabel}
                          </HubTag>
                          {ext.contributes.skills > 0 ? (
                            <HubTag mono>技能·{ext.contributes.skills}</HubTag>
                          ) : null}
                          {ext.contributes.themes > 0 ? (
                            <HubTag mono>主题·{ext.contributes.themes}</HubTag>
                          ) : null}
                          {ext.contributes.settings > 0 ? (
                            <HubTag mono>设置·{ext.contributes.settings}</HubTag>
                          ) : null}
                        </>
                      }
                      description={
                        ext.error ? (
                          <span style={{ color: "var(--ant-color-error)" }}>{ext.error}</span>
                        ) : (
                          ext.description || "—"
                        )
                      }
                      actions={
                        <>
                          {hasContributes ? (
                            <Button
                              size="small"
                              type="text"
                              icon={isOpen ? <DownOutlined /> : <RightOutlined />}
                              onClick={() => toggleExpanded(ext.name)}
                              aria-label={isOpen ? "折叠贡献" : "展开贡献"}
                            />
                          ) : null}
                          <Switch
                            size="small"
                            checked={ext.enabled}
                            loading={busy === ext.name}
                            disabled={Boolean(ext.error)}
                            onChange={(checked) => void handleToggle(ext.name, checked)}
                          />
                        </>
                      }
                    />
                    {isOpen && hasContributes ? (
                      <div className="app-ext-contributes">
                        {extSkills.length > 0 ? (
                          <div className="app-ext-contributes__group">
                            <div className="app-ext-contributes__label">
                              技能 · {extSkills.length}
                            </div>
                            <ul className="app-ext-contributes__list">
                              {extSkills.map((s) => (
                                <li key={s.id}>
                                  <span className="app-ext-contributes__name">{s.name}</span>
                                  <span className="app-ext-contributes__desc">{s.description}</span>
                                  <span className="app-ext-contributes__path">{s.location}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {extThemes.length > 0 ? (
                          <div className="app-ext-contributes__group">
                            <div className="app-ext-contributes__label">
                              主题 · {extThemes.length}
                            </div>
                            <ul className="app-ext-contributes__list">
                              {extThemes.map((t) => (
                                <li key={t.id}>
                                  <span className="app-ext-contributes__name">{t.name}</span>
                                  <span className="app-ext-contributes__path">{t.location}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {extDecls.length > 0 ? (
                          <div className="app-ext-contributes__group">
                            <div className="app-ext-contributes__label">
                              设置项 · {extDecls.length}
                            </div>
                            <ul className="app-ext-contributes__list">
                              {extDecls.map((d) => (
                                <li key={d.id}>
                                  <span className="app-ext-contributes__name">{d.label}</span>
                                  <span className="app-ext-contributes__desc">
                                    {d.description ?? "—"}
                                  </span>
                                  <span className="app-ext-contributes__path">{d.kind}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </HubItems>
          </AuthorPanelListShell>
        )}
    </AuthorPanelPageShell>
  );
}
