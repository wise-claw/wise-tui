import { Tag, Tooltip } from "antd";
import {
  RocketOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useMissionLedger } from "../MissionControl/useMissionLedger";
import {
  getMissionOnboardingHealth,
  type MissionOnboardingHealthReport,
} from "../../services/missionControlBackend";

interface MissionIndicatorProps {
  projectId?: string | null;
}

export function MissionIndicator({ projectId }: MissionIndicatorProps) {
  const { activeMission } = useMissionLedger({ projectId });
  const [health, setHealth] = useState<MissionOnboardingHealthReport | null>(null);

  useEffect(() => {
    if (!projectId || activeMission) { setHealth(null); return; }
    let cancelled = false;
    getMissionOnboardingHealth({ projectId })
      .then((h) => { if (!cancelled) setHealth(h); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, activeMission]);

  if (activeMission) {
    const stageLabel =
      activeMission.stage === "dispatch" ? "派发中"
      : activeMission.stage === "review" ? "确认中"
      : activeMission.stage === "done" ? "已完成"
      : activeMission.stage === "plan" ? "分析中"
      : "就绪";

    return (
      <div className="mission-indicator">
        <Tag
          icon={<RocketOutlined />}
          color={activeMission.stage === "done" ? "success" : "processing"}
          style={{ fontSize: 10, fontWeight: 700 }}
        >
          {activeMission.title || "Mission"}
          {" · "}
          {stageLabel}
        </Tag>
      </div>
    );
  }

  if (!health) return null;

  const okCount = health.checks.filter((c) => c.status === "pass").length;
  const failCount = health.checks.filter((c) => c.status === "fail").length;

  const statusIcon =
    health.status === "ready" ? <CheckCircleOutlined style={{ color: "var(--mission-success)" }} />
    : health.status === "warning" ? <WarningOutlined style={{ color: "var(--mission-warning)" }} />
    : <CloseCircleOutlined style={{ color: "var(--mission-error)" }} />;

  return (
    <div className="mission-indicator">
      <Tooltip
        title={
          <div style={{ fontSize: 11 }}>
            {health.checks.map((c, i) => (
              <div key={c.id ?? i}>{c.status === "pass" ? "✅" : "❌"} {c.label}</div>
            ))}
          </div>
        }
      >
        <Tag icon={statusIcon} style={{ fontSize: 10, fontWeight: 700, cursor: "help" }}>
          {okCount}/{health.checks.length} 就绪
          {failCount > 0 ? ` · ${failCount} 失败` : ""}
        </Tag>
      </Tooltip>
    </div>
  );
}
