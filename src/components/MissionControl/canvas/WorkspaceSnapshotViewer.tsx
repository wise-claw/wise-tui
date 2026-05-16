import { useState } from "react";
import { Empty, Tag, Typography, Button } from "antd";
import {
  CameraOutlined,
  DiffOutlined,
  PlusOutlined,
  MinusOutlined,
  EditOutlined,
} from "@ant-design/icons";
import {
  captureTrellisWorkspaceSnapshot,
  diffTrellisWorkspaceSnapshots,
  type TrellisWorkspaceSnapshot,
  type TrellisWorkspaceSnapshotDiff,
} from "../../../services/trellisRuntime";

interface WorkspaceSnapshotViewerProps {
  rootPath?: string | null;
}

export function WorkspaceSnapshotViewer({ rootPath }: WorkspaceSnapshotViewerProps) {
  const [snapshot, setSnapshot] = useState<TrellisWorkspaceSnapshot | null>(null);
  const [diff, setDiff] = useState<TrellisWorkspaceSnapshotDiff | null>(null);
  const [capturing, setCapturing] = useState(false);

  const handleCapture = async () => {
    if (!rootPath) return;
    setCapturing(true);
    try {
      const prevId = snapshot?.snapshotId ?? null;
      const snap = await captureTrellisWorkspaceSnapshot({ rootPath, reason: "manual" });
      setSnapshot(snap);
      if (prevId) {
        const d = await diffTrellisWorkspaceSnapshots({
          beforeSnapshotId: prevId,
          afterSnapshotId: snap.snapshotId,
        });
        setDiff(d);
      }
    } catch {
      // silent
    } finally {
      setCapturing(false);
    }
  };


  if (!rootPath) return null;

  return (
    <section className="ws-snapshot">
      <div className="ws-snapshot__header">
        <CameraOutlined />
        <Typography.Text strong style={{ fontSize: 12 }}>工作区快照</Typography.Text>
        {snapshot ? (
          <Tag style={{ fontSize: 10 }}>{snapshot.fileCount} 文件</Tag>
        ) : null}
        <div style={{ marginLeft: "auto" }}>
          <Button size="small" icon={<CameraOutlined />} loading={capturing} onClick={handleCapture}>
            快照
          </Button>
        </div>
      </div>

      {!snapshot ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击快照按钮创建首个工作区快照" />
      ) : (
        <div className="ws-snapshot__body">
          {/* Diff summary */}
          {diff ? (
            <div className="ws-snapshot__diff-summary">
              <DiffOutlined />
              <span className="ws-snapshot__diff-stat ws-snapshot__diff-stat--add">
                <PlusOutlined /> {diff.added.length}
              </span>
              <span className="ws-snapshot__diff-stat ws-snapshot__diff-stat--remove">
                <MinusOutlined /> {diff.removed.length}
              </span>
              <span className="ws-snapshot__diff-stat ws-snapshot__diff-stat--mod">
                <EditOutlined /> {diff.modified.length}
              </span>
              <span className="ws-snapshot__diff-stat">
                {diff.unchanged.length} 未变
              </span>
            </div>
          ) : null}

          {/* File list */}
          <div className="ws-snapshot__files">
            {snapshot.manifest.slice(0, 50).map((file) => {
              const changeType =
                diff?.added.find((r) => r.path === file.path) ? "added"
                : diff?.removed.find((r) => r.path === file.path) ? "removed"
                : diff?.modified.find((r) => r.path === file.path) ? "modified"
                : "unchanged";

              return (
                <div key={file.path} className={`ws-snapshot-file ws-snapshot-file--${changeType}`}>
                  <span className="ws-snapshot-file__change">
                    {changeType === "added" ? <PlusOutlined style={{ color: "var(--mission-success)" }} />
                    : changeType === "removed" ? <MinusOutlined style={{ color: "var(--mission-error)" }} />
                    : changeType === "modified" ? <EditOutlined style={{ color: "var(--mission-warning)" }} />
                    : null}
                  </span>
                  <span className="ws-snapshot-file__path">{file.path}</span>
                  <span className="ws-snapshot-file__size">{formatBytes(file.sizeBytes)}</span>
                  <span className="ws-snapshot-file__hash" title={file.hash}>{file.hash.slice(0, 7)}</span>
                </div>
              );
            })}
            {snapshot.manifest.length > 50 ? (
              <Typography.Text type="secondary" style={{ fontSize: 11, padding: "8px 12px", display: "block" }}>
                还有 {snapshot.manifest.length - 50} 个文件未显示
              </Typography.Text>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
