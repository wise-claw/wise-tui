import type { MouseEvent } from "react";
import { Button, Space, Tooltip } from "antd";
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

export function GitSyncActions({
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
    <Space size={0} className="git-header-sync-actions">
      <Tooltip title="获取远程" placement="top" mouseEnterDelay={0.45}>
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
      </Tooltip>
      <Tooltip title="拉取" placement="top" mouseEnterDelay={0.45}>
        <span className="git-sync-count-btn-wrap">
          <Button
            type="text"
            size="small"
            className={`git-sync-count-btn${loading.pull ? " git-sync-count-btn--busy" : ""}`}
            icon={loading.pull ? <ReloadOutlined spin /> : <ArrowDownOutlined />}
            aria-label="拉取"
            aria-busy={loading.pull}
            onMouseDown={(event) => invokeSyncAction(event, "pull", loading, onPull)}
          >
            {!loading.pull && behind > 0 ? (
              <span className="sync-count sync-count--behind">{behind}</span>
            ) : null}
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="推送" placement="top" mouseEnterDelay={0.45}>
        <span className="git-sync-count-btn-wrap">
          <Button
            type="text"
            size="small"
            className={`git-sync-count-btn${loading.push ? " git-sync-count-btn--busy" : ""}`}
            icon={loading.push ? <ReloadOutlined spin /> : <ArrowUpOutlined />}
            aria-label="推送"
            aria-busy={loading.push}
            onMouseDown={(event) => invokeSyncAction(event, "push", loading, onPush)}
          >
            {!loading.push && ahead > 0 ? (
              <span className="sync-count sync-count--ahead">{ahead}</span>
            ) : null}
          </Button>
        </span>
      </Tooltip>
      {status.staged.length > 0 && !hideStagedCount ? (
        <Tooltip title="待提交" placement="top" mouseEnterDelay={0.45}>
          <span className="git-sync-count-btn-wrap">
            <Button
              type="text"
              size="small"
              className="git-sync-count-btn"
              icon={<CheckOutlined />}
              disabled
            >
              <span className="sync-count sync-count--staged">{status.staged.length}</span>
            </Button>
          </span>
        </Tooltip>
      ) : null}
    </Space>
  );
}
