import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dropdown, Empty, Spin, Typography } from "antd";
import type { MenuProps } from "antd";
import { CloseOutlined, MoreOutlined } from "@ant-design/icons";
import { gitCommitDetail } from "../../services/git";
import type { GitCommitDetailResponse } from "../../types";
import { GraphBlameModal } from "./GraphBlameModal";
import { formatCommitDate, getStatusColor, getStatusSymbol, splitNameAndExt, splitPath } from "./gitPanelUtils";
import type { GitPanelOpenFileOptions } from "./types";

const { Text, Paragraph } = Typography;

interface GraphCommitDetailProps {
  repositoryPath: string;
  sha: string;
  onClose: () => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onCheckout?: (revision: string) => Promise<void>;
  onCherryPick?: () => void;
  onRevert?: () => void;
  onCreateBranch?: () => void;
  onCreateTag?: () => void;
  onReset?: () => void;
  onCompareWithHead?: () => void;
  onSetCompareBase?: () => void;
  onSelectCommit?: (sha: string) => void;
}

export function GraphCommitDetail({
  repositoryPath,
  sha,
  onClose,
  onOpenFile,
  onCheckout,
  onCherryPick,
  onRevert,
  onCreateBranch,
  onCreateTag,
  onReset,
  onCompareWithHead,
  onSetCompareBase,
  onSelectCommit,
}: GraphCommitDetailProps) {
  const [detail, setDetail] = useState<GitCommitDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [blameFilePath, setBlameFilePath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    void gitCommitDetail(repositoryPath, sha)
      .then((response) => {
        if (!cancelled) {
          setDetail(response);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);
          setError(message);
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
  }, [repositoryPath, sha]);

  const handleCheckout = useCallback(async () => {
    if (!onCheckout) {
      return;
    }
    setCheckingOut(true);
    try {
      await onCheckout(sha);
    } finally {
      setCheckingOut(false);
    }
  }, [onCheckout, sha]);

  const moreMenuItems = useMemo((): MenuProps["items"] => {
    const items: MenuProps["items"] = [];
    if (onCreateBranch) {
      items.push({ key: "branch", label: "创建分支", onClick: onCreateBranch });
    }
    if (onCreateTag) {
      items.push({ key: "tag", label: "创建标签", onClick: onCreateTag });
    }
    if (onCompareWithHead) {
      items.push({ key: "compare-head", label: "与 HEAD 对比", onClick: onCompareWithHead });
    }
    if (onSetCompareBase) {
      items.push({ key: "compare-base", label: "设为对比基准", onClick: onSetCompareBase });
    }
    if (onCherryPick) {
      items.push({ key: "cherry-pick", label: "Cherry-pick", onClick: onCherryPick });
    }
    if (onRevert) {
      items.push({ key: "revert", label: "Revert", danger: true, onClick: onRevert });
    }
    if (onReset) {
      items.push({ key: "reset", label: "Reset 到此提交", danger: true, onClick: onReset });
    }
    return items;
  }, [onCherryPick, onCompareWithHead, onCreateBranch, onCreateTag, onReset, onRevert, onSetCompareBase]);

  return (
    <div className="git-graph-detail">
      <div className="git-graph-detail__header">
        <Text strong className="git-graph-detail__title">
          提交详情
        </Text>
        <div className="git-graph-detail__header-actions">
          {onCheckout ? (
            <Button size="small" loading={checkingOut} onClick={() => void handleCheckout()}>
              检出
            </Button>
          ) : null}
          {moreMenuItems && moreMenuItems.length > 0 ? (
            <Dropdown
              menu={{ items: moreMenuItems, className: "git-graph-menu" }}
              classNames={{ root: "git-graph-menu-dropdown" }}
              trigger={["click"]}
            >
              <Button size="small" icon={<MoreOutlined />} aria-label="更多操作" />
            </Dropdown>
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
      ) : detail ? (
        <div className="git-graph-detail__body">
          <div className="git-graph-detail__summary">{detail.summary || "无描述"}</div>
          <div className="git-graph-detail__meta">
            <Text code style={{ fontSize: 10 }}>{detail.sha.slice(0, 7)}</Text>
            <Text type="secondary" style={{ fontSize: 10 }}>{detail.author}</Text>
            <Text type="secondary" style={{ fontSize: 10 }}>{formatCommitDate(detail.timestamp)}</Text>
          </div>
          {detail.body ? (
            <Paragraph className="git-graph-detail__message" ellipsis={{ rows: 4, expandable: true }}>
              {detail.body}
            </Paragraph>
          ) : null}
          <div className="git-graph-detail__files">
            <Text type="secondary" style={{ fontSize: 10, fontWeight: 600 }}>
              变更文件 ({detail.files.length})
            </Text>
            <div className="git-graph-detail__file-list">
              {detail.files.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 10 }}>无文件变更</Text>
              ) : (
                detail.files.map((file) => (
                  <CommitFileRow
                    key={file.path}
                    file={file}
                    onOpenFile={onOpenFile}
                    onBlame={() => setBlameFilePath(file.path)}
                    sha={detail.sha}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
      <GraphBlameModal
        open={blameFilePath !== null}
        repositoryPath={repositoryPath}
        revision={sha}
        filePath={blameFilePath ?? ""}
        onClose={() => setBlameFilePath(null)}
        onSelectCommit={onSelectCommit}
      />
    </div>
  );
}

function CommitFileRow({
  file,
  sha,
  onOpenFile,
  onBlame,
}: {
  file: GitCommitDetailResponse["files"][number];
  sha: string;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onBlame: () => void;
}) {
  const { name } = splitPath(file.path);
  const { base, ext } = splitNameAndExt(name);
  const clickable = Boolean(onOpenFile) && file.status !== "D";
  const canBlame = file.status !== "D";

  return (
    <div className="git-graph-detail__file-row-wrap">
      <button
        type="button"
        className={`git-graph-detail__file-row${clickable ? " git-graph-detail__file-row--clickable" : ""}`}
        disabled={!clickable}
        onClick={() => {
          if (!clickable || !onOpenFile) {
            return;
          }
          onOpenFile(file.path, { fromCommit: { sha } });
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
      {canBlame ? (
        <Button type="link" size="small" className="git-graph-detail__blame-btn" onClick={onBlame}>
          Blame
        </Button>
      ) : null}
    </div>
  );
}
