import { Button, Descriptions, Empty, Progress, Space, Table, Tag, Typography } from "antd";
import {
  currentPlanView,
  groupTasksByRepository,
  openChanges,
  requirementProgress,
  stageLabel,
  taskStateLabel,
  topBlockers,
} from "../../../services/collaboration";
import { openWorkspaceRequirementExecutionSession } from "../../../stores/workspaceMemoPanelStore";
import { CollabDecisionList } from "./CollabDecisionList";
import { LegacyHistorySection } from "./LegacyHistorySection";
import { agentName, formatDuration, formatTime, projectName, repoName, type CollabDetailContext } from "./detailContext";

const IMPACT_LABEL: Record<string, { label: string; color: string }> = {
  keep: { label: "沿用", color: "default" },
  redo: { label: "重做", color: "orange" },
  add: { label: "新增", color: "green" },
  cancel: { label: "取消", color: "red" },
};

const PLAN_STATE_LABEL: Record<string, string> = {
  proposed: "待确认",
  active: "生效",
  superseded: "已替代",
  rejected: "已拒绝",
};

const REVISION_STATE_LABEL: Record<string, string> = {
  applied: "已应用",
  proposed: "变更提案待确认",
  rejected: "未采纳",
};

const REVISION_KIND_LABEL: Record<string, string> = {
  initial: "初始需求",
  append: "补充要求",
  scope_change: "扩大范围",
  legacy_import: "历史导入",
};

function nextStep(ctx: CollabDetailContext): string {
  const { snapshot } = ctx;
  const req = snapshot.requirement;
  if (req.controlStatus === "paused") return "已暂停：恢复后重新检查版本、权限与环境再继续";
  if (req.controlStatus === "pausing") return "暂停中：等待运行中的任务在检查点停止";
  if (req.controlStatus === "cancelling") return "取消中：等待执行进程确认退出后释放工作区";
  if (req.controlStatus === "cancelled") return "已取消：如需继续请重新打开";
  if (req.businessStatus === "done") return "已完成";
  if (snapshot.decisions.some((d) => d.state === "open")) return "等待你处理上方的决策";
  if (req.businessStatus === "verifying") return "等待验收：在“验收”页签核对清单后确认";
  const running = snapshot.tasks.filter((t) => t.active && (t.state === "running" || t.state === "checking"));
  if (running.length) return `执行中：${running.map((t) => t.title).join("、")}`;
  const ready = snapshot.tasks.filter((t) => t.active && t.state === "ready");
  if (ready.length) return `等待执行槽位：${ready.map((t) => t.title).join("、")}`;
  const waiting = snapshot.tasks.filter((t) => t.active && (t.state === "waiting_dependencies" || t.state === "waiting_change"));
  if (waiting.length) return `等待依赖或修正：${waiting.map((t) => t.title).join("、")}`;
  return stageLabel(req.stage);
}

