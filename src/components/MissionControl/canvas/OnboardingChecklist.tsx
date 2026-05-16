import { useEffect, useState } from "react";
import { Empty, Spin, Tag, Typography, Progress } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  AuditOutlined,
} from "@ant-design/icons";
import {
  getTrellisOnboardingState,
  type TrellisOnboardingState,
} from "../../../services/trellisRuntime";

interface OnboardingChecklistProps {
  rootPath?: string | null;
}

function severityIcon(severity: string) {
  if (severity === "error") return <CloseCircleOutlined style={{ color: "var(--mission-error)" }} />;
  if (severity === "warning") return <WarningOutlined style={{ color: "var(--mission-warning)" }} />;
  return <CheckCircleOutlined style={{ color: "var(--mission-success)" }} />;
}

export function OnboardingChecklist({ rootPath }: OnboardingChecklistProps) {
  const [state, setState] = useState<TrellisOnboardingState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!rootPath) { setState(null); return; }
    setLoading(true);
    getTrellisOnboardingState({ rootPath })
      .then(setState)
      .catch(() => setState(null))
      .finally(() => setLoading(false));
  }, [rootPath]);

  if (!rootPath) return null;
  if (loading) return <div style={{ padding: 16, textAlign: "center" }}><Spin size="small" /></div>;
  if (!state) return null;

  const passCount = state.checks.filter((c) => c.status === "pass").length;
  const pct = state.checks.length > 0 ? Math.round((passCount / state.checks.length) * 100) : 0;

  return (
    <section className="onboarding-checklist">
      <div className="onboarding-checklist__header">
        <AuditOutlined />
        <Typography.Text strong style={{ fontSize: 12 }}>项目健康检查</Typography.Text>
        <Tag color={state.status === "ready" ? "success" : state.status === "warning" ? "warning" : "error"} style={{ fontSize: 10 }}>
          {state.status === "ready" ? "就绪" : state.status === "warning" ? "警告" : "需修复"}
        </Tag>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--mission-muted)", fontWeight: 600 }}>
          {passCount}/{state.checks.length}
        </span>
      </div>

      <Progress
        percent={pct}
        size="small"
        showInfo={false}
        strokeColor={pct === 100 ? "var(--mission-success)" : pct >= 50 ? "var(--mission-warning)" : "var(--mission-error)"}
        trailColor="var(--mission-surface-soft)"
        style={{ margin: "0 14px 8px" }}
      />

      <div className="onboarding-checklist__list">
        {state.checks.map((check) => (
          <div key={check.id} className={`onboarding-check onboarding-check--${check.status}`}>
            <span className="onboarding-check__icon">{severityIcon(check.severity)}</span>
            <div className="onboarding-check__body">
              <Typography.Text strong style={{ fontSize: 12 }}>
                {check.label}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {check.detail}
              </Typography.Text>
              {check.suggestedAction ? (
                <Typography.Text type="secondary" style={{ fontSize: 10, fontStyle: "italic" }}>
                  {check.suggestedAction}
                </Typography.Text>
              ) : null}
            </div>
            <Tag
              color={check.status === "pass" ? "success" : "error"}
              style={{ fontSize: 9, lineHeight: "16px" }}
            >
              {check.status === "pass" ? "通过" : "未通过"}
            </Tag>
          </div>
        ))}
        {state.checks.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无检查项" />
        ) : null}
      </div>
    </section>
  );
}
