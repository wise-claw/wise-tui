import { Fragment, useEffect, useMemo, useState } from "react";
import { Collapse, Empty, Modal, Segmented, Spin, Typography } from "antd";
import { gitBlameFile } from "../../services/git";
import type { GitBlameFileResponse } from "../../types";
import { groupBlameLinesByCommit } from "./graphBlameGroups";
import { formatCommitDate } from "./gitPanelUtils";

const { Text } = Typography;

type BlameViewMode = "lines" | "groups";

interface GraphBlameModalProps {
  open: boolean;
  repositoryPath: string;
  revision: string;
  filePath: string;
  revisionLabel?: string;
  onClose: () => void;
  onSelectCommit?: (sha: string) => void;
}

function BlameLineRow({
  entry,
  expandedLine,
  onToggleLine,
  onSelectCommit,
  onClose,
}: {
  entry: GitBlameFileResponse["lines"][number];
  expandedLine: number | null;
  onToggleLine: (line: number) => void;
  onSelectCommit?: (sha: string) => void;
  onClose: () => void;
}) {
  const expanded = expandedLine === entry.line;

  return (
    <Fragment>
      <tr
        className={`git-graph-blame__row${expanded ? " git-graph-blame__row--expanded" : ""}`}
        onClick={() => onToggleLine(entry.line)}
      >
        <td className="git-graph-blame__line">{entry.line}</td>
        <td className="git-graph-blame__sha">
          {onSelectCommit ? (
            <button
              type="button"
              className="git-graph-blame__sha-btn"
              title={`查看提交 ${entry.sha.slice(0, 7)}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectCommit(entry.sha);
                onClose();
              }}
            >
              {entry.sha.slice(0, 7)}
            </button>
          ) : (
            entry.sha.slice(0, 7)
          )}
        </td>
        <td className="git-graph-blame__author">{entry.author}</td>
        <td className="git-graph-blame__summary" title={formatCommitDate(entry.timestamp)}>
          {entry.summary || "无描述"}
        </td>
        <td className="git-graph-blame__content" title={entry.content}>
          {entry.content || " "}
        </td>
      </tr>
      {expanded ? (
        <tr className="git-graph-blame__expand-row">
          <td colSpan={5}>
            <pre className="git-graph-blame__expand-pre">{entry.content || "（空行）"}</pre>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

export function GraphBlameModal({
  open,
  repositoryPath,
  revision,
  filePath,
  revisionLabel,
  onClose,
  onSelectCommit,
}: GraphBlameModalProps) {
  const [blame, setBlame] = useState<GitBlameFileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<BlameViewMode>("lines");

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBlame(null);
    setExpandedLine(null);
    setViewMode("lines");
    void gitBlameFile(repositoryPath, revision, filePath)
      .then((response) => {
        if (!cancelled) {
          setBlame(response);
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
  }, [filePath, open, repositoryPath, revision]);

  const blameGroups = useMemo(
    () => (blame ? groupBlameLinesByCommit(blame.lines) : []),
    [blame],
  );

  const toggleLine = (line: number) => {
    setExpandedLine((current) => (current === line ? null : line));
  };

  return (
    <Modal
      title={`Blame · ${filePath}`}
      open={open}
      footer={null}
      width={780}
      destroyOnHidden
      onCancel={onClose}
    >
      {loading ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <Spin size="small" />
        </div>
      ) : error ? (
        <Empty description={error} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : blame ? (
        <div className="git-graph-blame">
          <div className="git-graph-blame__toolbar">
            <Text type="secondary" style={{ fontSize: 11 }}>
              {revisionLabel ?? revision} ({blame.revisionSha.slice(0, 7)}) · {blame.lines.length} 行
              {blame.lines.length >= 800 ? "（已截断）" : ""}
            </Text>
            <Segmented
              size="small"
              value={viewMode}
              options={[
                { label: "逐行", value: "lines" },
                { label: "按提交", value: "groups" },
              ]}
              onChange={(value) => setViewMode(value as BlameViewMode)}
            />
          </div>
          {viewMode === "lines" ? (
            <div className="git-graph-blame__scroll">
              <table className="git-graph-blame__table">
                <thead>
                  <tr>
                    <th>行</th>
                    <th>提交</th>
                    <th>作者</th>
                    <th>说明</th>
                    <th>内容</th>
                  </tr>
                </thead>
                <tbody>
                  {blame.lines.map((entry) => (
                    <BlameLineRow
                      key={`${entry.line}-${entry.sha}`}
                      entry={entry}
                      expandedLine={expandedLine}
                      onToggleLine={toggleLine}
                      onSelectCommit={onSelectCommit}
                      onClose={onClose}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="git-graph-blame__scroll git-graph-blame__groups">
              <Collapse
                size="small"
                defaultActiveKey={blameGroups.slice(0, 3).map((group) => group.sha)}
                items={blameGroups.map((group) => ({
                  key: group.sha,
                  label: (
                    <div className="git-graph-blame__group-label">
                      {onSelectCommit ? (
                        <button
                          type="button"
                          className="git-graph-blame__sha-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectCommit(group.sha);
                            onClose();
                          }}
                        >
                          {group.sha.slice(0, 7)}
                        </button>
                      ) : (
                        <span className="git-graph-blame__sha">{group.sha.slice(0, 7)}</span>
                      )}
                      <span className="git-graph-blame__author">{group.author}</span>
                      <span className="git-graph-blame__summary">{group.summary || "无描述"}</span>
                      <span className="git-graph-blame__group-count">{group.lines.length} 行</span>
                    </div>
                  ),
                  children: (
                    <table className="git-graph-blame__table git-graph-blame__table--nested">
                      <tbody>
                        {group.lines.map((entry) => (
                          <BlameLineRow
                            key={`${group.sha}-${entry.line}`}
                            entry={entry}
                            expandedLine={expandedLine}
                            onToggleLine={toggleLine}
                            onSelectCommit={onSelectCommit}
                            onClose={onClose}
                          />
                        ))}
                      </tbody>
                    </table>
                  ),
                }))}
              />
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
