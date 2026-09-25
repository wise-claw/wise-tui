import { useState } from "react";
import { Alert, App as AntApp, Button, Empty, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import {
  acceptCollabRequirement,
  formatCollabError,
  isCollabErrorCode,
  newCollabRequestId,
  normalizeCollabError,
  refreshCollabAcceptance,
  taskStateLabel,
} from "../../../services/collaboration";
import { formatTime, repoName, taskTitle, type CollabDetailContext } from "./detailContext";

interface ManifestTask {
  id: string;
  key: string;
  kind: string;
  title: string;
  repositoryId: number | null;
  specRevision: number;
  state: string;
}
interface ManifestArtifact {
  id: string;
  name: string;
  version: number;
  commitSha: string | null;
  compatibility: string;
  contractHash: string;
}
interface ManifestEvidence {
  id: string;
  taskId: string;
  command: string;
  passed: boolean;
  headCommit: string | null;
  dirty: boolean;
}
interface ManifestChange {
  id: string;
  code: string;
  state: string;
  round: number;
}

function arr<T>(v: unknown, guard: (x: Record<string, unknown>) => boolean): T[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === "object" && x !== null && guard(x as Record<string, unknown>)) as T[]) : [];
}

const STATE_LABEL: Record<string, { label: string; color: string }> = {
  current: { label: "当前清单", color: "processing" },
  stale: { label: "已过期", color: "warning" },
  accepted: { label: "已通过", color: "success" },
  rejected: { label: "已退回", color: "error" },
};