export function RequirementOverviewTab({ ctx }: { ctx: CollabDetailContext }) {
  const { snapshot, agents, repositories, projects } = ctx;
  const req = snapshot.requirement;
  const groups = groupTasksByRepository(snapshot.tasks);
  const blockers = topBlockers(snapshot, 6);
  const plan = currentPlanView(snapshot);
  const progress = requirementProgress(snapshot.counts);
  const usage = snapshot.usage as { totalMs?: number; budgetMs?: number | null; remainingMs?: number | null; confidence?: string; note?: string };
  const plans = [...snapshot.plans].sort((a, b) => Number(b.revision) - Number(a.revision));

  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <CollabDecisionList
        requirementId={req.id}
        decisions={snapshot.decisions}
        tasks={snapshot.tasks}
        agents={agents}
        repositories={repositories}
        onResolved={ctx.reload}
      />
      <Descriptions size="small" column={2} bordered>
        <Descriptions.Item label="主责智能体">{agentName(agents, req.ownerAgentId)}</Descriptions.Item>
        <Descriptions.Item label="主责项目">{projectName(projects, req.ownerProjectId)}</Descriptions.Item>
        <Descriptions.Item label="涉及">
          {snapshot.projects.length} 个项目 / {snapshot.counts.repositories} 个仓库
        </Descriptions.Item>
        <Descriptions.Item label="协作阶段">{stageLabel(req.stage)}</Descriptions.Item>
        <Descriptions.Item label="总进度" span={2}>
          <Progress percent={progress} size="small" style={{ maxWidth: 320 }} />
        </Descriptions.Item>
        <Descriptions.Item label="当前阻塞" span={2}>
          {blockers.length ? (
            <Space direction="vertical" size={2}>
              {blockers.map((b, i) => (
                <Typography.Text key={i}>
                  {b.needsDecision ? <Tag color="orange">需决策</Tag> : null}
                  {b.taskTitle}：{b.message}
                </Typography.Text>
              ))}
            </Space>
          ) : (
            "无"
          )}
        </Descriptions.Item>
        <Descriptions.Item label="下一步" span={2}>
          {nextStep(ctx)}
        </Descriptions.Item>
        <Descriptions.Item label="未关闭修正单">{openChanges(snapshot.changes).length}</Descriptions.Item>
        <Descriptions.Item label="用时 / 预算">
          {formatDuration(usage.totalMs ?? 0)} / {usage.budgetMs ? formatDuration(usage.budgetMs) : "不限"}
          {usage.confidence === "estimated" ? <Tag style={{ marginInlineStart: 6 }}>估算</Tag> : null}
        </Descriptions.Item>
      </Descriptions>

      <div>
        <div className="collab-section-title">各仓库</div>
        {groups.length ? (
          <Table
            size="small"
            pagination={false}
            rowKey={(g) => String(g.repositoryId ?? "none")}
            dataSource={groups}
            columns={[
              { title: "仓库", render: (_, g) => repoName(repositories, g.repositoryId) },
              {
                title: "状态",
                render: (_, g) => {
                  const cur = g.tasks.find((t) => t.state !== "succeeded" && t.state !== "cancelled") ?? g.tasks[g.tasks.length - 1];
                  const s = cur ? taskStateLabel(cur.state) : null;
                  return s ? <Tag color={s.tone}>{s.label}</Tag> : "—";
                },
              },
              {
                title: "说明",
                render: (_, g) => {
                  const cur = g.tasks.find((t) => t.state !== "succeeded" && t.state !== "cancelled");
                  if (!cur) return `${g.succeeded}/${g.tasks.length} 已完成`;
                  const why = snapshot.explanation.find((e) => e.taskId === cur.id)?.blockers[0]?.message;
                  return why ? `${cur.title}：${why}` : cur.title;
                },
              },
            ]}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未规划仓库任务" />
        )}
      </div>

      <div>
        <div className="collab-section-title">执行计划</div>
        {plan ? (
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            <Typography.Text>
              <Tag>v{plan.revision}</Tag>
              <Tag color={plan.state === "active" ? "green" : "default"}>{PLAN_STATE_LABEL[plan.state] ?? plan.state}</Tag>
              {plan.summary || "（计划未提供摘要）"}
            </Typography.Text>
            {plan.rationale ? <Typography.Text type="secondary">判断：{plan.rationale}</Typography.Text> : null}
          </Space>
        ) : (
          <Typography.Text type="secondary">主责智能体尚未发布计划</Typography.Text>
        )}
        {plans.length > 1 || snapshot.impacts.length ? (
          <Table
            style={{ marginTop: 8 }}
            size="small"
            pagination={false}
            rowKey={(p) => String(p.revision)}
            dataSource={plans}
            columns={[
              { title: "版本", width: 70, render: (_, p) => `v${String(p.revision)}` },
              { title: "状态", width: 90, render: (_, p) => PLAN_STATE_LABEL[String(p.state)] ?? String(p.state) },
              {
                title: "任务影响（沿用 / 重做 / 新增 / 取消）",
                render: (_, p) => {
                  const rows = snapshot.impacts.filter((i) => i.toPlanRevision === p.revision);
                  if (!rows.length) return "—";
                  return (
                    <Space size={4} wrap>
                      {rows.map((i, idx) => {
                        const meta = IMPACT_LABEL[String(i.action)] ?? { label: String(i.action), color: "default" };
                        return (
                          <Tag key={idx} color={meta.color} title={typeof i.reason === "string" ? i.reason : undefined}>
                            {meta.label} {String(i.taskKey)}
                          </Tag>
                        );
                      })}
                    </Space>
                  );
                },
              },
              { title: "时间", width: 160, render: (_, p) => formatTime(typeof p.createdAt === "number" ? p.createdAt : null) },
            ]}
          />
        ) : null}
      </div>

      {snapshot.revisions.length ? (
        <div>
          <div className="collab-section-title">需求修订</div>
          <Table
            size="small"
            pagination={false}
            rowKey="revision"
            dataSource={snapshot.revisions}
            columns={[
              { title: "版本", width: 70, render: (_, r) => `r${r.revision}` },
              { title: "类型", width: 100, render: (_, r) => REVISION_KIND_LABEL[r.kind] ?? r.kind },
              { title: "内容", render: (_, r) => <Typography.Text ellipsis={{ tooltip: r.input }}>{r.input}</Typography.Text> },
              { title: "处理", width: 110, render: (_, r) => REVISION_STATE_LABEL[r.state] ?? r.state },
              { title: "时间", width: 160, render: (_, r) => formatTime(r.createdAt) },
            ]}
          />
        </div>
      ) : null}

      {snapshot.sessions.length ? (
        <div>
          <div className="collab-section-title">会话</div>
          <Space wrap>
            {snapshot.sessions.map((s) => (
              <Button key={s.sessionId} size="small" onClick={() => openWorkspaceRequirementExecutionSession(s.sessionId)}>
                {s.relation === "origin" ? "原会话" : s.relation === "legacy" ? "历史会话" : "执行会话"} · {formatTime(s.createdAt)}
              </Button>
            ))}
          </Space>
        </div>
      ) : null}
      {req.legacyId ? <LegacyHistorySection requirementId={req.id} /> : null}
      {usage.note ? <Typography.Text type="secondary">{usage.note}</Typography.Text> : null}
    </Space>
  );
}
