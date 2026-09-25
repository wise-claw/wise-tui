import { useEffect, useState } from "react";
import { Alert, App as AntApp, Button, Checkbox, Drawer, Input, Modal, Popconfirm, Select, Space, Spin, Tabs, Tag, Typography } from "antd";
import { useCollabRequirementSnapshot } from "../../../hooks/useCollabRequirementSnapshot";
import {
  controlCollabRequirement,
  formatCollabError,
  listCollabAgents,
  projectSelectOptions,
  newCollabRequestId,
  requirementStatusLabel,
  reviseCollabRequirement,
  stageLabel,
  transferCollabOwner,
} from "../../../services/collaboration";
import { listProjects } from "../../../services/projectState";
import { loadRepositories } from "../../../services/repository";
import { closeCollabRequirementDetail, useOpenCollabRequirementDetail } from "../../../stores/collabUiStore";
import type { ProjectItem, Repository } from "../../../types";
import type { CollabAgentSummary } from "../../../types/collaboration";
import { RequirementAcceptanceTab } from "./RequirementAcceptanceTab";
import { RequirementArtifactsTab } from "./RequirementArtifactsTab";
import { RequirementKnowledgeTab } from "./RequirementKnowledgeTab";
import { RequirementMessagesTab } from "./RequirementMessagesTab";
import { RequirementOverviewTab } from "./RequirementOverviewTab";
import { RequirementTasksTab } from "./RequirementTasksTab";
import { agentName, type CollabDetailContext } from "./detailContext";
import "../collaboration.css";

const TAB_KEYS = ["overview", "tasks", "artifacts", "messages", "knowledge", "acceptance"] as const;

