import {
  CodeOutlined,
  DiffOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  FileWordOutlined,
  Html5Outlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Empty, Input, Select, Spin } from "antd";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Repository } from "../../types";
import { listRepositoryExplorerEntries, searchRepositoryFiles } from "../../services/repositoryFiles";
import {
  isDocxFilePath,
  isImageFilePath,
  isLegacyDocFilePath,
  isMonacoSupportedFilePath,
  isPdfFilePath,
  isRepositoryBinaryPreviewPath,
} from "../../utils/repositoryFilePreview";
import { HubDot, HubTag } from "../HubCard";
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

type PreviewLaneKey = "all" | "markdown" | "diff" | "image" | "pdf" | "office" | "html" | "code";

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
  { key: "html", title: "HTML", icon: <Html5Outlined /> },
  { key: "code", title: "代码文本", icon: <CodeOutlined /> },
];

function isPreviewablePath(path: string): boolean {
  return isRepositoryBinaryPreviewPath(path) || isMonacoSupportedFilePath(path);
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
    return { path, kind: "HTML", lane: "html", tone: "warning", icon: <Html5Outlined /> };
  }
  if (isDiffArtifactPath(path)) {
    return { path, kind: "Diff", lane: "diff", tone: "primary", icon: <DiffOutlined /> };
  }
  return { path, kind: "代码", lane: "code", tone: "primary", icon: <CodeOutlined /> };
}

export function ArtifactsPanel({ repositories, activeRepositoryId, onOpenRepositoryFile }: ArtifactsPanelProps) {
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<number | null>(activeRepositoryId);
  const [selectedLane, setSelectedLane] = useState<PreviewLaneKey>("all");
  const [query, setQuery] = useState("");
  const [matchedFiles, setMatchedFiles] = useState<string[]>([]);
  const [repositoryFiles, setRepositoryFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

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
        searchRepositoryFiles(root, query.trim()),
        listRepositoryExplorerEntries(root),
      ]);
      const previewable = entries.filter((entry) => !entry.isDir && isPreviewablePath(entry.path)).map((entry) => entry.path);
      setRepositoryFiles(previewable);
      setMatchedFiles((query.trim() ? matched : previewable).filter(isPreviewablePath));
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

  const laneCounts = useMemo(() => {
    const counts = new Map<PreviewLaneKey, number>(PREVIEW_LANES.map((lane) => [lane.key, 0]));
    counts.set("all", repositoryArtifacts.length);
    for (const artifact of repositoryArtifacts) {
      counts.set(artifact.lane, (counts.get(artifact.lane) ?? 0) + 1);
    }
    return counts;
  }, [repositoryArtifacts]);

  const visibleArtifacts = useMemo(() => {
    const filtered = selectedLane === "all"
      ? matchedArtifacts
      : matchedArtifacts.filter((artifact) => artifact.lane === selectedLane);
    return [...filtered].sort((a, b) => a.path.localeCompare(b.path));
  }, [matchedArtifacts, selectedLane]);

  const activeLane = PREVIEW_LANES.find((lane) => lane.key === selectedLane) ?? PREVIEW_LANES[0];

  return (
    <section className="app-artifacts-panel" aria-label="产物检查台">
      <div className="app-artifacts-panel__toolbar">
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
      </div>

      <div className="app-artifacts-panel__lanes">
        {PREVIEW_LANES.map((lane) => (
          <button
            key={lane.key}
            type="button"
            className={`app-artifacts-lane app-artifacts-lane--chip${selectedLane === lane.key ? " app-artifacts-lane--selected" : ""}`}
            onClick={() => setSelectedLane(lane.key)}
          >
            <span className="app-artifacts-lane__icon" aria-hidden>
              {lane.icon}
            </span>
            <span>{lane.title}</span>
            <strong>{laneCounts.get(lane.key) ?? 0}</strong>
          </button>
        ))}
      </div>

      <div className="app-artifacts-panel__body">
        <div className="app-artifacts-panel__body-head">
          <span>
            <HubDot tone={visibleArtifacts.length > 0 ? "on" : "off"} />
            {activeLane.title} · {visibleArtifacts.length} 个结果
          </span>
        </div>
        {loading && visibleArtifacts.length === 0 ? (
          <div className="app-artifacts-panel__loading">
            <Spin size="small" />
          </div>
        ) : !selectedRepository ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择仓库" />
        ) : visibleArtifacts.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配的可打开产物" />
        ) : (
          <div className="app-artifacts-file-list">
            {visibleArtifacts.map((artifact) => (
              <button
                key={artifact.path}
                type="button"
                className="app-artifacts-file-row"
                onClick={() => onOpenRepositoryFile(selectedRepository, artifact.path)}
              >
                <span className="app-artifacts-file-row__icon" aria-hidden>
                  {artifact.icon}
                </span>
                <span className="app-artifacts-file-row__main">
                  <strong>{artifact.path.split("/").pop() ?? artifact.path}</strong>
                  <small>{artifact.path}</small>
                </span>
                <span className="app-artifacts-file-row__meta">
                  <HubTag tone={artifact.tone}>{artifact.kind}</HubTag>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
