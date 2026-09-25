import { useState } from "react";
import { App as AntApp, Button, Progress, Space, Tag, Tooltip, Typography } from "antd";
import { useCollabRequirementSnapshot } from "../../hooks/useCollabRequirementSnapshot";
import {
  controlCollabRequirement,
  currentPlanView,
  formatCollabError,
  latestArtifactVersions,
  newCollabRequestId,
  pendingPlanDecision,
  planChain,
  requirementProgress,
  requirementStatusLabel,
  resolveCollabDecision,
  stageLabel,
  topBlockers,
} from "../../services/collaboration";
import { openCollabRequirementDetail } from "../../stores/collabUiStore";
import type { CollabSessionRequirement } from "../../types/collaboration";
import "./collaboration.css";

interface Props {
  item: CollabSessionRequirement;
  agentName: string;
  continuing: boolean;
  onContinue?: () => void;
}

/** 原会话中的需求卡片：判断依据、计划、当前阻塞、最近交付与常用操作。 */
export function CollabSessionRequirementCard({ item, agentName, continuing, onContinue }: Props) {
  const { message } = AntApp.useApp();
  const { snapshot } = useCollabRequirementSnapshot(item.requirement.id);
  const [busy, setBusy] = useState(false);
  const req = snapshot?.requirement ?? item.requirement;
  const counts = snapshot?.counts ?? item.counts;
  const status = requirementStatusLabel(req);
  const plan = snapshot ? currentPlanView(snapshot) : null;
  const chain = snapshot ? planChain(snapshot.tasks) : "";
  const blockers = snapshot ? topBlockers(snapshot, 1) : [];
  const latest = snapshot ? latestArtifactVersions(snapshot.artifacts).filter((a) => a.validationState === "valid") : [];
  const approval = snapshot ? pendingPlanDecision(snapshot.decisions) : null;
  const paused = req.controlStatus === "paused" || req.controlStatus === "pausing";
  const cancelled = req.controlStatus === "cancelled";

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      message.success(ok);
    } catch (e) {
      message.error(formatCollabError(e));
    } finally {
      setBusy(false);
    }
  };

  const control = (action: "pause" | "resume" | "reopen") =>
    run(
      () =>
        controlCollabRequirement({
          requestId: newCollabRequestId(action),
          requirementId: req.id,
          action,
          expectedRevision: req.revision,
        }),
      action === "pause" ? "已请求暂停" : action === "resume" ? "已恢复" : "已重新打开",
    );

  if (item.relation === "execution" && item.attempt) {
    return (
      <div className="collab-card collab-card--execution">
        <Space size={6} wrap>
          <Tag color="blue">协作任务</Tag>
          <Typography.Text strong>{item.attempt.taskTitle}</Typography.Text>
          <Typography.Text type="secondary">属于需求「{req.title}」</Typography.Text>
          <Button size="small" type="link" onClick={() => openCollabRequirementDetail(req.id, "tasks")}>
            查看需求
          </Button>
        </Space>
      </div>
    );
  }

  return (
    <div className={`collab-card${continuing ? " collab-card--continuing" : ""}`}>
      <div className="collab-card__head">
        <Space size={6} wrap>
          <Typography.Text strong>
            {agentName} · {req.title}
          </Typography.Text>
          <Tag color={status.tone}>{status.label}</Tag>
          {counts.openDecisions > 0 ? <Tag color="error">待决策 {counts.openDecisions}</Tag> : null}
          {counts.openChanges > 0 ? <Tag color="warning">修正单 {counts.openChanges}</Tag> : null}
        </Space>
        <Button size="small" type="link" onClick={() => openCollabRequirementDetail(req.id)}>
          查看需求
        </Button>
      </div>
      {plan?.rationale ? (
        <div className="collab-card__line">
          <span className="collab-card__label">判断</span>
          <Typography.Text ellipsis={{ tooltip: plan.rationale }}>{plan.rationale}</Typography.Text>
        </div>
      ) : null}
      {chain || plan?.summary ? (
        <div className="collab-card__line">
          <span className="collab-card__label">计划</span>
          <Typography.Text ellipsis={{ tooltip: chain || plan?.summary }}>{chain || plan?.summary}</Typography.Text>
        </div>
      ) : null}
      <div className="collab-card__line">
        <span className="collab-card__label">当前</span>
        <Typography.Text type={blockers.length ? "warning" : undefined} ellipsis>
          {blockers.length ? `${blockers[0].taskTitle}：${blockers[0].message}` : stageLabel(req.stage)}
        </Typography.Text>
        {counts.tasks > 0 ? (
          <Tooltip title={`任务 ${counts.byState.succeeded ?? 0}/${counts.tasks} 完成`}>
            <Progress percent={requirementProgress(counts)} size="small" style={{ width: 96, margin: 0 }} />
          </Tooltip>
        ) : null}
      </div>
      {latest.length ? (
        <div className="collab-card__line">
          <span className="collab-card__label">最近交付</span>
          <Typography.Text ellipsis>
            {latest
              .slice(0, 3)
              .map((a) => `${a.name}@${a.version}`)
              .join("、")}
          </Typography.Text>
          <Button size="small" type="link" onClick={() => openCollabRequirementDetail(req.id, "artifacts")}>
            查看接口
          </Button>
        </div>
      ) : null}
      <Space size={4} wrap className="collab-card__actions">
        {approval ? (
          <Button
            size="small"
            type="primary"
            loading={busy}
            onClick={() =>
              run(
                () =>
                  resolveCollabDecision({
                    decisionId: approval.id,
                    expectedRevision: approval.revision,
                    optionId: "approve",
                    requestId: newCollabRequestId("approve"),
                  }),
                "计划已采用，开始执行",
              )
            }
          >
            开始执行
          </Button>
        ) : null}
        {onContinue && !cancelled ? (
          <Button
            size="small"
            type={continuing ? "primary" : "default"}
            ghost={continuing}
            title={req.businessStatus === "done" ? "继续已完成需求会创建新一轮规划与验收，保留原完成证据" : undefined}
            onClick={onContinue}
          >
            {continuing ? "正在补充此需求" : "继续此需求"}
          </Button>
        ) : null}
        {req.businessStatus === "done" ? null : cancelled ? (
          <Button size="small" loading={busy} onClick={() => control("reopen")}>
            重新打开
          </Button>
        ) : paused ? (
          <Button size="small" loading={busy} onClick={() => control("resume")}>
            恢复需求
          </Button>
        ) : (
          <Button size="small" loading={busy} onClick={() => control("pause")}>
            暂停需求
          </Button>
        )}
        <Button size="small" onClick={() => openCollabRequirementDetail(req.id, "messages")}>
          查看协作消息
        </Button>
        {req.businessStatus === "verifying" ? (
          <Button size="small" type="primary" onClick={() => openCollabRequirementDetail(req.id, "acceptance")}>
            去验收
          </Button>
        ) : null}
      </Space>
    </div>
  );
}