/** 需求详情：概览 / 仓库任务 / 接口与产物 / 协作消息 / 共享知识 / 验收。全局唯一，由卡片、列表、通知打开。 */
export function CollabRequirementDetailDrawer() {
  const { message } = AntApp.useApp();
  const { requirementId, tab: requestedTab } = useOpenCollabRequirementDetail();
  const { snapshot, error, loading, reload } = useCollabRequirementSnapshot(requirementId);
  const [tab, setTab] = useState<string>("overview");
  const [agents, setAgents] = useState<CollabAgentSummary[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [revising, setRevising] = useState<{ text: string; scopeChange: boolean } | null>(null);
  const [transferring, setTransferring] = useState<{ agentId: string | null; projectId: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!requirementId) return;
    setTab(requestedTab && (TAB_KEYS as readonly string[]).includes(requestedTab) ? requestedTab : "overview");
    void listCollabAgents(true)
      .then(setAgents)
      .catch(() => setAgents([]));
    void loadRepositories()
      .then(setRepositories)
      .catch(() => setRepositories([]));
    void listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [requestedTab, requirementId]);

  const req = snapshot?.requirement ?? null;

  const control = async (action: "pause" | "resume" | "cancel" | "reopen") => {
    if (!req) return;
    setBusy(action);
    try {
      await controlCollabRequirement({ requestId: newCollabRequestId(action), requirementId: req.id, action, expectedRevision: req.revision });
      reload();
    } catch (e) {
      message.error(formatCollabError(e));
      reload();
    } finally {
      setBusy(null);
    }
  };

  const revise = async () => {
    if (!req || !revising?.text.trim()) return;
    setBusy("revise");
    try {
      const next = await reviseCollabRequirement({
        requestId: newCollabRequestId("revise"),
        requirementId: req.id,
        expectedRevision: req.revision,
        input: revising.text.trim(),
        scopeChange: revising.scopeChange,
      });
      message.success(
        revising.scopeChange && next.activePlanRevision > 0
          ? "已接收补充：扩大范围的变更提案等待确认"
          : "已接收补充：受影响任务将在检查点应用",
      );
      setRevising(null);
      reload();
    } catch (e) {
      message.error(formatCollabError(e));
    } finally {
      setBusy(null);
    }
  };

  const transfer = async () => {
    if (!req || !transferring?.agentId) return;
    setBusy("transfer");
    try {
      await transferCollabOwner({
        requestId: newCollabRequestId("transfer"),
        requirementId: req.id,
        targetAgentId: transferring.agentId,
        expectedRevision: req.revision,
        ownerProjectId: transferring.projectId,
      });
      message.success("主责已移交：旧主责在检查点释放，新主责接手后续规划");
      setTransferring(null);
      reload();
    } catch (e) {
      message.error(formatCollabError(e));
    } finally {
      setBusy(null);
    }
  };

  const ctx: CollabDetailContext | null = snapshot ? { snapshot, agents, repositories, projects, reload } : null;
  const status = req ? requirementStatusLabel(req) : null;
  const cancelled = req?.controlStatus === "cancelled";
  const done = req?.businessStatus === "done";

  return (
    <Drawer
      open={requirementId != null}
      width={920}
      onClose={closeCollabRequirementDetail}
      destroyOnClose
      title={
        req ? (
          <Space direction="vertical" size={2} style={{ width: "100%" }}>
            <Space size={8} wrap>
              <Typography.Text strong>{req.title}</Typography.Text>
              {status ? <Tag color={status.tone}>{status.label}</Tag> : null}
              <Tag>{stageLabel(req.stage)}</Tag>
              <Typography.Text type="secondary">
                主责 {agentName(agents, req.ownerAgentId)} · r{req.requirementRevision} · 计划 v{req.activePlanRevision || "—"}
              </Typography.Text>
            </Space>
          </Space>
        ) : (
          "需求详情"
        )
      }
      extra={
        req ? (
          <Space size={6} wrap>
            {!cancelled ? (
              <Button size="small" onClick={() => setRevising({ text: "", scopeChange: false })}>
                {done ? "继续此需求" : "补充要求"}
              </Button>
            ) : null}
            {req.controlStatus === "active" && !done ? (
              <Button size="small" loading={busy === "pause"} onClick={() => void control("pause")}>
                暂停协作
              </Button>
            ) : null}
            {req.controlStatus === "paused" || req.controlStatus === "pausing" ? (
              <Button size="small" loading={busy === "resume"} onClick={() => void control("resume")}>
                恢复
              </Button>
            ) : null}
            {cancelled ? (
              <Button size="small" loading={busy === "reopen"} onClick={() => void control("reopen")}>
                重新打开
              </Button>
            ) : null}
            {!cancelled && !done ? (
              <Button size="small" onClick={() => setTransferring({ agentId: null, projectId: req.ownerProjectId })}>
                移交主责
              </Button>
            ) : null}
            {!cancelled && req.controlStatus !== "cancelling" && !done ? (
              <Popconfirm
                title="立即取消该需求？"
                description="停止新执行并请求停止运行中的任务；记录部分结果，不会回滚已修改的代码。"
                onConfirm={() => void control("cancel")}
              >
                <Button size="small" danger loading={busy === "cancel"}>
                  取消需求
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        ) : null
      }
    >
      {error && !snapshot ? <Alert type="error" showIcon message={formatCollabError(error)} /> : null}
      {!ctx ? (
        loading ? <Spin /> : null
      ) : (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: "overview", label: "概览", children: <RequirementOverviewTab ctx={ctx} /> },
            { key: "tasks", label: `仓库任务 (${ctx.snapshot.tasks.filter((t) => t.active).length})`, children: <RequirementTasksTab ctx={ctx} /> },
            { key: "artifacts", label: "接口与产物", children: <RequirementArtifactsTab ctx={ctx} /> },
            { key: "messages", label: "协作消息", children: <RequirementMessagesTab ctx={ctx} /> },
            { key: "knowledge", label: "共享知识", children: <RequirementKnowledgeTab ctx={ctx} /> },
            { key: "acceptance", label: "验收", children: <RequirementAcceptanceTab ctx={ctx} /> },
          ]}
        />
      )}

      <Modal
        open={revising != null}
        title={done ? "继续已完成需求" : "补充要求"}
        okText="发送补充"
        okButtonProps={{ loading: busy === "revise", disabled: !revising?.text.trim() }}
        onCancel={() => setRevising(null)}
        onOk={() => void revise()}
        destroyOnClose
      >
        {revising ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Input.TextArea
              autoFocus
              autoSize={{ minRows: 4, maxRows: 10 }}
              placeholder="例如：字段单位仍用分，页面按元展示"
              value={revising.text}
              onChange={(e) => setRevising({ ...revising, text: e.target.value })}
            />
            {done ? (
              <Typography.Text type="secondary">将以新一轮规划与验收继续；原完成证据与验收记录保留。</Typography.Text>
            ) : null}
            <Checkbox checked={revising.scopeChange} onChange={(e) => setRevising({ ...revising, scopeChange: e.target.checked })}>
              这是扩大业务范围的变更（保存为提案，确认后才修改计划）
            </Checkbox>
          </Space>
        ) : null}
      </Modal>

      <Modal
        open={transferring != null}
        title="移交主责"
        okText="移交"
        okButtonProps={{ loading: busy === "transfer", disabled: !transferring?.agentId }}
        onCancel={() => setTransferring(null)}
        onOk={() => void transfer()}
      >
        {transferring ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Select
              style={{ width: "100%" }}
              placeholder="新的主责智能体"
              value={transferring.agentId ?? undefined}
              options={agents
                .filter((a) => a.status === "enabled" && a.id !== req?.ownerAgentId)
                .map((a) => ({ value: a.id, label: a.name }))}
              onChange={(v: string) => setTransferring({ ...transferring, agentId: v })}
            />
            <Select
              style={{ width: "100%" }}
              allowClear
              placeholder="主责项目（留空沿用）"
              value={transferring.projectId ?? undefined}
              options={projectSelectOptions(projects, repositories)}
              onChange={(v?: string) => setTransferring({ ...transferring, projectId: v ?? null })}
            />
            <Typography.Text type="secondary">移交会保存检查点、释放旧租约，并为新主责生成新的配置快照。</Typography.Text>
          </Space>
        ) : null}
      </Modal>
    </Drawer>
  );
}
