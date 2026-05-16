import { Button, Space, Typography } from "antd";
import { ThunderboltOutlined, EditOutlined, SettingOutlined } from "@ant-design/icons";
import type { MissionPrimaryCta, MissionViewModel } from "../presenter/types";
import { MissionStatusBar } from "./MissionStatusBar";
import type { MissionSnapshotRecord } from "../../../services/missionControlBackend";

interface MissionHeaderProps {
  viewModel: MissionViewModel;
  busy: boolean;
  activeMission?: MissionSnapshotRecord | null;
  onPrimaryCta: (cta: MissionPrimaryCta) => void;
  onRestart: () => void;
  onOpenEngineering: () => void;
}

export function MissionHeader({
  viewModel,
  busy,
  activeMission,
  onPrimaryCta,
  onRestart,
  onOpenEngineering,
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
          icon={<SettingOutlined />}
          onClick={onOpenEngineering}
        />
        {showCta && (
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={busy}
            disabled={"disabled" in viewModel.primaryCta ? viewModel.primaryCta.disabled : false}
            onClick={() => onPrimaryCta(viewModel.primaryCta)}
          >
            {viewModel.primaryCta.label}
          </Button>
        )}
      </Space>
    </header>
  );
}
