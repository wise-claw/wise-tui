import { Button, Tag, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { WorkflowGraphPanel } from "../MissionControl/engineering/WorkflowGraphPanel";
import "./Inspectors.css";

interface WorkflowGraphInspectorProps {
  rootPath: string;
  projectId: string | null;
  onClose: () => void;
}

/**
 * Stage 5 / E7：Trellis 工作流图 Inspector。
 * 承接旧 `ProjectTrellisCenter` "工作流图" Tab,改为按需打开的叠层透镜。
 */
export function WorkflowGraphInspector({
  rootPath,
  projectId,
  onClose,
}: WorkflowGraphInspectorProps) {
  return (
    <div className="trellis-inspector" role="region" aria-label="Trellis 工作流图">
      <header className="trellis-inspector__head">
        <Typography.Title level={5} className="trellis-inspector__title">
          Trellis 工作流图
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
        <WorkflowGraphPanel projectId={projectId} rootPath={rootPath} />
      </div>
    </div>
  );
}
