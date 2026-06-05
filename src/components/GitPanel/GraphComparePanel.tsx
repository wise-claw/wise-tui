import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Spin, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { gitCompareCommits } from "../../services/git";
import type { GitCompareCommitsResponse } from "../../types";
import { GraphBlameModal } from "./GraphBlameModal";
import { getStatusColor, getStatusSymbol, splitNameAndExt, splitPath } from "./gitPanelUtils";
import type { GitPanelOpenFileOptions } from "./types";

const { Text } = Typography;

interface GraphComparePanelProps {
  repositoryPath: string;
  baseSha: string;
  headSha: string;
  onClose: () => void;
  onSwap?: () => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onSelectCommit?: (sha: string) => void;
}

export function GraphComparePanel({
  repositoryPath,
  baseSha,
  headSha,
  onClose,
  onSwap,
  onOpenFile,
  onSelectCommit,
}: GraphComparePanelProps) {
  const [compare, setCompare] = useState<GitCompareCommitsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blameTarget, setBlameTarget] = useState<{ path: string; revision: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCompare(null);
    void gitCompareCommits(repositoryPath, baseSha, headSha)
      .then((response) => {
        if (!cancelled) {
          setCompare(response);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseSha, headSha, repositoryPath]);

  const blameRevisionLabel = useMemo(() => {
    if (!blameTarget || !compare) {
      return blameTarget?.revision ?? "";
    }
    if (blameTarget.revision === compare.headSha) {
      return "目标";
    }
    if (blameTarget.revision === compare.baseSha) {
      return "基准";
    }
    return blameTarget.revision.slice(0, 7);
  }, [blameTarget, compare]);

  return (
    <div className="git-graph-detail git-graph-compare">
      <div className="git-graph-detail__header">
        <Text strong className="git-graph-detail__title">
          提交对比
        </Text>
        <div className="git-graph-detail__header-actions">
          {onSwap ? (
            <Button size="small" onClick={onSwap}>
              交换方向
            </Button>
          ) : null}
          <Button type="text" size="small" icon={<CloseOutlined />} aria-label="关闭" onClick={onClose} />
        </div>
      </div>

      {loading ? (
        <div className="git-graph-detail__loading">
          <Spin size="small" />
        </div>
      ) : error ? (
        <Empty description={error} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : compare ? (
        <div className="git-graph-detail__body">
          <div className="git-graph-compare__range">
            <div className="git-graph-compare__commit">
              <Text type="secondary" style={{ fontSize: 10 }}>基准</Text>
              <Text code style={{ fontSize: 10 }}>{compare.baseSha.slice(0, 7)}</Text>
              <Text style={{ fontSize: 11 }}>{compare.baseSummary || "无描述"}</Text>
            </div>
            <div className="git-graph-compare__arrow">→</div>
            <div className="git-graph-compare__commit">
              <Text type="secondary" style={{ fontSize: 10 }}>目标</Text>
              <Text code style={{ fontSize: 10 }}>{compare.headSha.slice(0, 7)}</Text>
              <Text style={{ fontSize: 11 }}>{compare.headSummary || "无描述"}</Text>
            </div>
          </div>
          <div className="git-graph-detail__files">
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>
              差异文件 ({compare.files.length})
            </Text>
            <div className="git-graph-detail__file-list">
              {compare.files.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 11 }}>无文件差异</Text>
              ) : (
                compare.files.map((file) => (
                  <CompareFileRow
                    key={file.path}
                    file={file}
                    baseSha={compare.baseSha}
                    headSha={compare.headSha}
                    onOpenFile={onOpenFile}
                    onBlameHead={() => setBlameTarget({ path: file.path, revision: compare.headSha })}
                    onBlameBase={() => setBlameTarget({ path: file.path, revision: compare.baseSha })}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
      <GraphBlameModal
        open={blameTarget !== null}
        repositoryPath={repositoryPath}
        revision={blameTarget?.revision ?? ""}
        filePath={blameTarget?.path ?? ""}
        revisionLabel={blameRevisionLabel}
        onClose={() => setBlameTarget(null)}
        onSelectCommit={onSelectCommit}
      />
    </div>
  );
}

function CompareFileRow({
  file,
  baseSha,
  headSha,
  onOpenFile,
  onBlameHead,
  onBlameBase,
}: {
  file: GitCompareCommitsResponse["files"][number];
  baseSha: string;
  headSha: string;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onBlameHead: () => void;
  onBlameBase: () => void;
}) {
  const { name } = splitPath(file.path);
  const { base, ext } = splitNameAndExt(name);
  const clickable = Boolean(onOpenFile);
  const canBlameHead = file.status !== "D";
  const canBlameBase = file.status !== "A";

  return (
    <div className="git-graph-detail__file-row-wrap">
      <button
        type="button"
        className={`git-graph-detail__file-row${clickable ? " git-graph-detail__file-row--clickable" : ""}`}
        disabled={!clickable}
        onClick={() => {
          if (!onOpenFile) {
            return;
          }
          onOpenFile(file.path, { fromCommitCompare: { baseSha, headSha } });
        }}
      >
        <span className="git-file-status-badge" style={{ color: getStatusColor(file.status) }}>
          {getStatusSymbol(file.status)}
        </span>
        <span className="git-graph-detail__file-name">
          {base}
          {ext ? <span className="git-file-ext">.{ext}</span> : null}
        </span>
        {(file.additions > 0 || file.deletions > 0) ? (
          <span className="git-graph-detail__file-stats">
            {file.additions > 0 ? <span className="git-file-stat-add">+{file.additions}</span> : null}
            {file.deletions > 0 ? <span className="git-file-stat-del">-{file.deletions}</span> : null}
          </span>
        ) : null}
      </button>
      {canBlameHead ? (
        <Button type="link" size="small" className="git-graph-detail__blame-btn" onClick={onBlameHead}>
          Blame
        </Button>
      ) : null}
      {canBlameBase ? (
        <Button type="link" size="small" className="git-graph-detail__blame-btn" onClick={onBlameBase}>
          基准
        </Button>
      ) : null}
    </div>
  );
}
