import { Button, Tag, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { SpecRevisionTimeline } from "../MissionControl/canvas/SpecRevisionTimeline";
import { WorkspaceSnapshotViewer } from "../MissionControl/canvas/WorkspaceSnapshotViewer";
import "./Inspectors.css";

interface SpecTimelineInspectorProps {
  rootPath: string;
  onClose: () => void;
}

/**
 * Stage 5 / E7：Trellis Spec / 工作区快照时间轴 Inspector。
 * 承接旧 `ProjectTrellisCenter` 中的 SpecRevisionTimeline + WorkspaceSnapshotViewer,
 * 改为按需打开的叠层透镜。
 */
export function SpecTimelineInspector({
  rootPath,
  onClose,
}: SpecTimelineInspectorProps) {
  return (
    <div className="trellis-inspector" role="region" aria-label="Trellis Spec 时间轴">
      <header className="trellis-inspector__head">
        <Typography.Title level={5} className="trellis-inspector__title">
          Trellis Spec 时间轴
        </Typography.Title>
        <Tag>{rootPath}</Tag>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onClose}
          aria-label="关闭"
        />
      </header>
      <div className="trellis-inspector__body">
        <SpecRevisionTimeline rootPath={rootPath} />
        <WorkspaceSnapshotViewer rootPath={rootPath} />
      </div>
    </div>
  );
}
