import { useState } from "react";
import { App as AntApp, Button, Empty, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import {
  artifactValidationLabel,
  changeStateLabel,
  formatCollabError,
  invalidateCollabArtifact,
  latestArtifactVersions,
  markCollabRuntimeStopped,
  mergeCollabChanges,
  revalidateCollabArtifact,
} from "../../../services/collaboration";
import { runShellCommand } from "../../../services/terminal";
import type { CollabArtifactVersion, CollabChangeRequest, CollabRuntimeResource } from "../../../types/collaboration";
import { formatTime, repoName, repoPath, safeJson, shortFields, taskTitle, type CollabDetailContext } from "./detailContext";

export const COMPAT_LABEL: Record<string, { label: string; color: string }> = {
  compatible: { label: "兼容", color: "success" },
  breaking: { label: "破坏性", color: "error" },
  unknown: { label: "兼容性未知", color: "warning" },
};

const ACK_LABEL: Record<string, { label: string; color: string }> = {
  waiting: { label: "等待复验", color: "processing" },
  passed: { label: "复验通过", color: "success" },
  failed: { label: "复验失败", color: "error" },
  transferred: { label: "已转移", color: "default" },
  released: { label: "已释放", color: "default" },
};

export const CATEGORY_LABEL: Record<string, string> = {
  contract_violation: "契约违约",
  consumer_bug: "消费方缺陷",
  environment: "环境问题",
  scope: "范围问题",
  unknown: "待分派",
};

export function ArtifactVersionViewModal({ version, onClose }: { version: CollabArtifactVersion | null; onClose: () => void }) {
  return (
    <Modal open={version != null} title={version ? `${version.name}@${version.version}` : ""} footer={null} width={760} onCancel={onClose}>
      {version ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            契约哈希 {version.contractHash.slice(0, 12)} · 运行目标 {version.runtimeTargetId}
            {version.endpoint ? ` · ${version.endpoint}` : ""}
            {version.deployedCommit ? ` · 部署 ${version.deployedCommit.slice(0, 8)}` : ""}
          </Typography.Text>
          {version.invalidReason ? <Typography.Text type="danger">失效原因：{version.invalidReason}</Typography.Text> : null}
          <Typography.Text strong>契约</Typography.Text>
          <pre className="collab-pre">{safeJson(version.contract)}</pre>
          <Typography.Text strong>测试证据</Typography.Text>
          <pre className="collab-pre">{safeJson(version.testEvidence)}</pre>
          <Typography.Text strong>校验明细</Typography.Text>
          <pre className="collab-pre">{safeJson(version.validation)}</pre>
        </Space>
      ) : null}
    </Modal>
  );
}

