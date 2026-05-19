import {
  CloseOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { App, Alert, Button, Empty, Input, Segmented, Spin, Tag, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listClaudeProjectSkills, listClaudeUserSkills } from "../../services/claude";
import {
  addExternalSkillPath,
  deleteImportedSkill,
  detectExternalSkillPaths,
  importSkillCopy,
  importSkillSymlink,
  removeExternalSkillPath,
  scanSkillPath,
  type DetectedExternalPath,
  type ScannedSkill,
} from "../../services/skills";
import { getExtensionSkills } from "../../services/extensions";
import type { ResolvedSkill } from "../../types/extension";
import {
  skillsCliAddFromRegistry,
  skillsCliRemoveFromRegistry,
  skillsShSearch,
  type SkillsInstallScope,
  type SkillsShSkillEntry,
} from "../../services/skillsSh";
import { AuthorPanelPageShell } from "../AuthorPanel/AuthorPanelPageShell";
import "./SkillsHub.css";

interface Props {
  repositoryPath?: string | null;
  onClose?: () => void;
}

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type HubMode = "registry" | "external" | "extension";

export function SkillsHub({ repositoryPath, onClose }: Props) {
  const embeddedInAuthor = !onClose;
  const { message } = App.useApp();
  const [hubMode, setHubMode] = useState<HubMode>("registry");
  const [installScope, setInstallScope] = useState<SkillsInstallScope>("project");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SkillsShSkillEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installedNames, setInstalledNames] = useState<ReadonlySet<string>>(new Set());
  const [listLoading, setListLoading] = useState(false);
  const [busySkillId, setBusySkillId] = useState<string | null>(null);

  // External-browse state
  const [externalPaths, setExternalPaths] = useState<DetectedExternalPath[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [selectedExternalPath, setSelectedExternalPath] = useState<string | null>(null);
  const [scannedSkills, setScannedSkills] = useState<ScannedSkill[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [importBusy, setImportBusy] = useState<string | null>(null);
  const [newPathInput, setNewPathInput] = useState("");

  // Extension-contributed skills (read-only)
  const [extSkills, setExtSkills] = useState<ResolvedSkill[]>([]);
  const [extLoading, setExtLoading] = useState(false);

  const refreshExtSkills = useCallback(async () => {
    setExtLoading(true);
    try {
      const next = await getExtensionSkills();
      setExtSkills(next);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setExtLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void refreshExtSkills();
  }, [refreshExtSkills]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadInstalled = useCallback(async () => {
    const path = repositoryPath?.trim() ?? "";
    if (installScope === "project" && !path) {
      setInstalledNames(new Set());
      return;
    }
    setListLoading(true);
    try {
      const list =
        installScope === "global" ? await listClaudeUserSkills() : await listClaudeProjectSkills(path);
      setInstalledNames(new Set(list.map((s) => s.name)));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
      setInstalledNames(new Set());
    } finally {
      setListLoading(false);
    }
  }, [installScope, message, repositoryPath]);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    void skillsShSearch(debouncedQuery, 24)
      .then((r) => {
        if (!cancelled) {
          setResults(r.skills);
          setSearchError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setResults([]);
          setSearchError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const refreshExternalPaths = useCallback(async () => {
    setExternalLoading(true);
    try {
      const paths = await detectExternalSkillPaths();
      setExternalPaths(paths);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setExternalLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void refreshExternalPaths();
  }, [refreshExternalPaths]);

  useEffect(() => {
    if (hubMode !== "external" || !selectedExternalPath) {
      setScannedSkills([]);
      return;
    }
    let cancelled = false;
    setScanLoading(true);
    void scanSkillPath(selectedExternalPath)
      .then((s) => {
        if (!cancelled) setScannedSkills(s);
      })
      .catch((e) => {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : String(e));
          setScannedSkills([]);
        }
      })
      .finally(() => {
        if (!cancelled) setScanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hubMode, message, selectedExternalPath]);

  const handleAddExternalPath = useCallback(async () => {
    const trimmed = newPathInput.trim();
    if (!trimmed) return;
    try {
      await addExternalSkillPath(trimmed);
      setNewPathInput("");
      await refreshExternalPaths();
      message.success(`已记录外部路径：${trimmed}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  }, [message, newPathInput, refreshExternalPaths]);

  const handleRemoveExternalPath = useCallback(
    async (id: string) => {
      try {
        await removeExternalSkillPath(id);
        await refreshExternalPaths();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      }
    },
    [message, refreshExternalPaths],
  );

  const handleImport = useCallback(
    async (skill: ScannedSkill, mode: "copy" | "symlink") => {
      setImportBusy(skill.location);
      try {
        const fn = mode === "copy" ? importSkillCopy : importSkillSymlink;
        const imported = await fn(skill.location);
        message.success(
          mode === "copy"
            ? `已复制「${imported.name}」到 ~/.wise/skills/`
            : `已链接「${imported.name}」到 ~/.wise/skills/`,
        );
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setImportBusy(null);
      }
    },
    [message],
  );

  const handleDeleteImported = useCallback(
    async (skill: ScannedSkill) => {
      setImportBusy(skill.location);
      try {
        await deleteImportedSkill(skill.name);
        message.success(`已从 ~/.wise/skills/ 删除「${skill.name}」`);
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setImportBusy(null);
      }
    },
    [message],
  );

  const hasRepo = Boolean(repositoryPath?.trim());
  const canInstallOrRemove = installScope === "global" || hasRepo;

  const handleInstall = useCallback(
    async (entry: SkillsShSkillEntry) => {
      const repoPath = repositoryPath?.trim() ?? "";
      if (installScope === "project" && !repoPath) {
        message.warning("请先在侧栏选择仓库，仓库级技能将安装到该仓库根目录的 .claude/skills/");
        return;
      }
      setBusySkillId(entry.skillId);
      try {
        await skillsCliAddFromRegistry(
          installScope === "global" ? null : repoPath,
          entry.source,
          entry.skillId,
          installScope,
        );
        message.success(
          installScope === "global"
            ? `已全局安装「${entry.skillId}」（~/.claude/skills/）`
            : `已安装「${entry.skillId}」到当前仓库`,
        );
        await loadInstalled();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusySkillId(null);
      }
    },
    [installScope, loadInstalled, message, repositoryPath],
  );

  const handleUninstall = useCallback(
    async (entry: SkillsShSkillEntry) => {
      const repoPath = repositoryPath?.trim() ?? "";
      if (installScope === "project" && !repoPath) return;
      setBusySkillId(entry.skillId);
      try {
        await skillsCliRemoveFromRegistry(
          installScope === "global" ? null : repoPath,
          entry.skillId,
          installScope,
        );
        message.success(`已卸载「${entry.skillId}」`);
        await loadInstalled();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusySkillId(null);
      }
    },
    [installScope, loadInstalled, message, repositoryPath],
  );

  const emptyHint = useMemo(() => {
    if (query.trim().length > 0 && query.trim().length < 2) {
      return "请至少输入 2 个字符再搜索";
    }
    if (debouncedQuery.length >= 2 && !searchLoading && results.length === 0 && !searchError) {
      return "未找到匹配的技能";
    }
    return "在上方搜索 skills.sh 目录中的技能";
  }, [debouncedQuery.length, query, results.length, searchError, searchLoading]);

  const externalSkillTotal = useMemo(
    () => externalPaths.reduce((sum, item) => sum + (item.exists ? item.count : 0), 0),
    [externalPaths],
  );

  const hubInner = (
    <div className="app-skills-hub-root">
      <header className="app-skills-hub-header">
        {!embeddedInAuthor ? (
          <div className="app-skills-hub-header-top">
            <Typography.Title level={5} className="app-skills-hub-title">
              技能市场
            </Typography.Title>
            {onClose ? (
              <Tooltip title="关闭" mouseEnterDelay={0.35}>
                <Button
                  type="text"
                  size="small"
                  className="app-skills-hub-close-btn"
                  icon={<CloseOutlined />}
                  aria-label="关闭"
                  onClick={onClose}
                />
              </Tooltip>
            ) : null}
          </div>
        ) : null}
        <Segmented<HubMode>
          size="small"
          value={hubMode}
          onChange={(v) => setHubMode(v)}
          options={[
            { label: `公开目录 · ${debouncedQuery.length >= 2 ? results.length : installedNames.size}`, value: "registry" },
            { label: `本机外部 · ${externalSkillTotal}`, value: "external" },
            { label: `扩展贡献 · ${extSkills.length}`, value: "extension" },
          ]}
        />
        <div className="app-skills-hub-scope-row">
          <span className="app-skills-hub-scope-label">安装范围</span>
          <Segmented<SkillsInstallScope>
            size="small"
            value={installScope}
            onChange={(v) => setInstallScope(v)}
            className="app-skills-hub-scope-segmented"
            options={[
              { label: "当前仓库", value: "project" },
              { label: "全局（用户）", value: "global" },
            ]}
            disabled={hubMode === "external"}
          />
        </div>
        {hubMode === "extension" ? (
          <div className="app-skills-hub-search-row">
            <Button size="small" icon={<ReloadOutlined />} loading={extLoading} onClick={() => void refreshExtSkills()}>
              刷新扩展贡献
            </Button>
          </div>
        ) : (
          <div className="app-skills-hub-search-row">
            <Input
              allowClear
              size="small"
              prefix={<SearchOutlined />}
              placeholder={
                hubMode === "registry" ? "搜索公开技能（至少 2 个字符）…" : "粘贴新的外部技能目录"
              }
              value={hubMode === "registry" ? query : newPathInput}
              onChange={(e) =>
                hubMode === "registry" ? setQuery(e.target.value) : setNewPathInput(e.target.value)
              }
              onPressEnter={hubMode === "external" ? () => void handleAddExternalPath() : undefined}
              className="app-skills-hub-search"
            />
            {hubMode === "registry" ? (
              <Button size="small" icon={<ReloadOutlined />} loading={listLoading} onClick={() => void loadInstalled()}>
                同步安装态
              </Button>
            ) : (
              <>
                <Button size="small" type="primary" disabled={!newPathInput.trim()} onClick={() => void handleAddExternalPath()}>
                  添加路径
                </Button>
                <Button size="small" icon={<ReloadOutlined />} loading={externalLoading} onClick={() => void refreshExternalPaths()}>
                  刷新外部目录
                </Button>
              </>
            )}
          </div>
        )}
      </header>

      {hubMode === "registry" && installScope === "project" && !hasRepo ? (
        <Alert
          type="warning"
          showIcon
          className="app-skills-hub-alert app-skills-hub-alert--compact"
          message={
            <span className="app-skills-hub-alert-inline">
              <Typography.Text strong>未选择仓库</Typography.Text>
              <Typography.Text type="secondary"> 仓库级安装与「同步安装态」需先在侧栏选择仓库。</Typography.Text>
            </span>
          }
        />
      ) : null}
      {hubMode === "registry" && installScope === "global" ? (
        <Alert
          type="info"
          showIcon
          className="app-skills-hub-alert app-skills-hub-alert--compact"
          message={
            <span className="app-skills-hub-alert-inline">
              <Typography.Text strong>全局技能</Typography.Text>
              <Typography.Text type="secondary">
                {" "}
                对所有本机 Claude Code 会话可见；与当前侧栏仓库无关。
              </Typography.Text>
            </span>
          }
        />
      ) : null}

      {hubMode === "registry" ? (
        <>
          {searchError ? (
            <Alert type="error" showIcon className="app-skills-hub-alert app-skills-hub-alert--compact" message={searchError} />
          ) : null}

          {searchLoading ? (
            <div className="app-skills-hub-loading">
              <Spin size="small" />
            </div>
          ) : results.length > 0 ? (
            <div className="app-skills-hub-grid">
              {results.map((entry) => {
                const installed = installedNames.has(entry.skillId);
                const busy = busySkillId === entry.skillId;
                return (
                  <article key={entry.id} className="app-skills-hub-card">
                    <div className="app-skills-hub-card-name">{entry.name}</div>
                    <div className="app-skills-hub-card-meta">安装量约 {formatInstalls(entry.installs)}</div>
                    <div className="app-skills-hub-card-source" title={entry.id}>
                      {entry.source} · {entry.skillId}
                    </div>
                    <div className="app-skills-hub-card-actions">
                      {installed ? (
                        <Button
                          size="small"
                          danger
                          loading={busy}
                          disabled={!canInstallOrRemove || busy}
                          onClick={() => void handleUninstall(entry)}
                        >
                          卸载
                        </Button>
                      ) : (
                        <Button
                          type="primary"
                          size="small"
                          loading={busy}
                          disabled={!canInstallOrRemove || busy}
                          onClick={() => void handleInstall(entry)}
                        >
                          安装
                        </Button>
                      )}
                      <Typography.Link
                        className="app-skills-hub-card-link"
                        href={`https://skills.sh/${entry.source}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        目录
                        <LinkOutlined style={{ marginLeft: 4, fontSize: 10 }} />
                      </Typography.Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty className="app-skills-hub-empty" description={emptyHint} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </>
      ) : hubMode === "extension" ? (
        <ExtensionContributedSkills
          skills={extSkills}
          loading={extLoading}
          onRefresh={() => void refreshExtSkills()}
        />
      ) : (
        <ExternalBrowse
          paths={externalPaths}
          loading={externalLoading}
          selectedPath={selectedExternalPath}
          onSelectPath={setSelectedExternalPath}
          onRemovePath={handleRemoveExternalPath}
          scanned={scannedSkills}
          scanLoading={scanLoading}
          importBusy={importBusy}
          onImport={handleImport}
          onDeleteImported={handleDeleteImported}
        />
      )}
    </div>
  );

  if (embeddedInAuthor) {
    return (
      <AuthorPanelPageShell
        icon={<ToolOutlined />}
        title="技能市场"
        subtitle="skills.sh、外部目录和扩展技能"
      >
        {hubInner}
      </AuthorPanelPageShell>
    );
  }

  return hubInner;
}

interface ExtensionContributedSkillsProps {
  skills: ResolvedSkill[];
  loading: boolean;
  onRefresh: () => void;
}

function ExtensionContributedSkills({ skills, loading, onRefresh }: ExtensionContributedSkillsProps) {
  return (
    <div className="app-skills-hub-extension">
      <Alert
        type="info"
        showIcon
        className="app-skills-hub-alert app-skills-hub-alert--compact"
        message={
          <span className="app-skills-hub-alert-inline">
            <Typography.Text strong>来自扩展</Typography.Text>
            <Typography.Text type="secondary">
              {" "}
              这些技能由已启用的扩展贡献，只读；移除扩展会同时移除这些技能。
            </Typography.Text>
            <Button size="small" type="link" onClick={onRefresh} style={{ marginLeft: 8 }}>
              刷新
            </Button>
          </span>
        }
      />
      {loading ? (
        <div className="app-skills-hub-loading">
          <Spin size="small" />
        </div>
      ) : skills.length === 0 ? (
        <Empty
          className="app-skills-hub-empty"
          description="暂无扩展贡献的技能。安装一个声明 contributes.skills 的扩展即可在此显示。"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="app-skills-hub-grid">
          {skills.map((s) => (
            <article key={s.id} className="app-skills-hub-card">
              <div className="app-skills-hub-card-name">
                {s.name}
                <Tag color="purple" style={{ marginLeft: 8 }}>扩展贡献</Tag>
              </div>
              <div className="app-skills-hub-card-source" title={s.location}>
                来自扩展 {s.extension}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ant-color-text-secondary)",
                  marginTop: 6,
                }}
              >
                {s.description || "—"}
              </div>
              <div
                style={{
                  fontFamily: "var(--ant-font-family-code, monospace)",
                  fontSize: 11,
                  color: "var(--ant-color-text-tertiary)",
                  marginTop: 4,
                  wordBreak: "break-all",
                }}
              >
                {s.location}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

interface ExternalBrowseProps {
  paths: DetectedExternalPath[];
  loading: boolean;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  onRemovePath: (id: string) => void;
  scanned: ScannedSkill[];
  scanLoading: boolean;
  importBusy: string | null;
  onImport: (skill: ScannedSkill, mode: "copy" | "symlink") => void;
  onDeleteImported: (skill: ScannedSkill) => void;
}

function ExternalBrowse({
  paths,
  loading,
  selectedPath,
  onSelectPath,
  onRemovePath,
  scanned,
  scanLoading,
  importBusy,
  onImport,
  onDeleteImported,
}: ExternalBrowseProps) {
  return (
    <div className="app-skills-hub-external">
      <Alert
        type="info"
        showIcon
        className="app-skills-hub-alert app-skills-hub-alert--compact"
        message={
          <span className="app-skills-hub-alert-inline">
            <Typography.Text strong>浏览外部 skills 目录</Typography.Text>
            <Typography.Text type="secondary">
              {" "}
              扫描 ~/.claude/skills、~/.codex/skills 等已知目录或自定义路径；
              「复制」会写入 <Typography.Text code>~/.wise/skills/</Typography.Text>，
              「链接」创建符号链接（仅 macOS / Linux）。
            </Typography.Text>
          </span>
        }
      />
      {loading ? (
        <div className="app-skills-hub-loading">
          <Spin size="small" />
        </div>
      ) : (
        <ul className="app-skills-hub-external-list">
          {paths.map((p) => {
            const active = selectedPath === p.path;
            return (
              <li
                key={`${p.id ?? "default"}-${p.path}`}
                className={`app-skills-hub-external-row${active ? " app-skills-hub-external-row--active" : ""}`}
              >
                <button
                  type="button"
                  className="app-skills-hub-external-pick"
                  disabled={!p.exists}
                  onClick={() => onSelectPath(active ? null : p.path)}
                >
                  <FolderOpenOutlined style={{ marginRight: 6 }} />
                  <span className="app-skills-hub-external-path" title={p.path}>
                    {p.path}
                  </span>
                  <Tag color={p.exists ? "processing" : "default"} style={{ marginLeft: "auto" }}>
                    {p.exists ? `${p.count} 个技能` : "目录暂不存在"}
                  </Tag>
                  {p.isDefault ? <Tag>默认</Tag> : null}
                </button>
                {p.id ? (
                  <Button size="small" type="text" danger onClick={() => onRemovePath(p.id!)}>
                    删除
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {selectedPath ? (
        <div className="app-skills-hub-external-skills">
          <Typography.Text type="secondary" className="app-skills-hub-external-section-label">
            {selectedPath}
          </Typography.Text>
          {scanLoading ? (
            <div className="app-skills-hub-loading">
              <Spin size="small" />
            </div>
          ) : scanned.length === 0 ? (
            <Empty
              className="app-skills-hub-empty"
              description="该路径下没有可识别的 skill 目录"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <div className="app-skills-hub-grid">
              {scanned.map((s) => {
                const busy = importBusy === s.location;
                return (
                  <article key={s.location} className="app-skills-hub-card">
                    <div className="app-skills-hub-card-name">
                      {s.name} {s.isSymlink ? <Tag color="blue">软链接</Tag> : null}
                    </div>
                    <div className="app-skills-hub-card-source" title={s.location}>
                      {s.location}
                    </div>
                    <div className="app-skills-hub-card-actions">
                      <Button
                        type="primary"
                        size="small"
                        loading={busy}
                        disabled={busy || !s.hasSkillMd}
                        onClick={() => onImport(s, "copy")}
                      >
                        复制
                      </Button>
                      <Button size="small" loading={busy} disabled={busy || !s.hasSkillMd} onClick={() => onImport(s, "symlink")}>
                        链接
                      </Button>
                      <Button size="small" type="text" danger loading={busy} onClick={() => onDeleteImported(s)}>
                        从 wise 移除
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
