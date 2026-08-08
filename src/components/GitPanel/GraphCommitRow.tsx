import { memo, useCallback, useMemo, type CSSProperties, type MouseEvent, type Ref } from "react";
import { Dropdown, Tag } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import { message } from "antd";
import "@vscode/codicons/dist/codicon.css";
import type { GitGraphCommit } from "../../types";
import { buildGraphCommitMenuItems } from "./graphCommitMenu";
import { formatGitGraphDate } from "./gitPanelUtils";
import { gitGraphRefColor } from "./gitGraphLayout";

export interface GraphCommitRowProps {
  commit: GitGraphCommit;
  laneColor: string;
  rowHeight: number;
  rowIndex: number;
  virtualized?: boolean;
  virtualTop?: number;
  selected: boolean;
  rowRef?: Ref<HTMLDivElement | null>;
  canCompareWithBase: boolean;
  canCompareWithHead: boolean;
  onSelectCommit: (sha: string) => void;
  onCheckout: (revision: string) => void;
  onCherryPick: (sha: string) => void;
  onRevert: (sha: string) => void;
  onCreateBranch: (sha: string) => void;
  onCreateTag: (sha: string) => void;
  onReset: (sha: string) => void;
  onSetCompareBase: (sha: string) => void;
  onCompareWithBase: (sha: string) => void;
  onCompareWithHead: (sha: string) => void;
  onDeleteTag: (tagName: string) => void;
  onCopySha: (sha: string) => void;
}

function refsSignature(refs: GitGraphCommit["refs"]): string {
  return refs.map((ref) => `${ref.kind}:${ref.name}:${ref.isHead ? 1 : 0}`).join("|");
}

function graphCommitRowEqual(left: GraphCommitRowProps, right: GraphCommitRowProps): boolean {
  return (
    left.selected === right.selected
    && left.laneColor === right.laneColor
    && left.virtualTop === right.virtualTop
    && left.virtualized === right.virtualized
    && left.rowHeight === right.rowHeight
    && left.rowIndex === right.rowIndex
    && left.canCompareWithBase === right.canCompareWithBase
    && left.canCompareWithHead === right.canCompareWithHead
    && left.commit.sha === right.commit.sha
    && left.commit.summary === right.commit.summary
    && left.commit.author === right.commit.author
    && left.commit.timestamp === right.commit.timestamp
    && left.commit.parentShas.length === right.commit.parentShas.length
    && refsSignature(left.commit.refs) === refsSignature(right.commit.refs)
    && left.onSelectCommit === right.onSelectCommit
    && left.onCheckout === right.onCheckout
    && left.onCherryPick === right.onCherryPick
    && left.onRevert === right.onRevert
    && left.onCreateBranch === right.onCreateBranch
    && left.onCreateTag === right.onCreateTag
    && left.onReset === right.onReset
    && left.onSetCompareBase === right.onSetCompareBase
    && left.onCompareWithBase === right.onCompareWithBase
    && left.onCompareWithHead === right.onCompareWithHead
    && left.onDeleteTag === right.onDeleteTag
    && left.onCopySha === right.onCopySha
    && left.rowRef === right.rowRef
  );
}

function refIconClass(ref: GitGraphCommit["refs"][number]): string {
  if (ref.isHead) {
    return "codicon codicon-git-commit";
  }
  if (ref.kind === "tag") {
    return "codicon codicon-tag";
  }
  return "codicon codicon-git-branch";
}

