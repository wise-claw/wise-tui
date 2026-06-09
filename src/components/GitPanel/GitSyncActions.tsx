import { memo } from "react";
import { HoverHint } from "../shared/HoverHint";
import type { MouseEvent } from "react";
import { Button, Space } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, CheckOutlined, ReloadOutlined } from "@ant-design/icons";
import type { GitStatusResponse } from "../../types";

interface GitSyncActionsProps {
  status: GitStatusResponse;
  loading: Record<string, boolean>;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  /** 多仓区块头部等窄区域：隐藏「待提交」角标（左侧已有变更数）。 */
  hideStagedCount?: boolean;
}

function invokeSyncAction(
  event: MouseEvent<HTMLElement>,
  kind: "fetch" | "pull" | "push",
  loading: Record<string, boolean>,
  invoke: () => void,
) {
  event.preventDefault();
  event.stopPropagation();
  if (loading[kind]) return;
  const busyKind = loading.fetch ? "fetch" : loading.pull ? "pull" : loading.push ? "push" : null;
  if (busyKind && busyKind !== kind) return;
  invoke();
}

export const GitSyncActions = memo(function GitSyncActions({
  status,
  loading,
  onFetch,
  onPull,
  onPush,
  hideStagedCount = false,
}: GitSyncActionsProps) {
  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;

  return (
    <Space size={4} className="git-header-sync-actions">
      <HoverHint title="获取远程" placement="top">
        <span className="git-sync-count-btn-wrap">
          <Button
            type="text"
            size="small"
            className={`git-sync-count-btn${loading.fetch ? " git-sync-count-btn--busy" : ""}`}
            icon={<ReloadOutlined spin={loading.fetch} />}
            aria-label="获取远程"
            aria-busy={loading.fetch}
            onMouseDown={(event) => invokeSyncAction(event, "fetch", loading, onFetch)}
          />
        </span>
      </HoverHint>
      <HoverHint title="拉取" placement="top">
        <span className="git-sync-count-btn-wrap">
          <Button
            type="text"
            size="small"
            className={`git-sync-count-btn${loading.pull ? " git-sync-count-btn--busy" : ""}`}
            icon={loading.pull ? <ReloadOutlined spin /> : <ArrowDownOutlined />}
            aria-label={behind > 0 ? `拉取，落后 ${behind} 个提交` : "拉取"}
            aria-busy={loading.pull}
            onMouseDown={(event) => invokeSyncAction(event, "pull", loading, onPull)}
          />
          {!loading.pull && behind > 0 ? (
            <span className="sync-count sync-count--behind">{behind}</span>
          ) : null}
        </span>
      </HoverHint>
      <HoverHint title="推送" placement="top">
        <span className="git-sync-count-btn-wrap">
          <Button
            type="text"
            size="small"
            className={`git-sync-count-btn${loading.push ? " git-sync-count-btn--busy" : ""}`}
            icon={loading.push ? <ReloadOutlined spin /> : <ArrowUpOutlined />}
            aria-label={ahead > 0 ? `推送，领先 ${ahead} 个提交` : "推送"}
            aria-busy={loading.push}
            onMouseDown={(event) => invokeSyncAction(event, "push", loading, onPush)}
          />
          {!loading.push && ahead > 0 ? (
            <span className="sync-count sync-count--ahead">{ahead}</span>
          ) : null}
        </span>
      </HoverHint>
      {status.staged.length > 0 && !hideStagedCount ? (
        <HoverHint title="待提交" placement="top">
          <span className="git-sync-count-btn-wrap">
            <Button
              type="text"
              size="small"
              className="git-sync-count-btn"
              icon={<CheckOutlined />}
              disabled
              aria-label={`待提交 ${status.staged.length} 个文件`}
            />
            <span className="sync-count sync-count--staged">{status.staged.length}</span>
          </span>
        </HoverHint>
      ) : null}
    </Space>
  );
}, (left, right) =>
  left.hideStagedCount === right.hideStagedCount
  && left.status.ahead === right.status.ahead
  && left.status.behind === right.status.behind
  && left.status.staged.length === right.status.staged.length
  && left.loading.fetch === right.loading.fetch
  && left.loading.pull === right.loading.pull
  && left.loading.push === right.loading.push
  && left.onFetch === right.onFetch
  && left.onPull === right.onPull
  && left.onPush === right.onPush);
