import {
  CodeOutlined,
  DiffOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  FileWordOutlined,
  HistoryOutlined,
  Html5Outlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Empty, Input, Select, Spin, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Repository } from "../../types";
import { listRepositoryExplorerEntries, searchRepositoryFiles } from "../../services/repositoryFiles";
import {
  hydrateCockpitConversations,
  listCockpitConversationsForRepository,
  useCockpitConversations,
} from "../../services/cockpitConversationStore";
import { formatCockpitRunStatusLabel } from "../../utils/cockpitConversation";
import { openWorkspaceRequirementExecutionSession } from "../../stores/workspaceMemoPanelStore";
import {
  isDocxFilePath,
  isImageFilePath,
  isLegacyDocFilePath,
  isPdfFilePath,
  isRepositoryBinaryPreviewPath,
  isRepositoryExternalDefaultAppPath,
  shouldOpenRepositoryFileInMonaco,
} from "../../utils/repositoryFilePreview";
import {
  AuthorPanelEmptyShell,
  AuthorPanelHubTab,
  AuthorPanelHubTabs,
  AuthorPanelListShell,
  AuthorPanelPageShell,
} from "../AuthorPanel/AuthorPanelPageShell";
import { HubItem, HubItems, HubTag } from "../HubCard";
import "./index.css";

interface ArtifactsPanelProps {
  repositories: Repository[];
  activeRepositoryId: number | null;
  onOpenRepositoryFile: (repository: Repository, relativePath: string) => void;
}

interface PreviewLane {
  key: PreviewLaneKey;
  title: string;
  icon: ReactNode;
}

type PreviewLaneKey = "all" | "markdown" | "diff" | "image" | "pdf" | "office" | "html" | "code" | "runs";

interface ArtifactFile {
  path: string;
  kind: string;
  lane: PreviewLaneKey;
  tone: "success" | "primary" | "warning" | "default";
  icon: ReactNode;
}

const PREVIEW_LANES: PreviewLane[] = [
  { key: "all", title: "全部", icon: <EyeOutlined /> },
  { key: "markdown", title: "Markdown", icon: <FileMarkdownOutlined /> },
  { key: "diff", title: "Diff", icon: <DiffOutlined /> },
  { key: "image", title: "图片", icon: <FileImageOutlined /> },
  { key: "pdf", title: "PDF", icon: <FilePdfOutlined /> },
  { key: "office", title: "Office", icon: <FileWordOutlined /> },
  { key: "html", title: "画布 · 页面与方案", icon: <Html5Outlined /> },
  { key: "code", title: "代码文本", icon: <CodeOutlined /> },
  { key: "runs", title: "运行", icon: <HistoryOutlined /> },
];

function isPreviewablePath(path: string): boolean {
  return (
    isRepositoryBinaryPreviewPath(path) ||
    isRepositoryExternalDefaultAppPath(path) ||
    shouldOpenRepositoryFileInMonaco(path)
  );
}

function getPathExt(path: string): string {
  const fileName = path.split("/").pop()?.toLowerCase() ?? "";
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return "";
  }
  return fileName.slice(lastDot + 1);
}

function isMarkdownPath(path: string): boolean {
  return ["md", "markdown"].includes(getPathExt(path));
}

function isHtmlPath(path: string): boolean {
  return ["html", "htm", "svg"].includes(getPathExt(path));
}

function isDiffArtifactPath(path: string): boolean {
  return ["diff", "patch"].includes(getPathExt(path));
}

function artifactFor(path: string): ArtifactFile {
  if (isImageFilePath(path)) {
    return { path, kind: "图片", lane: "image", tone: "success", icon: <FileImageOutlined /> };
  }
  if (isPdfFilePath(path)) {
    return { path, kind: "PDF", lane: "pdf", tone: "warning", icon: <FilePdfOutlined /> };
  }
  if (isDocxFilePath(path)) {
    return { path, kind: "Word", lane: "office", tone: "default", icon: <FileWordOutlined /> };
  }
  if (isLegacyDocFilePath(path)) {
    return { path, kind: "系统打开", lane: "office", tone: "default", icon: <FileWordOutlined /> };
  }
  if (isMarkdownPath(path)) {
    return { path, kind: "Markdown", lane: "markdown", tone: "success", icon: <FileMarkdownOutlined /> };
  }
  if (isHtmlPath(path)) {
    return { path, kind: "画布", lane: "html", tone: "warning", icon: <Html5Outlined /> };
  }
  if (isDiffArtifactPath(path)) {
    return { path, kind: "Diff", lane: "diff", tone: "primary", icon: <DiffOutlined /> };
  }
  return { path, kind: "代码", lane: "code", tone: "primary", icon: <CodeOutlined /> };
}

function fileBaseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function ArtifactsPanel({ repositories, activeRepositoryId, onOpenRepositoryFile }: ArtifactsPanelProps) {
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<number | null>(activeRepositoryId);
  const [selectedLane, setSelectedLane] = useState<PreviewLaneKey>("all");
  const [query, setQuery] = useState("");
  const [matchedFiles, setMatchedFiles] = useState<string[]>([]);
  const [repositoryFiles, setRepositoryFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const conversations = useCockpitConversations();

  useEffect(() => {
    void hydrateCockpitConversations();
  }, []);

  useEffect(() => {
    if (activeRepositoryId != null) {
      setSelectedRepositoryId(activeRepositoryId);
    }
  }, [activeRepositoryId]);

  const selectedRepository = repositories.find((repository) => repository.id === selectedRepositoryId) ?? null;

  const refresh = useCallback(async () => {
    const repository = selectedRepository;
    const root = repository?.path?.trim() ?? "";
    if (!repository || !root) {
      setMatchedFiles([]);
      setRepositoryFiles([]);
      return;
    }
    setLoading(true);
    try {
      const [matched, entries] = await Promise.all([
        searchRepositoryFiles(root, query.trim().replace(/^\/+/, "")),
        listRepositoryExplorerEntries(root),
      ]);
      const previewable = entries.filter((entry) => !entry.isDir && isPreviewablePath(entry.path)).map((entry) => entry.path);
      setRepositoryFiles(previewable);
      setMatchedFiles(
        (query.trim()
          ? matched.filter((entry) => !entry.isDir).map((entry) => entry.path)
          : previewable
        ).filter(isPreviewablePath),
      );
    } finally {
      setLoading(false);
    }
  }, [query, selectedRepository]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 220);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const repositoryOptions = useMemo(
    () => repositories.map((repository) => ({ value: repository.id, label: repository.name || repository.path })),
    [repositories],
  );

  const repositoryArtifacts = useMemo(() => repositoryFiles.map(artifactFor), [repositoryFiles]);
  const matchedArtifacts = useMemo(() => matchedFiles.map(artifactFor), [matchedFiles]);

  const repositoryRuns = useMemo(
    () => listCockpitConversationsForRepository(selectedRepository?.path?.trim() ?? ""),
    [conversations.records, selectedRepository?.path],
  );

  const laneCounts = useMemo(() => {
    const counts = new Map<PreviewLaneKey, number>(PREVIEW_LANES.map((lane) => [lane.key, 0]));
    counts.set("all", repositoryArtifacts.length);
    for (const artifact of repositoryArtifacts) {
      counts.set(artifact.lane, (counts.get(artifact.lane) ?? 0) + 1);
      if (artifact.lane === "markdown") counts.set("html", (counts.get("html") ?? 0) + 1);
    }
    counts.set("runs", repositoryRuns.length);
    return counts;
  }, [repositoryArtifacts, repositoryRuns.length]);

  const visibleArtifacts = useMemo(() => {
    if (selectedLane === "runs") return [];
    const filtered = selectedLane === "all"
      ? matchedArtifacts
      : matchedArtifacts.filter((artifact) => artifact.lane === selectedLane || (selectedLane === "html" && artifact.lane === "markdown"));
    return [...filtered].sort((a, b) => a.path.localeCompare(b.path));
  }, [matchedArtifacts, selectedLane]);

  const visibleRuns = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repositoryRuns;
    return repositoryRuns.filter((run) =>
      [run.title, run.assistantName, run.promptPreview, ...run.artifactPaths].join(" ").toLowerCase().includes(q),
    );
  }, [query, repositoryRuns]);

  const activeLane = PREVIEW_LANES.find((lane) => lane.key === selectedLane) ?? PREVIEW_LANES[0];
  const showingRuns = selectedLane === "runs";

  const emptyDescription = !selectedRepository
    ? "请先在右上角选择仓库"
    : showingRuns
      ? visibleRuns.length === 0 && query.trim()
        ? `没有匹配「${query.trim()}」的运行`
        : "还没有挂到该仓库的助手运行。从助手 Hub 发送需求后，完成后的改动会出现在这里。"
    : query.trim()
      ? `没有匹配「${query.trim()}」的可打开产物`
      : visibleArtifacts.length === 0 && repositoryArtifacts.length > 0
        ? `${activeLane.title} 分类下暂无产物，试试切换筛选`
        : "当前仓库暂无可预览的产物文件";

  const showEmpty = showingRuns
    ? !selectedRepository || visibleRuns.length === 0
    : !selectedRepository || visibleArtifacts.length === 0;

  return (
    <AuthorPanelPageShell
      className="app-artifacts-panel"
      icon={<FileSearchOutlined />}
      title="产物检查台"
      subtitle="浏览仓库可预览文件，或打开助手 Hub 派发后挂在运行上的产物"
      toolbarLayout="stacked"
      actions={
        <>
          <Select
            className="app-artifacts-panel__repo-select"
            size="small"
            placeholder="选择仓库"
            value={selectedRepositoryId ?? undefined}
            options={repositoryOptions}
            onChange={(value) => setSelectedRepositoryId(value)}
            showSearch
            optionFilterProp="label"
          />
          <Input
            className="app-artifacts-panel__search"
            size="small"
            allowClear
            prefix={<FileSearchOutlined />}
            placeholder="搜索文件名"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        </>
      }
      toolbar={
        <AuthorPanelHubTabs aria-label="产物类型筛选">
          {PREVIEW_LANES.map((lane) => (
            <AuthorPanelHubTab
              key={lane.key}
              active={selectedLane === lane.key}
              label={lane.title}
              count={laneCounts.get(lane.key) ?? 0}
              onClick={() => setSelectedLane(lane.key)}
            />
          ))}
        </AuthorPanelHubTabs>
      }
    >
      {selectedRepository && (showingRuns ? repositoryRuns.length > 0 : repositoryArtifacts.length > 0) ? (
        <div className="app-artifacts-panel__status" aria-live="polite">
          <span className="app-artifacts-panel__status-repo">{selectedRepository.name || selectedRepository.path}</span>
          <span>
            {activeLane.title} · {showingRuns ? visibleRuns.length : visibleArtifacts.length}
            {showingRuns
              ? ` / ${repositoryRuns.length} 次运行`
              : query.trim()
                ? ` / ${matchedArtifacts.length} 匹配`
                : ` / ${repositoryArtifacts.length} 可预览`}
          </span>
        </div>
      ) : null}

      {loading && visibleArtifacts.length === 0 && selectedRepository && !showingRuns ? (
        <div className="author-panel-page__loading">
          <Spin size="small" />
        </div>
      ) : showEmpty ? (
        <AuthorPanelEmptyShell>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
        </AuthorPanelEmptyShell>
      ) : showingRuns ? (
        <AuthorPanelListShell>
          <HubItems>
            {visibleRuns.map((run) => (
              <div key={run.id} className="app-artifacts-panel__run">
                <HubItem
                  avatarText={run.assistantName}
                  title={run.title}
                  path={`${formatCockpitRunStatusLabel(run.status)} · ${run.assistantName}`}
                  tags={<HubTag tone={run.status === "failed" ? "warning" : run.status === "running" ? "primary" : "success"}>{formatCockpitRunStatusLabel(run.status)}</HubTag>}
                  onClick={() => {
                    if (run.sessionId) openWorkspaceRequirementExecutionSession(run.sessionId);
                  }}
                />
                {run.artifactPaths.length > 0 ? (
                  <ul className="app-artifacts-panel__run-files">
                    {run.artifactPaths.map((path) => (
                      <li key={path}>
                        <button
                          type="button"
                          className="app-artifacts-panel__run-file"
                          onClick={() => {
                            if (!selectedRepository) return;
                            onOpenRepositoryFile(selectedRepository, path);
                          }}
                        >
                          {fileBaseName(path)}
                          <Typography.Text type="secondary"> {path}</Typography.Text>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Typography.Text type="secondary" className="app-artifacts-panel__run-empty">
                    运行结束后会挂上当时的仓库改动
                  </Typography.Text>
                )}
              </div>
            ))}
          </HubItems>
        </AuthorPanelListShell>
      ) : (
        <AuthorPanelListShell>
          <HubItems>
            {visibleArtifacts.map((artifact) => {
              const name = fileBaseName(artifact.path);
              return (
                <HubItem
                  key={artifact.path}
                  avatarText={name}
                  title={name}
                  path={artifact.path}
                  tags={<HubTag tone={artifact.tone}>{artifact.kind}</HubTag>}
                  onClick={() => {
                    if (!selectedRepository) return;
                    onOpenRepositoryFile(selectedRepository, artifact.path);
                  }}
                />
              );
            })}
          </HubItems>
        </AuthorPanelListShell>
      )}
    </AuthorPanelPageShell>
  );
}
