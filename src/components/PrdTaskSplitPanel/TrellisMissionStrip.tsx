import { CheckOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import { Space, Tooltip, Typography } from "antd";
import type {
  RequirementAssistantStageItem,
  TrellisTargetSummary,
} from "./usePrdTaskSplitPanelController";

interface Props {
  target: TrellisTargetSummary;
  stages: RequirementAssistantStageItem[];
}

export function TrellisMissionStrip({ target, stages }: Props) {
  return (
    <section className="app-prd-task-panel__mission-strip" aria-label="需求拆分助手流程状态">
      <div className="app-prd-task-panel__mission-target">
        <span
          className={[
            "app-prd-task-panel__mission-target-dot",
            target.healthy ? "is-ready" : "is-blocked",
          ].join(" ")}
          aria-hidden
        />
        <div className="app-prd-task-panel__mission-target-main">
          <Space size={6} align="center">
            <Typography.Text strong className="app-prd-task-panel__mission-target-title">
              {target.title}
            </Typography.Text>
            {target.healthy ? (
              <Tooltip title="当前目标可用">
                <CheckOutlined className="app-prd-task-panel__mission-target-ok" />
              </Tooltip>
            ) : (
              <Tooltip title={target.subtitle}>
                <ExclamationCircleOutlined className="app-prd-task-panel__mission-target-warning" />
              </Tooltip>
            )}
          </Space>
          <Typography.Text type="secondary" className="app-prd-task-panel__mission-target-subtitle">
            {target.subtitle}
          </Typography.Text>
        </div>
      </div>
      <div className="app-prd-task-panel__mission-meta">
          <span title={target.rootPath || "未绑定工作目录"}>
          目录：{target.rootPath || "未绑定"}
        </span>
        <span>仓库：{target.repositoryCount}</span>
        <span title={target.activeRepositoryLabel}>执行：{target.activeRepositoryLabel}</span>
      </div>
      <ol className="app-prd-task-panel__mission-stages">
        {stages.map((stage) => (
          <li
            key={stage.key}
            className={`app-prd-task-panel__mission-stage is-${stage.status}`}
            aria-current={stage.status === "active" ? "step" : undefined}
          >
            <span className="app-prd-task-panel__mission-stage-dot" aria-hidden />
            <span>{stage.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
