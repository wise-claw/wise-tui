import {
  CloseOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { App, Alert, Button, Empty, Input, Segmented, Space, Spin, Tag, Typography } from "antd";
import { HoverHint } from "../shared/HoverHint";
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

function getSkillMeta(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    { bg: "var(--ant-color-primary-bg)", border: "var(--ant-color-primary-border)", text: "var(--ant-color-primary)" }, // Theme Primary
    { bg: "#F6FFED", border: "#B7EB8F", text: "#389E0D" }, // Green
    { bg: "#FFF7E6", border: "#FFE7BA", text: "#D46B08" }, // Orange
    { bg: "#F9F0FF", border: "#D3ADF7", text: "#531DAB" }, // Purple
    { bg: "#FFF0F6", border: "#FFADD2", text: "#C41D7F" }, // Magenta
    { bg: "#E6FFFB", border: "#87E8DE", text: "#08979C" }, // Cyan
    { bg: "#FFF1F0", border: "#FFA39E", text: "#CF1322" }, // Red
  ];
  const idx = Math.abs(hash) % colors.length;
  return colors[idx];
}

const RECOMMENDED_SKILLS: SkillsShSkillEntry[] = [
  {
    id: "source-command-prd-task-splitter",
    skillId: "prd-task-splitter",
    name: "PRD 任务拆解器",
    installs: 12450,
    source: "official",
  },
  {
    id: "source-command-subject-multilingual-extractor",
    skillId: "subject-multilingual-extractor",
    name: "多语言主题提取器",
    installs: 8920,
    source: "official",
  },
  {
    id: "source-command-weather-query",
    skillId: "weather-query",
    name: "天气智能查询助手",
    installs: 6310,
    source: "official",
  },
  {
    id: "trellis-brainstorm",
    skillId: "trellis-brainstorm",
    name: "需求脑暴专家",
    installs: 23100,
    source: "trellis",
  },
  {
    id: "trellis-check",
    skillId: "trellis-check",
    name: "质量检查官",
    installs: 19400,
    source: "trellis",
  },
];

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

  const filteredExtSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return extSkills;
    return extSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q) ||
        s.extension.toLowerCase().includes(q)
    );
  }, [extSkills, query]);

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
        await fn(skill.location);
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
              <HoverHint title="关闭">
                <Button
                  type="text"
                  size="small"
                  className="app-skills-hub-close-btn"
                  icon={<CloseOutlined />}
                  aria-label="关闭"
                  onClick={onClose}
                />
              </HoverHint>
            ) : null}
          </div>
        ) : null}

        <div className="app-skills-hub-toolbar-top">
          <Segmented<HubMode>
            size="small"
            value={hubMode}
            onChange={(v) => setHubMode(v)}
            className="app-skills-hub-mode-segmented"
            options={[
              { label: `🌐 公开 (${debouncedQuery.length >= 2 ? results.length : installedNames.size})`, value: "registry" },
              { label: `💻 本地 (${externalSkillTotal})`, value: "external" },
              { label: `🔌 扩展 (${extSkills.length})`, value: "extension" },
            ]}
          />
          {hubMode !== "external" ? (
            <Segmented<SkillsInstallScope>
              size="small"
              value={installScope}
              onChange={(v) => setInstallScope(v)}
              className="app-skills-hub-scope-segmented"
              options={[
                { label: "项目", value: "project" },
                { label: "全局", value: "global" },
              ]}
            />
          ) : null}
        </div>

        <div className="app-skills-hub-toolbar-bottom">
          {hubMode === "registry" ? (
            <Space.Compact style={{ width: "100%" }}>
              <Input
                allowClear
                size="small"
                prefix={<SearchOutlined />}
                placeholder="搜索公开技能（至少 2 个字符）…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="app-skills-hub-search-input"
              />
              <HoverHint title="同步安装状态">
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={listLoading}
                  onClick={() => void loadInstalled()}
                  aria-label="同步安装状态"
                  className="app-skills-hub-refresh-btn"
                />
              </HoverHint>
            </Space.Compact>
          ) : hubMode === "external" ? (
            <Space.Compact style={{ width: "100%" }}>
              <Input
                allowClear
                size="small"
                prefix={<SearchOutlined />}
                placeholder="粘贴并添加新的外部技能路径…"
                value={newPathInput}
                onChange={(e) => setNewPathInput(e.target.value)}
                onPressEnter={() => void handleAddExternalPath()}
                className="app-skills-hub-search-input"
              />
              <Button
                size="small"
                type="primary"
                disabled={!newPathInput.trim()}
                onClick={() => void handleAddExternalPath()}
              >
                添加
              </Button>
              <HoverHint title="刷新外部目录">
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={externalLoading}
                  onClick={() => void refreshExternalPaths()}
                  aria-label="刷新外部目录"
                  className="app-skills-hub-refresh-btn"
                />
              </HoverHint>
            </Space.Compact>
          ) : (
            <Space.Compact style={{ width: "100%" }}>
              <Input
                allowClear
                size="small"
                prefix={<SearchOutlined />}
                placeholder="搜索已启用的扩展技能…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="app-skills-hub-search-input"
              />
              <HoverHint title="刷新扩展技能">
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={extLoading}
                  onClick={() => void refreshExtSkills()}
                  aria-label="刷新扩展技能"
                  className="app-skills-hub-refresh-btn"
                />
              </HoverHint>
            </Space.Compact>
          )}
        </div>
      </header>

      <div className="app-skills-hub-main">
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
                const meta = getSkillMeta(entry.name);
                return (
                  <article key={entry.id} className="app-skills-hub-card">
                    <div className="app-skills-hub-card-top-bar" style={{ background: `linear-gradient(90deg, ${meta.text} 0%, ${meta.border} 100%)` }} />
                    <div className="app-skills-hub-card-header">
                      <div className="app-skills-hub-card-avatar" style={{ backgroundColor: meta.bg, color: meta.text, borderColor: meta.border }}>
                        {entry.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="app-skills-hub-card-title-group">
                        <div className="app-skills-hub-card-name" title={entry.name}>{entry.name}</div>
                        <div className="app-skills-hub-card-source" title={entry.id}>
                          {entry.source} · {entry.skillId}
                        </div>
                      </div>
                    </div>
                    <div className="app-skills-hub-card-meta">
                      <span className="app-skills-hub-installs">
                        <DownloadOutlined style={{ fontSize: 11, marginRight: 4 }} />
                        安装量约 {formatInstalls(entry.installs)}
                      </span>
                    </div>
                    <div className="app-skills-hub-card-actions">
                      {installed ? (
                        <Button
                          size="small"
                          danger
                          loading={busy}
                          disabled={!canInstallOrRemove || busy}
                          onClick={() => void handleUninstall(entry)}
                          className="app-skills-hub-btn-uninstall"
                        >
                          卸载技能
                        </Button>
                      ) : (
                        <Button
                          type="primary"
                          size="small"
                          loading={busy}
                          disabled={!canInstallOrRemove || busy}
                          onClick={() => void handleInstall(entry)}
                          className="app-skills-hub-btn-install"
                        >
                          安装技能
                        </Button>
                      )}
                      <Typography.Link
                        className="app-skills-hub-card-link"
                        href={`https://skills.sh/${entry.source}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        文档
                        <LinkOutlined style={{ fontSize: 10 }} />
                      </Typography.Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : debouncedQuery.length >= 2 ? (
            <Empty className="app-skills-hub-empty" description={emptyHint} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <div className="app-skills-hub-recommendations">
              <div className="app-skills-hub-section-title">
                <span className="app-skills-hub-fire-icon">🔥</span> 热门推荐技能
              </div>
              <div className="app-skills-hub-grid">
                {RECOMMENDED_SKILLS.map((entry) => {
                  const installed = installedNames.has(entry.skillId);
                  const busy = busySkillId === entry.skillId;
                  const meta = getSkillMeta(entry.name);
                  return (
                    <article key={entry.id} className="app-skills-hub-card">
                      <div className="app-skills-hub-card-top-bar" style={{ background: `linear-gradient(90deg, ${meta.text} 0%, ${meta.border} 100%)` }} />
                      <div className="app-skills-hub-card-header">
                        <div className="app-skills-hub-card-avatar" style={{ backgroundColor: meta.bg, color: meta.text, borderColor: meta.border }}>
                          {entry.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="app-skills-hub-card-title-group">
                          <div className="app-skills-hub-card-name" title={entry.name}>{entry.name}</div>
                          <div className="app-skills-hub-card-source" title={entry.id}>
                            {entry.source} · {entry.skillId}
                          </div>
                        </div>
                      </div>
                      <div className="app-skills-hub-card-meta">
                        <span className="app-skills-hub-installs">
                          <DownloadOutlined style={{ fontSize: 11, marginRight: 4 }} />
                          载入量约 {formatInstalls(entry.installs)}
                        </span>
                      </div>
                      <div className="app-skills-hub-card-actions">
                        {installed ? (
                          <Button
                            size="small"
                            danger
                            loading={busy}
                            disabled={!canInstallOrRemove || busy}
                            onClick={() => void handleUninstall(entry)}
                            className="app-skills-hub-btn-uninstall"
                          >
                            卸载技能
                          </Button>
                        ) : (
                          <Button
                            type="primary"
                            size="small"
                            loading={busy}
                            disabled={!canInstallOrRemove || busy}
                            onClick={() => void handleInstall(entry)}
                            className="app-skills-hub-btn-install"
                          >
                            安装技能
                          </Button>
                        )}
                        <Typography.Link
                          className="app-skills-hub-card-link"
                          href={`https://skills.sh/${entry.source}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          文档
                          <LinkOutlined style={{ fontSize: 10 }} />
                        </Typography.Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : hubMode === "extension" ? (
        <ExtensionContributedSkills
          skills={filteredExtSkills}
          loading={extLoading}
          onRefresh={() => void refreshExtSkills()}
          searchQuery={query}
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
  searchQuery: string;
}

function ExtensionContributedSkills({ skills, loading, onRefresh, searchQuery }: ExtensionContributedSkillsProps) {
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
          description={searchQuery ? "未找到匹配的扩展技能" : "暂无扩展贡献的技能。安装一个声明 contributes.skills 的扩展即可在此显示。"}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="app-skills-hub-grid">
          {skills.map((s) => {
            const meta = getSkillMeta(s.name);
            return (
              <article key={s.id} className="app-skills-hub-card">
                <div className="app-skills-hub-card-top-bar" style={{ background: `linear-gradient(90deg, ${meta.text} 0%, ${meta.border} 100%)` }} />
                <div className="app-skills-hub-card-header">
                  <div className="app-skills-hub-card-avatar" style={{ backgroundColor: meta.bg, color: meta.text, borderColor: meta.border }}>
                    {s.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="app-skills-hub-card-title-group">
                    <div className="app-skills-hub-card-name" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {s.name}
                      <Tag color="purple" variant="filled" style={{ margin: 0, fontSize: 10 }}>扩展</Tag>
                    </div>
                    <div className="app-skills-hub-card-source" title={s.location}>
                      来自扩展 {s.extension}
                    </div>
                  </div>
                </div>
                <div className="app-skills-hub-card-desc">
                  {s.description || "暂无描述"}
                </div>
                <div className="app-skills-hub-card-path">
                  {s.location}
                </div>
              </article>
            );
          })}
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
                const meta = getSkillMeta(s.name);
                return (
                  <article key={s.location} className="app-skills-hub-card">
                    <div className="app-skills-hub-card-top-bar" style={{ background: `linear-gradient(90deg, ${meta.text} 0%, ${meta.border} 100%)` }} />
                    <div className="app-skills-hub-card-header">
                      <div className="app-skills-hub-card-avatar" style={{ backgroundColor: meta.bg, color: meta.text, borderColor: meta.border }}>
                        {s.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="app-skills-hub-card-title-group">
                        <div className="app-skills-hub-card-name" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {s.name}
                          {s.isSymlink ? <Tag color="blue" variant="filled" style={{ margin: 0, fontSize: 10 }}>链接</Tag> : null}
                        </div>
                        <div className="app-skills-hub-card-source" title={s.location}>
                          {s.location}
                        </div>
                      </div>
                    </div>
                    <div className="app-skills-hub-card-actions">
                      <Button
                        type="primary"
                        size="small"
                        loading={busy}
                        disabled={busy || !s.hasSkillMd}
                        onClick={() => onImport(s, "copy")}
                        className="app-skills-hub-btn-install"
                      >
                        复制技能
                      </Button>
                      <Button
                        size="small"
                        loading={busy}
                        disabled={busy || !s.hasSkillMd}
                        onClick={() => onImport(s, "symlink")}
                        className="app-skills-hub-btn-link"
                      >
                        软链技能
                      </Button>
                      <Button
                        size="small"
                        type="text"
                        danger
                        loading={busy}
                        onClick={() => onDeleteImported(s)}
                        className="app-skills-hub-btn-uninstall"
                      >
                        Wise 移除
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