/** 验收：展示 仓库 → 提交 → 交付包 → 测试 → 修正单 的对应关系；提交时绑定清单版本与哈希，页面陈旧则被拒并刷新。 */
export function RequirementAcceptanceTab({ ctx }: { ctx: CollabDetailContext }) {
  const { message } = AntApp.useApp();
  const { snapshot, repositories } = ctx;
  const req = snapshot.requirement;
  const manifest = snapshot.acceptance;
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [reopen, setReopen] = useState<string[]>([]);

  const content = (manifest?.manifest ?? {}) as Record<string, unknown>;
  const tasks = arr<ManifestTask>(content.tasks, (x) => typeof x.id === "string");
  const artifacts = arr<ManifestArtifact>(content.artifacts, (x) => typeof x.id === "string");
  const evidence = arr<ManifestEvidence>(content.evidence, (x) => typeof x.id === "string");
  const changes = arr<ManifestChange>(content.changes, (x) => typeof x.id === "string");
  const openDecisionCount = typeof content.openDecisions === "number" ? content.openDecisions : 0;

  const refresh = async (silent = false) => {
    setBusy("refresh");
    try {
      await refreshCollabAcceptance(req.id);
      if (!silent) message.success("已生成最新验收清单");
      ctx.reload();
    } catch (e) {
      message.error(formatCollabError(e));
    } finally {
      setBusy(null);
    }
  };

  const submit = async (reject: boolean) => {
    if (!manifest) return;
    setBusy(reject ? "reject" : "accept");
    try {
      await acceptCollabRequirement({
        requestId: newCollabRequestId(reject ? "reject" : "accept"),
        requirementId: req.id,
        manifestRevision: manifest.revision,
        manifestHash: manifest.contentHash,
        expectedRevision: req.revision,
        note,
        reject,
        reopenTaskIds: reject ? reopen : [],
      });
      message.success(reject ? "已退回，受影响任务已重开" : "验收通过，需求完成");
      setRejecting(false);
      setNote("");
      setReopen([]);
      ctx.reload();
    } catch (e) {
      const err = normalizeCollabError(e);
      if (isCollabErrorCode(err, "STALE_ACCEPTANCE") || isCollabErrorCode(err, "REVISION_CONFLICT")) {
        message.warning("验收清单已变化，已刷新为最新版本，请重新核对");
        await refresh(true);
      } else {
        const blockers = (err.details as { blockers?: unknown } | undefined)?.blockers;
        message.error(Array.isArray(blockers) && blockers.length ? `${formatCollabError(err)}：${blockers.join("；")}` : formatCollabError(err));
      }
    } finally {
      setBusy(null);
    }
  };

  if (!manifest) {
    return (
      <Empty description={req.businessStatus === "verifying" ? "尚未生成验收清单" : "所有必需任务完成、阻塞修正单关闭后进入验收"}>
        <Button loading={busy === "refresh"} onClick={() => void refresh()}>
          生成验收清单
        </Button>
      </Empty>
    );
  }

  const st = STATE_LABEL[manifest.state] ?? { label: manifest.state, color: "default" };
  const canDecide = manifest.state === "current" && req.businessStatus === "verifying" && req.controlStatus === "active";

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Space wrap>
        <Tag color={st.color}>{st.label}</Tag>
        <Typography.Text>
          清单 v{manifest.revision} · 哈希 {manifest.contentHash.slice(0, 12)} · 需求 r{String(content.requirementRevision ?? "—")} · 计划 v
          {String(content.planRevision ?? "—")} · {formatTime(manifest.updatedAt)}
        </Typography.Text>
        <Button size="small" loading={busy === "refresh"} onClick={() => void refresh()}>
          刷新清单
        </Button>
      </Space>
      {manifest.state === "stale" ? <Alert type="warning" showIcon message="清单生成后有新的变更，请刷新后重新核对" /> : null}
      {openDecisionCount ? <Alert type="warning" showIcon message={`仍有 ${openDecisionCount} 个待处理决策`} /> : null}
      {req.acceptancePolicy === "machine" ? (
        <Alert type="info" showIcon message="该需求配置为机器验收：满足条件时自动完成，仍可人工退回" />
      ) : null}

      <div className="collab-section-title">仓库 → 提交 → 交付 → 测试</div>
      <Table<ManifestTask>
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={tasks}
        columns={[
          { title: "仓库", render: (_, t) => repoName(repositories, t.repositoryId) },
          { title: "任务", dataIndex: "title" },
          {
            title: "状态",
            width: 90,
            render: (_, t) => {
              const s = taskStateLabel(t.state);
              return <Tag color={s.tone}>{s.label}</Tag>;
            },
          },
          {
            title: "测试证据",
            render: (_, t) => {
              const ev = evidence.filter((e) => e.taskId === t.id);
              if (!ev.length) return <Typography.Text type="secondary">无</Typography.Text>;
              return (
                <Space direction="vertical" size={0}>
                  {ev.map((e) => (
                    <Typography.Text key={e.id} type={e.passed ? undefined : "danger"}>
                      {e.passed ? "✓" : "✗"} <code>{e.command}</code> @ {e.headCommit?.slice(0, 8) ?? "—"}
                      {e.dirty ? "（工作区有未提交修改）" : ""}
                    </Typography.Text>
                  ))}
                </Space>
              );
            },
          },
        ]}
      />
      <div className="collab-section-title">交付物</div>
      <Table<ManifestArtifact>
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={artifacts}
        locale={{ emptyText: "无有效交付物" }}
        columns={[
          { title: "产物", render: (_, a) => `${a.name}@${a.version}` },
          { title: "提交", width: 110, render: (_, a) => a.commitSha?.slice(0, 8) ?? "—" },
          { title: "兼容性", width: 100, dataIndex: "compatibility" },
          { title: "契约哈希", width: 120, render: (_, a) => a.contractHash.slice(0, 10) },
        ]}
      />
      {changes.length ? (
        <>
          <div className="collab-section-title">修正单</div>
          <Space size={4} wrap>
            {changes.map((c) => (
              <Tag key={c.id} color={["verified", "closed", "rejected"].includes(c.state) ? "default" : "warning"}>
                {c.code} · {c.state} · 第 {c.round} 轮
              </Tag>
            ))}
          </Space>
        </>
      ) : null}

      {canDecide ? (
        <Space>
          <Popconfirm title={`确认验收通过清单 v${manifest.revision}？`} onConfirm={() => void submit(false)}>
            <Button type="primary" loading={busy === "accept"}>
              验收通过
            </Button>
          </Popconfirm>
          <Button danger onClick={() => setRejecting(true)}>
            退回
          </Button>
        </Space>
      ) : null}
      {manifest.conclusion ? (
        <Typography.Text type="secondary">
          结论：{(manifest.conclusion as { note?: unknown }).note ? String((manifest.conclusion as { note?: unknown }).note) : "—"}
        </Typography.Text>
      ) : null}

      <Modal
        open={rejecting}
        title="退回验收"
        okText="退回"
        okButtonProps={{ danger: true, loading: busy === "reject", disabled: !note.trim() }}
        onCancel={() => setRejecting(false)}
        onOk={() => void submit(true)}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text type="secondary">只重开选中的任务；其他已完成仓库的结果保留，受新接口版本影响的消费者会重新验证。</Typography.Text>
          <Select
            mode="multiple"
            style={{ width: "100%" }}
            placeholder="需要重开的任务"
            value={reopen}
            options={tasks.map((t) => ({ value: t.id, label: `${repoName(repositories, t.repositoryId)} · ${taskTitle(snapshot.tasks, t.id)}` }))}
            onChange={setReopen}
          />
          <Input.TextArea autoSize={{ minRows: 3 }} placeholder="退回原因（必填）" value={note} onChange={(e) => setNote(e.target.value)} />
        </Space>
      </Modal>
    </Space>
  );
}
