import { Button, Space, Tooltip } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { GitStatusResponse } from "../../types";

interface GitSyncActionsProps {
  status: GitStatusResponse;
  loading: Record<string, boolean>;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
}

export function GitSyncActions({ status, loading, onFetch, onPull, onPush }: GitSyncActionsProps) {
  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;

  if (!status.branch && !loading.fetch) {
    return null;
  }

  return (
    <Space size={2} className="git-header-sync-actions">
      <Tooltip title="获取远程" placement="top">
        <Button
          type="text"
          size="small"
          className="git-sync-count-btn"
          icon={<ReloadOutlined spin={loading.fetch} />}
          onClick={onFetch}
          disabled={loading.fetch}
        />
      </Tooltip>
      <Tooltip title="拉取" placement="top">
        <Button
          type="text"
          size="small"
          className="git-sync-count-btn"
          icon={loading.pull ? <ReloadOutlined spin /> : <ArrowDownOutlined />}
          onClick={onPull}
          disabled={loading.pull || loading.fetch}
        >
          {!loading.pull && behind > 0 && (
            <span className="sync-count sync-count--behind">{behind}</span>
          )}
        </Button>
      </Tooltip>
      <Tooltip title="推送" placement="top">
        <Button
          type="text"
          size="small"
          className="git-sync-count-btn"
          icon={loading.push ? <ReloadOutlined spin /> : <ArrowUpOutlined />}
          onClick={onPush}
          disabled={loading.push || loading.pull}
        >
          {!loading.push && ahead > 0 && (
            <span className="sync-count sync-count--ahead">{ahead}</span>
          )}
        </Button>
      </Tooltip>
      {status.staged.length > 0 && (
        <Tooltip title="待提交" placement="top">
          <Button
            type="text"
            size="small"
            className="git-sync-count-btn"
            icon={<CheckOutlined />}
            disabled
          >
            <span className="sync-count sync-count--staged">{status.staged.length}</span>
          </Button>
        </Tooltip>
      )}
    </Space>
  );
}
