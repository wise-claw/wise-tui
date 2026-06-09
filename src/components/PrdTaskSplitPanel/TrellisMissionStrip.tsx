import { HoverHint } from "../shared/HoverHint";
import {
  CheckOutlined,
  ExclamationCircleOutlined,
  FolderOpenOutlined,
  DatabaseOutlined,
  InfoCircleOutlined,
  BranchesOutlined,
} from "@ant-design/icons";
import type {
  RequirementAssistantStageItem,
  TrellisTargetSummary,
} from "./usePrdTaskSplitPanelController";

interface Props {
  target: TrellisTargetSummary;
  stages: RequirementAssistantStageItem[];
}

export function TrellisMissionStrip({ target, stages }: Props) {
  const displayPath = target.rootPath ? (
    target.rootPath.length > 100
      ? `...${target.rootPath.slice(-95)}`
      : target.rootPath
  ) : "未绑定";

  return (
    <section className="app-prd-task-panel__mission-strip-premium" aria-label="需求拆分助手流程状态">
      <div className="app-prd-task-panel__mission-header-row">
        {/* Left Side: Title & Status dot */}
        <div className="app-prd-task-panel__mission-title-area">
          <span
            className={[
              "app-prd-task-panel__mission-status-dot",
              target.healthy ? "is-ready" : "is-blocked",
            ].join(" ")}
            aria-hidden
          />
          <span className="app-prd-task-panel__mission-title-text" title={target.title}>
            {target.title}
          </span>
          {target.subtitle.trim().length > 0 && (
            <HoverHint title={target.subtitle}>
              <InfoCircleOutlined className="app-prd-task-panel__mission-info-icon" />
            </HoverHint>
          )}
        </div>

        {/* Right Side: Meta Capsules */}
        <div className="app-prd-task-panel__mission-meta-group">
          {target.rootPath && (
            <HoverHint title={`工作区根路径: ${target.rootPath}`}>
              <span className="app-prd-task-panel__mission-meta-pill">
                <FolderOpenOutlined className="app-prd-task-panel__meta-icon" />
                <span className="app-prd-task-panel__meta-val">{displayPath}</span>
              </span>
            </HoverHint>
          )}
          {target.repositoryCount > 0 && (
            <span className="app-prd-task-panel__mission-meta-pill">
              <DatabaseOutlined className="app-prd-task-panel__meta-icon" />
              <span className="app-prd-task-panel__meta-val">仓库: {target.repositoryCount}</span>
            </span>
          )}
          {target.activeRepositoryLabel && (
            <span className="app-prd-task-panel__mission-meta-pill is-active-repo">
              <BranchesOutlined className="app-prd-task-panel__meta-icon" />
              <span className="app-prd-task-panel__meta-val">执行: {target.activeRepositoryLabel}</span>
            </span>
          )}
          {target.healthy ? (
            <span className="app-prd-task-panel__mission-status-badge is-healthy">
              <CheckOutlined /> 可用
            </span>
          ) : (
            <HoverHint title={target.subtitle}>
              <span className="app-prd-task-panel__mission-status-badge is-error">
                <ExclamationCircleOutlined /> 异常
              </span>
            </HoverHint>
          )}
        </div>
      </div>

      {/* Stepper Pipeline */}
      <div className="app-prd-task-panel__mission-stepper">
        {stages.map((stage, idx) => {
          const isDone = stage.status === "done";

          return (
            <div
              key={stage.key}
              className={[
                "app-prd-task-panel__mission-step-item",
                `is-${stage.status}`,
              ].join(" ")}
            >
              <div className="app-prd-task-panel__mission-step-content">
                <span className="app-prd-task-panel__mission-step-indicator">
                  {isDone ? <CheckOutlined className="step-check-icon" /> : (idx + 1)}
                </span>
                <span className="app-prd-task-panel__mission-step-label">{stage.label}</span>
              </div>
              {idx < stages.length - 1 && (
                <div className="app-prd-task-panel__mission-step-connector" />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