function ArtifactsSection({ ctx }: { ctx: CollabDetailContext }) {
  const { message } = AntApp.useApp();
  const { snapshot, repositories } = ctx;
  const [viewing, setViewing] = useState<CollabArtifactVersion | null>(null);
  const latest = latestArtifactVersions(snapshot.artifacts);
  const historyOf = (a: CollabArtifactVersion) =>
    snapshot.artifacts.filter((v) => v.artifactId === a.artifactId && v.id !== a.id).sort((x, y) => y.version - x.version);
  const consumersOf = (versionId: string) => snapshot.artifactConsumers.filter((c) => c.artifactVersionId === versionId);

  const invalidate = (v: CollabArtifactVersion) => {
    let reason = "";
    Modal.confirm({
      title: `将 ${v.name} v${v.version} 标记失效？`,
      content: <Input.TextArea autoSize={{ minRows: 2 }} placeholder="失效原因（必填）" onChange={(e) => (reason = e.target.value)} />,
      okText: "标记失效",
      okType: "danger",
      onOk: async () => {
        if (!reason.trim()) {
          message.warning("请填写失效原因");
          throw new Error("reason required");
        }
        try {
          await invalidateCollabArtifact(v.id, reason.trim());
          ctx.reload();
        } catch (e) {
          message.error(formatCollabError(e));
        }
      },
    });
  };

  const columns = [
    { title: "产物", render: (_: unknown, v: CollabArtifactVersion) => `${v.name}@${v.version}${v.isDraft ? "（草稿）" : ""}` },
    { title: "类型", width: 90, dataIndex: "kind" },
    {
      title: "校验",
      width: 90,
      render: (_: unknown, v: CollabArtifactVersion) => {
        const s = artifactValidationLabel(v.validationState);
        return <Tag color={s.tone} title={v.invalidReason ?? undefined}>{s.label}</Tag>;
      },
    },
    {
      title: "兼容性",
      width: 100,
      render: (_: unknown, v: CollabArtifactVersion) => {
        const c = COMPAT_LABEL[v.compatibility] ?? { label: v.compatibility, color: "default" };
        return <Tag color={c.color}>{c.label}</Tag>;
      },
    },
    { title: "来源", render: (_: unknown, v: CollabArtifactVersion) => `${repoName(repositories, v.repositoryId)} · ${v.commitSha?.slice(0, 8) ?? "无提交"}` },
    { title: "消费者", width: 70, render: (_: unknown, v: CollabArtifactVersion) => consumersOf(v.id).length },
    {
      title: "",
      width: 190,
      render: (_: unknown, v: CollabArtifactVersion) => (
        <Space size={0}>
          <Button size="small" type="link" onClick={() => setViewing(v)}>
            查看
          </Button>
          <Button
            size="small"
            type="link"
            onClick={() =>
              void revalidateCollabArtifact(v.id)
                .then((r) => {
                  message.info(`校验结果：${artifactValidationLabel(r.validationState).label}`);
                  ctx.reload();
                })
                .catch((e) => message.error(formatCollabError(e)))
            }
          >
            重新校验
          </Button>
          {v.validationState !== "invalidated" ? (
            <Button size="small" type="link" danger onClick={() => invalidate(v)}>
              失效
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="collab-section-title">接口与交付物</div>
      <Table<CollabArtifactVersion>
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={latest}
        locale={{ emptyText: "尚无交付物" }}
        columns={columns}
        expandable={{
          rowExpandable: (v) => historyOf(v).length > 0 || consumersOf(v.id).length > 0,
          expandedRowRender: (v) => (
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              {consumersOf(v.id).length ? (
                <div>
                  <Typography.Text strong>消费者</Typography.Text>
                  <ul className="collab-plain-list">
                    {consumersOf(v.id).map((c) => (
                      <li key={c.taskId}>
                        {taskTitle(snapshot.tasks, c.taskId)} · 验证 {c.verification} · 影响 {c.impact}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {historyOf(v).length ? (
                <Table<CollabArtifactVersion> size="small" pagination={false} rowKey="id" dataSource={historyOf(v)} columns={columns} />
              ) : null}
            </Space>
          ),
        }}
      />
      <ArtifactVersionViewModal version={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function ChangesSection({ ctx }: { ctx: CollabDetailContext }) {
  const { message } = AntApp.useApp();
  const { snapshot } = ctx;
  const [merging, setMerging] = useState<{ dup: CollabChangeRequest; primary: string | null } | null>(null);
  const live = snapshot.changes.filter((c) => !c.mergedInto);

  return (
    <>
      <div className="collab-section-title">修正单</div>
      <Table<CollabChangeRequest>
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={live}
        locale={{ emptyText: "没有修正单" }}
        columns={[
          { title: "编号", width: 90, dataIndex: "code" },
          { title: "问题", render: (_, c) => shortFields(c.payload, ["title", "summary", "expected", "actual"]) || "—" },
          { title: "分类", width: 90, render: (_, c) => CATEGORY_LABEL[c.category] ?? c.category },
          {
            title: "状态",
            width: 100,
            render: (_, c) => {
              const s = changeStateLabel(c.state);
              return <Tag color={s.tone}>{s.label}</Tag>;
            },
          },
          { title: "轮次", width: 70, render: (_, c) => `${c.round}/${c.roundBudget}` },
          {
            title: "",
            width: 80,
            render: (_, c) =>
              live.length > 1 && !["closed", "verified", "rejected"].includes(c.state) ? (
                <Button size="small" type="link" onClick={() => setMerging({ dup: c, primary: null })}>
                  合并
                </Button>
              ) : null,
          },
        ]}
        expandable={{
          expandedRowRender: (c) => (
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              <Typography.Text type="secondary">
                报告方 {taskTitle(snapshot.tasks, c.reporterTaskId)} → 责任方 {taskTitle(snapshot.tasks, c.producerTaskId)}
                {c.currentRepairTaskId ? ` · 修复任务 ${taskTitle(snapshot.tasks, c.currentRepairTaskId)}` : ""}
              </Typography.Text>
              <Space size={4} wrap>
                {c.consumers.map((k) => {
                  const a = ACK_LABEL[k.ackStatus] ?? { label: k.ackStatus, color: "default" };
                  return (
                    <Tag key={`${k.consumerTaskId}:${k.round}`} color={a.color}>
                      {taskTitle(snapshot.tasks, k.consumerTaskId)} · 第 {k.round} 轮 · {a.label}
                    </Tag>
                  );
                })}
              </Space>
              <pre className="collab-pre">{safeJson(c.payload)}</pre>
            </Space>
          ),
        }}
      />
      <Modal
        open={merging != null}
        title={merging ? `将 ${merging.dup.code} 合并到…` : ""}
        okText="合并"
        okButtonProps={{ disabled: !merging?.primary }}
        onCancel={() => setMerging(null)}
        onOk={async () => {
          if (!merging?.primary) return;
          try {
            await mergeCollabChanges(merging.dup.id, merging.primary);
            message.success("已合并，等待关系已转移到主修正单");
            setMerging(null);
            ctx.reload();
          } catch (e) {
            message.error(formatCollabError(e));
          }
        }}
      >
        <Select
          style={{ width: "100%" }}
          placeholder="主修正单"
          value={merging?.primary ?? undefined}
          options={live.filter((c) => c.id !== merging?.dup.id).map((c) => ({ value: c.id, label: `${c.code} · ${changeStateLabel(c.state).label}` }))}
          onChange={(v: string) => merging && setMerging({ ...merging, primary: v })}
        />
      </Modal>
    </>
  );
}

/** 环境资源：停止命令由智能体登记，只有用户确认后才执行，不自动运行。 */
export function RuntimeResourcesSection({
  resources,
  ctx,
  resolveCwd,
  onChanged,
  title = "环境资源",
}: {
  resources: CollabRuntimeResource[];
  ctx: CollabDetailContext | null;
  resolveCwd?: (resource: CollabRuntimeResource) => Promise<string | null>;
  onChanged?: () => void;
  title?: string;
}) {
  const { message } = AntApp.useApp();
  if (!resources.length) return null;

  const cwdFor = async (r: CollabRuntimeResource): Promise<string | null> => {
    if (resolveCwd) return resolveCwd(r);
    const task = ctx?.snapshot.tasks.find((t) => t.id === r.ownerTaskId);
    return ctx ? repoPath(ctx.repositories, task?.repositoryId) : null;
  };

  const stop = async (r: CollabRuntimeResource, runCommand: boolean) => {
    try {
      if (runCommand) {
        const cwd = await cwdFor(r);
        if (!cwd) throw new Error("找不到执行目录，请手动停止后点“我已手动停止”");
        const out = await runShellCommand(cwd, r.stopMethod);
        if (out.exit_code !== 0) throw new Error(`停止命令失败（${out.exit_code}）：${(out.stderr || out.stdout).slice(-300)}`);
      }
      await markCollabRuntimeStopped(r.id);
      message.success(`${r.name} 已标记停止`);
      ctx?.reload();
      onChanged?.();
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  return (
    <>
      <div className="collab-section-title">{title}</div>
      <Table<CollabRuntimeResource>
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={resources}
        columns={[
          { title: "资源", render: (_, r) => `${r.name}（${r.kind}）` },
          { title: "地址", render: (_, r) => r.endpoint ?? (r.port ? `:${r.port}` : "—") },
          {
            title: "状态",
            width: 110,
            render: (_, r) => (
              <Tag color={r.state === "running" ? "processing" : r.state === "stop_requested" ? "warning" : "default"}>
                {r.state === "running" ? "运行中" : r.state === "stop_requested" ? "待确认停止" : "已停止"}
              </Tag>
            ),
          },
          { title: "使用中", width: 70, render: (_, r) => r.activeConsumers.length },
          { title: "登记时间", width: 160, render: (_, r) => formatTime(r.createdAt) },
          {
            title: "",
            width: 200,
            render: (_, r) =>
              r.state === "stop_requested" ? (
                <Space size={0}>
                  <Popconfirm
                    title="执行登记的停止命令？"
                    description={<code className="collab-inline-code">{r.stopMethod}</code>}
                    onConfirm={() => void stop(r, true)}
                  >
                    <Button size="small" type="link">
                      执行停止
                    </Button>
                  </Popconfirm>
                  <Button size="small" type="link" onClick={() => void stop(r, false)}>
                    我已手动停止
                  </Button>
                </Space>
              ) : null,
          },
        ]}
      />
    </>
  );
}

export function RequirementArtifactsTab({ ctx }: { ctx: CollabDetailContext }) {
  const empty = !ctx.snapshot.artifacts.length && !ctx.snapshot.changes.length && !ctx.snapshot.runtimeResources.length;
  if (empty) return <Empty description="尚无交付物、修正单或环境资源" />;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <ArtifactsSection ctx={ctx} />
      <ChangesSection ctx={ctx} />
      <RuntimeResourcesSection resources={ctx.snapshot.runtimeResources} ctx={ctx} />
    </Space>
  );
}
