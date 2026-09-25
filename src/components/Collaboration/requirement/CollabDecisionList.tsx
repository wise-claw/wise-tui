import { useState } from "react";
import { App as AntApp, Button, Card, Input, InputNumber, Select, Space, Tag, Typography } from "antd";
import {
  decisionKindLabel,
  formatCollabError,
  newCollabRequestId,
  openDecisions,
  resolveCollabDecision,
  repositoryWorkspaceLabel,
  setCollabLegacyTarget,
} from "../../../services/collaboration";
import type { Repository } from "../../../types";
import type { CollabAgentSummary, CollabDecision, CollabDecisionOption, CollabTask } from "../../../types/collaboration";

interface Props {
  requirementId: string;
  decisions: CollabDecision[];
  tasks: CollabTask[];
  agents: CollabAgentSummary[];
  repositories: Repository[];
  onResolved: () => void;
}

function decisionOptions(d: CollabDecision): CollabDecisionOption[] {
  if (!Array.isArray(d.options)) return [];
  return d.options.filter(
    (o): o is CollabDecisionOption =>
      typeof o === "object" && o !== null && typeof (o as CollabDecisionOption).id === "string",
  );
}

function evidenceLines(evidence: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(evidence ?? {})) {
    if (typeof v === "string" && v.trim()) out.push(`${k}：${v.trim().slice(0, 200)}`);
    else if (typeof v === "number" || typeof v === "boolean") out.push(`${k}：${String(v)}`);
  }
  return out.slice(0, 8);
}

function DecisionCard({ requirementId, decision, tasks, agents, repositories, onResolved }: Omit<Props, "decisions"> & { decision: CollabDecision }) {
  const { message } = AntApp.useApp();
  const [note, setNote] = useState("");
  const [extra, setExtra] = useState<number | null>(null);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [targetRepoId, setTargetRepoId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const affected = tasks.filter((t) => decision.taskIds.includes(t.id));
  const needsAgent = decisionOptions(decision).some((o) => o.id === "reassign") || decision.kind === "binding_revoked";
  const needsBudget = decisionOptions(decision).some((o) => o.id === "add_budget");
  const isLegacyTarget = decision.kind === "legacy_target";

  const resolve = async (option: CollabDecisionOption) => {
    setBusy(option.id);
    try {
      if (isLegacyTarget && option.id === "set_target") {
        if (targetRepoId == null) throw new Error("请选择目标仓库");
        await setCollabLegacyTarget(requirementId, targetRepoId);
      } else {
        const values: Record<string, unknown> = {};
        if (option.id === "add_budget" && extra != null) {
          if (decision.kind === "requirement_budget") values.extraBudgetMs = extra * 60_000;
          else if (decision.kind === "repair_budget") values.extraRounds = extra;
          else values.extraBudget = extra;
        }
        if (option.id === "reassign") {
          if (!targetAgentId) throw new Error("请选择接手的智能体");
          values.targetAgentId = targetAgentId;
        }
        await resolveCollabDecision({
          decisionId: decision.id,
          expectedRevision: decision.revision,
          optionId: option.id,
          requestId: newCollabRequestId("decision"),
          note,
          values,
        });
      }
      message.success(`已选择：${option.label}`);
      onResolved();
    } catch (e) {
      message.error(formatCollabError(e));
      onResolved();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card size="small" className="collab-decision">
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        <Space size={6} wrap>
          <Tag color="orange">{decisionKindLabel(decision.kind)}</Tag>
          <Typography.Text strong>{decision.title}</Typography.Text>
        </Space>
        {affected.length ? (
          <Typography.Text type="secondary">影响任务：{affected.map((t) => t.title).join("、")}</Typography.Text>
        ) : null}
        {decision.blockedOps.length ? (
          <Typography.Text type="secondary">阻塞操作：{decision.blockedOps.join("、")}</Typography.Text>
        ) : null}
        {evidenceLines(decision.evidence).map((l) => (
          <Typography.Text key={l} type="secondary" className="collab-evidence-line">
            {l}
          </Typography.Text>
        ))}
        <Space wrap>
          {needsBudget ? (
            <InputNumber
              size="small"
              min={1}
              max={decision.kind === "requirement_budget" ? 600 : 20}
              placeholder={decision.kind === "requirement_budget" ? "追加分钟" : decision.kind === "repair_budget" ? "追加轮数" : "追加次数"}
              value={extra}
              onChange={(v) => setExtra(typeof v === "number" ? v : null)}
            />
          ) : null}
          {needsAgent ? (
            <Select
              size="small"
              style={{ width: 200 }}
              placeholder="接手的智能体"
              value={targetAgentId ?? undefined}
              options={agents.filter((a) => a.status === "enabled").map((a) => ({ value: a.id, label: a.name }))}
              onChange={setTargetAgentId}
            />
          ) : null}
          {isLegacyTarget ? (
            <Select
              size="small"
              style={{ width: 220 }}
              placeholder="目标仓库"
              value={targetRepoId ?? undefined}
              showSearch
              optionFilterProp="label"
              options={repositories.map((r) => ({ value: r.id, label: repositoryWorkspaceLabel(r) }))}
              onChange={setTargetRepoId}
            />
          ) : null}
          <Input size="small" style={{ width: 220 }} placeholder="说明（可选，会记录到决策）" value={note} onChange={(e) => setNote(e.target.value)} />
        </Space>
        <Space wrap>
          {decisionOptions(decision).map((o, idx) => (
            <Button
              key={o.id}
              size="small"
              type={idx === 0 ? "primary" : "default"}
              danger={o.id.includes("reject") || o.id.includes("cancel")}
              loading={busy === o.id}
              disabled={busy != null && busy !== o.id}
              onClick={() => void resolve(o)}
            >
              {o.label}
            </Button>
          ))}
        </Space>
      </Space>
    </Card>
  );
}

/** 待处理决策：只阻塞其作用范围内的任务；每个决策按版本号提交，避免用旧页面覆盖新状态。 */
export function CollabDecisionList(props: Props) {
  const list = openDecisions(props.decisions);
  if (!list.length) return null;
  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      {list.map((d) => (
        <DecisionCard key={`${d.id}:${d.revision}`} decision={d} {...props} />
      ))}
    </Space>
  );
}