function GraphCommitRowInner({
  commit,
  laneColor,
  rowHeight,
  rowIndex,
  virtualized,
  virtualTop,
  selected,
  rowRef,
  canCompareWithBase,
  canCompareWithHead,
  onSelectCommit,
  onCheckout,
  onCherryPick,
  onRevert,
  onCreateBranch,
  onCreateTag,
  onReset,
  onSetCompareBase,
  onCompareWithBase,
  onCompareWithHead,
  onDeleteTag,
  onCopySha,
}: GraphCommitRowProps) {
  const handleSelect = useCallback(() => {
    onSelectCommit(commit.sha);
  }, [commit.sha, onSelectCommit]);

  const handleOpenDetail = useCallback(() => {
    onSelectCommit(commit.sha);
  }, [commit.sha, onSelectCommit]);

  const handleRefClick = useCallback(
    (event: MouseEvent, ref: GitGraphCommit["refs"][number]) => {
      event.stopPropagation();
      if (ref.isHead) {
        return;
      }
      if (ref.kind === "remote") {
        message.info("请先在本地创建跟踪分支后再检出");
        return;
      }
      void onCheckout(ref.name);
    },
    [onCheckout],
  );

  const menuItems = useMemo(
    () =>
      buildGraphCommitMenuItems(
        commit,
        {
          onSelect: handleSelect,
          onCheckout,
          onCherryPick: () => onCherryPick(commit.sha),
          onRevert: () => onRevert(commit.sha),
          onCreateBranch: () => onCreateBranch(commit.sha),
          onCreateTag: () => onCreateTag(commit.sha),
          onReset: () => onReset(commit.sha),
          onSetCompareBase: () => onSetCompareBase(commit.sha),
          onCompareWithBase: () => onCompareWithBase(commit.sha),
          onCompareWithHead: () => onCompareWithHead(commit.sha),
          onDeleteTag,
          onCopySha: () => onCopySha(commit.sha),
        },
        { canCompareWithBase, canCompareWithHead },
      ),
    [
      canCompareWithBase,
      canCompareWithHead,
      commit,
      handleSelect,
      onCherryPick,
      onCheckout,
      onCompareWithBase,
      onCompareWithHead,
      onCopySha,
      onCreateBranch,
      onCreateTag,
      onDeleteTag,
      onReset,
      onRevert,
      onSetCompareBase,
    ],
  );

  const isMerge = commit.parentShas.length > 1;
  const dateLabel = formatGitGraphDate(commit.timestamp);
  const shortSha = commit.sha.slice(0, 8);
  const zebra = rowIndex % 2 === 1;

  const rowStyle: CSSProperties = {
    height: rowHeight,
    minHeight: rowHeight,
    maxHeight: rowHeight,
    overflow: "hidden",
    ...(virtualized && virtualTop !== undefined ? { top: virtualTop } : null),
  };

  return (
    <Dropdown
      menu={{ items: menuItems, className: "git-graph-menu" }}
      classNames={{ root: "git-graph-menu-dropdown" }}
      trigger={["contextMenu"]}
    >
      <div
        ref={rowRef}
        className={[
          "git-graph-row",
          selected ? "git-graph-row--selected" : "",
          zebra ? "git-graph-row--zebra" : "",
          isMerge ? "git-graph-row--merge" : "",
          virtualized ? "git-graph-row--virtualized" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={rowStyle}
        onClick={handleSelect}
        onDoubleClick={(event) => {
          event.preventDefault();
          handleOpenDetail();
        }}
        role="button"
        aria-selected={selected}
      >
        <div className="git-graph-row__description">
          {commit.refs.length > 0 ? (
            <div className="git-graph-row__refs">
              {commit.refs.map((ref) => {
                const clickable = !ref.isHead && ref.kind !== "remote";
                const refColor = ref.isHead
                  ? undefined
                  : ref.kind === "tag"
                    ? gitGraphRefColor(ref.name)
                    : laneColor;
                return (
                  <Tag
                    key={`${ref.kind}:${ref.name}`}
                    className={`git-graph-ref-tag${clickable ? " git-graph-ref-tag--clickable" : ""}${ref.isHead ? " git-graph-ref-tag--head" : ""}`}
                    style={
                      refColor
                        ? ({ "--git-graph-ref-color": refColor } as CSSProperties)
                        : undefined
                    }
                    title={clickable ? `检出 ${ref.name}` : ref.name}
                    onClick={clickable ? (event) => handleRefClick(event, ref) : undefined}
                  >
                    <span className={refIconClass(ref)} aria-hidden />
                    <span className="git-graph-ref-tag__label">{ref.isHead ? "HEAD" : ref.name}</span>
                  </Tag>
                );
              })}
            </div>
          ) : null}
          <div className="git-graph-row__summary" title={commit.summary || "无描述"}>
            {commit.summary || "无描述"}
          </div>
        </div>
        <div className="git-graph-row__date" title={dateLabel}>
          {dateLabel}
        </div>
        <div className="git-graph-row__author" title={commit.author || "未知"}>
          {commit.author || "未知"}
        </div>
        <div className="git-graph-row__sha" title={commit.sha}>
          {shortSha}
        </div>
        <Dropdown
          menu={{ items: menuItems, className: "git-graph-menu" }}
          classNames={{ root: "git-graph-menu-dropdown" }}
          trigger={["click"]}
        >
          <button
            type="button"
            className="git-graph-row__menu"
            aria-label="提交操作"
            onClick={(event) => event.stopPropagation()}
          >
            <MoreOutlined />
          </button>
        </Dropdown>
      </div>
    </Dropdown>
  );
}

export const GraphCommitRow = memo(GraphCommitRowInner, graphCommitRowEqual);
