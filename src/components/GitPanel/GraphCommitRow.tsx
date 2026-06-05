import { memo, useCallback, useMemo, type CSSProperties, type MouseEvent, type Ref } from "react";
import { Dropdown, Tag, Typography } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import { message } from "antd";
import type { GitGraphCommit } from "../../types";
import { buildGraphCommitMenuItems } from "./graphCommitMenu";
import { formatCommitDate, formatRelativeTime } from "./gitPanelUtils";
import { gitGraphRefColor } from "./gitGraphLayout";

const { Text } = Typography;

export interface GraphCommitRowProps {
  commit: GitGraphCommit;
  laneColor: string;
  rowHeight: number;
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
    && left.canCompareWithBase === right.canCompareWithBase
    && left.canCompareWithHead === right.canCompareWithHead
    && left.commit.sha === right.commit.sha
    && left.commit.summary === right.commit.summary
    && left.commit.author === right.commit.author
    && left.commit.timestamp === right.commit.timestamp
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

function GraphCommitRowInner({
  commit,
  laneColor,
  rowHeight,
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
        className={`git-graph-row${selected ? " git-graph-row--selected" : ""}${virtualized ? " git-graph-row--virtualized" : ""}`}
        style={rowStyle}
        onClick={handleSelect}
        onDoubleClick={(event) => {
          event.preventDefault();
          handleOpenDetail();
        }}
        role="button"
        aria-selected={selected}
      >
        <div className="git-graph-row__main">
          <div className="git-graph-row__summary-row">
            <div className="git-graph-row__summary">{commit.summary || "无描述"}</div>
            {commit.refs.length > 0 ? (
              <div className="git-graph-row__refs">
                {commit.refs.map((ref) => {
                  const clickable = !ref.isHead && ref.kind !== "remote";
                  const refColor = ref.isHead ? undefined : ref.kind === "tag" ? gitGraphRefColor(ref.name) : laneColor;
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
                      {ref.isHead ? "HEAD" : ref.name}
                    </Tag>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="git-graph-row__meta">
            <span className="git-graph-row__sha">{commit.sha.slice(0, 7)}</span>
            <Text type="secondary" className="git-graph-row__author">{commit.author || "未知"}</Text>
            <Text type="secondary" className="git-graph-row__time" title={formatCommitDate(commit.timestamp)}>
              {formatRelativeTime(commit.timestamp)}
            </Text>
          </div>
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
