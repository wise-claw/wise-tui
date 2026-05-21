import { Button, Tag, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { useTrellisRuntime } from "../../hooks/useTrellisRuntime";
import { OnboardingChecklist } from "../MissionControl/canvas/OnboardingChecklist";
import { AgentOwnershipGraph } from "../MissionControl/canvas/AgentOwnershipGraph";
import { RuntimeEventFeed } from "../MissionControl/canvas/RuntimeEventFeed";
import "./Inspectors.css";

interface RuntimeEventsInspectorProps {
  rootPath: string;
  projectId: string | null;
  onClose: () => void;
}

/**
 * Stage 5 / E7：Trellis 运行证据 Inspector。
 * 承接旧 `ProjectTrellisCenter` "运行证据" Tab 的三件子件
 * (OnboardingChecklist / AgentOwnershipGraph / RuntimeEventFeed),
 * 改为按需打开的叠层透镜。
 */
export function RuntimeEventsInspector({
  rootPath,
  projectId,
  onClose,
}: RuntimeEventsInspectorProps) {
  const runtime = useTrellisRuntime({
    projectId,
    rootPath,
    enabled: Boolean(rootPath),
  });

  return (
    <div className="trellis-inspector" role="region" aria-label="Trellis 运行证据">
      <header className="trellis-inspector__head">
        <Typography.Title level={5} className="trellis-inspector__title">
          Trellis 运行证据
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
        <OnboardingChecklist rootPath={rootPath} />
        <AgentOwnershipGraph
          graph={runtime.agentGraph}
          loading={runtime.loading}
        />
        <RuntimeEventFeed rootPath={rootPath} projectId={projectId} />
      </div>
    </div>
  );
}
