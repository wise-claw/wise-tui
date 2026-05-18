import { Button, Space, Tooltip, Typography } from "antd";
import { ThunderboltOutlined, EditOutlined, ToolOutlined } from "@ant-design/icons";
import type { MissionPrimaryCta, MissionViewModel } from "../presenter/types";
import { MissionStatusBar } from "./MissionStatusBar";
import type { MissionSnapshotRecord } from "../../../services/missionControlBackend";

interface MissionHeaderProps {
  viewModel: MissionViewModel;
  busy: boolean;
  activeMission?: MissionSnapshotRecord | null;
  onPrimaryCta: (cta: MissionPrimaryCta) => void;
  onRestart: () => void;
  onOpenDiagnostics: () => void;
  onClearResplitFlags?: () => void;
}

export function MissionHeader({
  viewModel,
  busy,
  activeMission,
  onPrimaryCta,
  onRestart,
  onOpenDiagnostics,
  onClearResplitFlags,
}: MissionHeaderProps) {
  const isDrafting = viewModel.phase === "drafting";
  // In drafting phase, the inline editor provides its own submit button.
  const showCta = !isDrafting;

  return (
    <header className="mission-header">
      <div className="mission-header__left">
        <Typography.Text className="mission-header__eyebrow">
          {viewModel.project.name || "需求拆分"}
        </Typography.Text>
        <Typography.Title level={3} className="mission-header__title">
          {viewModel.title}
        </Typography.Title>
        <Typography.Text className="mission-header__subtitle">{viewModel.subtitle}</Typography.Text>
      </div>

      <MissionStatusBar
        missionId={activeMission?.missionId ?? null}
        runState={viewModel.runState}
        resplitCount={viewModel.resplit.count}
      />

      <Space size={8} className="mission-header__actions">
        {!isDrafting && (
          <Button type="text" size="small" icon={<EditOutlined />} onClick={onRestart}>
            PRD 列表
          </Button>
        )}
        <Button
          type="text"
          size="small"
          icon={<ToolOutlined />}
          onClick={onOpenDiagnostics}
        >
          诊断
        </Button>
        {viewModel.resplit.count > 0 && onClearResplitFlags ? (
          <Tooltip title="保留当前拆分结果，允许继续生成任务">
            <Button size="small" onClick={onClearResplitFlags}>
              忽略重拆标记
            </Button>
          </Tooltip>
        ) : null}
        {showCta && (
          <Tooltip
            title={
              "disabledReason" in viewModel.primaryCta
                ? viewModel.primaryCta.disabledReason ?? undefined
                : undefined
            }
          >
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={busy}
              disabled={"disabled" in viewModel.primaryCta ? viewModel.primaryCta.disabled : false}
              onClick={() => onPrimaryCta(viewModel.primaryCta)}
            >
              {viewModel.primaryCta.label}
            </Button>
          </Tooltip>
        )}
      </Space>
    </header>
  );
}
