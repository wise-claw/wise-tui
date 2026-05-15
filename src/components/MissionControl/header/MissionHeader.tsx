import { Button, Space, Steps, Typography } from "antd";
import { ThunderboltOutlined, EditOutlined, SettingOutlined } from "@ant-design/icons";
import type { MissionPrimaryCta, MissionViewModel } from "../presenter/types";
import { MissionAgentSummary } from "./MissionAgentSummary";

interface MissionHeaderProps {
  viewModel: MissionViewModel;
  busy: boolean;
  onPrimaryCta: (cta: MissionPrimaryCta) => void;
  onRestart: () => void;
  onOpenEngineering: () => void;
}

export function MissionHeader({
  viewModel,
  busy,
  onPrimaryCta,
  onRestart,
  onOpenEngineering,
}: MissionHeaderProps) {
  const currentStep = viewModel.phaseStrip.findIndex((s) => s.status === "current");
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

      <Steps
        className="mission-header__stepper"
        size="small"
        current={currentStep >= 0 ? currentStep : 0}
        items={viewModel.phaseStrip.map((s) => ({
          title: s.label,
          status: s.status === "done" ? "finish" : s.status === "current" ? "process" : "wait",
        }))}
      />

      <MissionAgentSummary runState={viewModel.runState} />

      <Space size={8} className="mission-header__actions">
        {!isDrafting && (
          <Button type="text" size="small" icon={<EditOutlined />} onClick={onRestart}>
            编辑 PRD
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
