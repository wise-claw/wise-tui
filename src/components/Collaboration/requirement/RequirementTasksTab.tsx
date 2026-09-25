import { App as AntApp, Button, Descriptions, Empty, Popconfirm, Space, Table, Tag, Typography } from "antd";
import {
  attemptStateLabel,
  formatCollabError,
  groupTasksByRepository,
  requestCollabStop,
  runCollabVerification,
  taskKindLabel,
  taskStateLabel,
} from "../../../services/collaboration";
import { openWorkspaceRequirementExecutionSession } from "../../../stores/workspaceMemoPanelStore";
import type { CollabTask } from "../../../types/collaboration";
import { agentName, formatTime, repoName, shortFields, taskTitle, type CollabDetailContext } from "./detailContext";

const GATE_LABEL: Record<string, string> = {
  artifact_ready: "产物可用",
  task_succeeded: "任务完成",
  contract_available: "契约可用",
};

function TaskDetail({ task, ctx }: { task: CollabTask; ctx: CollabDetailContext }) {
  const { message } = AntApp.useApp();
  const { snapshot, agents } = ctx;
  const deps = snapshot.dependencies.filter((d) => d.taskId === task.id);
  const attempts = snapshot.attempts.filter((a) => a.taskId === task.id).sort((a, b) => b.createdAt - a.createdAt);
  const checkpoint = snapshot.checkpoints.find((c) => c.taskId === task.id);
  const runs = snapshot.verificationRuns.filter((r) => r.taskId === task.id).sort((a, b) => b.startedAt - a.startedAt);
  const specLine = shortFields(task.spec, ["goal", "description", "summary", "responsibility"]);
  const acceptance = task.spec?.acceptance;

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <Descriptions size="small" column={2}>
        <Descriptions.Item label="执行者">{agentName(agents, task.executorAgentId)}</Descriptions.Item>
        <Descriptions.Item label="配置版本">{task.profileRevision ? `v${task.profileRevision}` : "—"}</Descriptions.Item>
        <Descriptions.Item label="失败次数">
          {task.failureCount} / {task.attemptBudget}
        </Descriptions.Item>
        <Descriptions.Item label="修正轮次">{task.repairRound ?? "—"}</Descriptions.Item>
        {specLine ? (
          <Descriptions.Item label="职责" span={2}>
            {specLine}
          </Descriptions.Item>
        ) : null}
        {Array.isArray(acceptance) && acceptance.length ? (
          <Descriptions.Item label="验收条件" span={2}>
            {acceptance.filter((a): a is string => typeof a === "string").join("；")}
          </Descriptions.Item>
        ) : null}
        {task.delegatedByTaskId ? (
          <Descriptions.Item label="委派自" span={2}>
            {taskTitle(snapshot.tasks, task.delegatedByTaskId)}（深度 {task.delegationDepth}）
          </Descriptions.Item>
        ) : null}
      </Descriptions>
      {deps.length ? (
        <div>
          <Typography.Text strong>依赖</Typography.Text>
          <ul className="collab-plain-list">
            {deps.map((d) => (
              <li key={d.id}>
                {taskTitle(snapshot.tasks, d.producerTaskId)} · {GATE_LABEL[d.gateKind] ?? d.gateKind}
                {d.artifactSelector ? ` · ${d.artifactSelector}` : ""}
                {d.requiredVersion ? ` ≥ v${d.requiredVersion}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {checkpoint ? (
        <div>
          <Typography.Text strong>检查点</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {checkpoint.resumeNotes || "（无恢复说明）"} · {formatTime(checkpoint.createdAt)}
          </Typography.Paragraph>
        </div>
      ) : null}
      <div>
        <Space style={{ justifyContent: "space-between", width: "100%" }}>
          <Typography.Text strong>执行尝试</Typography.Text>
          {task.repositoryId != null ? (
            <Button
              size="small"
              onClick={async () => {
                try {
                  const run = await runCollabVerification(task.id);
                  message[run.passed ? "success" : "warning"](run.passed ? "验证通过" : `验证未通过（退出码 ${run.exitCode ?? "—"}）`);
                  ctx.reload();
                } catch (e) {
                  message.error(formatCollabError(e));
                }
              }}
            >
              运行验证
            </Button>
          ) : null}
        </Space>
        <Table
          size="small"
          pagination={false}
          rowKey="id"
          dataSource={attempts}
          locale={{ emptyText: "尚未执行" }}
          columns={[
            {
              title: "状态",
              width: 100,
              render: (_, a) => {
                const s = attemptStateLabel(a.state);
                return <Tag color={s.tone}>{s.label}</Tag>;
              },
            },
            { title: "结果", render: (_, a) => [a.result, a.stopReason].filter(Boolean).join(" · ") || "—" },
            { title: "开始", width: 160, render: (_, a) => formatTime(a.startedAt ?? a.createdAt) },
            { title: "结束", width: 160, render: (_, a) => formatTime(a.finishedAt) },
            {
              title: "",
              width: 150,
              render: (_, a) => (
                <Space size={0}>
                  {a.sessionId ? (
                    <Button size="small" type="link" onClick={() => openWorkspaceRequirementExecutionSession(a.sessionId!)}>
                      会话
                    </Button>
                  ) : null}
                  {a.state === "claimed" || a.state === "running" ? (
                    <Popconfirm
                      title="请求停止该尝试？会在检查点保存进度"
                      onConfirm={() =>
                        void requestCollabStop(a.id, "user")
                          .then(ctx.reload)
                          .catch((e) => message.error(formatCollabError(e)))
                      }
                    >
                      <Button size="small" type="link" danger>
                        停止
                      </Button>
                    </Popconfirm>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </div>
      {runs.length ? (
        <div>
          <Typography.Text strong>验证记录</Typography.Text>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={runs}
            columns={[
              { title: "结果", width: 80, render: (_, r) => <Tag color={r.passed ? "success" : "error"}>{r.passed ? "通过" : "失败"}</Tag> },
              { title: "命令", render: (_, r) => <code>{r.command}</code> },
              { title: "提交", width: 110, render: (_, r) => `${r.headCommit?.slice(0, 8) ?? "—"}${r.dirty ? " *" : ""}` },
              { title: "时间", width: 160, render: (_, r) => formatTime(r.startedAt) },
            ]}
            expandable={{
              rowExpandable: (r) => Boolean(r.outputTail),
              expandedRowRender: (r) => <pre className="collab-pre">{r.outputTail}</pre>,
            }}
          />
        </div>
      ) : null}
    </Space>
  );
}

export function RequirementTasksTab({ ctx }: { ctx: CollabDetailContext }) {
  const groups = groupTasksByRepository(ctx.snapshot.tasks);
  const history = ctx.snapshot.tasks.filter((t) => !t.active);
  if (!groups.length) return <Empty description="尚未规划仓库任务" />;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {groups.map((g) => (
        <div key={String(g.repositoryId ?? "none")}>
          <div className="collab-section-title">
            {repoName(ctx.repositories, g.repositoryId)} · {g.succeeded}/{g.tasks.length} 已完成
            {g.blocked ? <Tag color="error" style={{ marginInlineStart: 8 }}>阻塞 {g.blocked}</Tag> : null}
          </div>
          <Table<CollabTask>
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={g.tasks}
            expandable={{ expandedRowRender: (t) => <TaskDetail task={t} ctx={ctx} /> }}
            columns={[
              { title: "任务", render: (_, t) => <Typography.Text>{t.title}</Typography.Text> },
              { title: "类型", width: 80, render: (_, t) => taskKindLabel(t.kind) },
              {
                title: "状态",
                width: 100,
                render: (_, t) => {
                  const s = taskStateLabel(t.state);
                  return <Tag color={s.tone}>{s.label}</Tag>;
                },
              },
              {
                title: "原因 / 下一步",
                render: (_, t) =>
                  ctx.snapshot.explanation.find((e) => e.taskId === t.id)?.blockers[0]?.message ?? (t.nextAction || "—"),
              },
            ]}
          />
        </div>
      ))}
      {history.length ? (
        <details>
          <summary>历史任务（{history.length}，已被新计划替代，仅作记录）</summary>
          <ul className="collab-plain-list">
            {history.map((t) => (
              <li key={t.id}>
                {t.title} · {taskStateLabel(t.state).label} · 计划 v{t.planRevision}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Space>
  );
}
