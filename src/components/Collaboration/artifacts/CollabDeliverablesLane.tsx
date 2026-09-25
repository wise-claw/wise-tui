import { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntApp, Button, Empty, Segmented, Space, Table, Tag, Tooltip } from "antd";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { Repository } from "../../../types";
import type { CollabArtifactVersion, CollabChangeRequest, CollabDeliverables } from "../../../types/collaboration";
import {
  artifactValidationLabel,
  changeStateLabel,
  formatCollabError,
  listCollabDeliverables,
  onCollabChanged,
  requirementStatusLabel,
} from "../../../services/collaboration";
import { openCollabRequirementDetail } from "../../../stores/collabUiStore";
import { ArtifactVersionViewModal, CATEGORY_LABEL, COMPAT_LABEL } from "../requirement/RequirementArtifactsTab";
import { formatTime, repoName } from "../requirement/detailContext";
import "../collaboration.css";

interface Props {
  repositories: Repository[];
  /** 为空表示全部仓库。 */
  repositoryId: number | null;
  query: string;
}

const EMPTY: CollabDeliverables = { artifacts: [], changes: [], requirements: {}, tasks: {} };

function evidenceCount(v: CollabArtifactVersion): number {
  return Array.isArray(v.testEvidence) ? v.testEvidence.length : v.testEvidence ? 1 : 0;
}

/** 产物检查台中的「跨仓库交付」：接口包、代码版本、测试证据与修正记录，均可跳转需求详情验收。 */
export function CollabDeliverablesLane({ repositories, repositoryId, query }: Props) {
  const { message } = AntApp.useApp();
  const [data, setData] = useState<CollabDeliverables>(EMPTY);
  const [view, setView] = useState<"artifacts" | "changes">("artifacts");
  const [viewing, setViewing] = useState<CollabArtifactVersion | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await listCollabDeliverables(repositoryId, 200));
    } catch (e) {
      message.error(formatCollabError(e));
    } finally {
      setLoading(false);
    }
  }, [message, repositoryId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    let timer: number | null = null;
    void reload();
    void onCollabChanged(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 600);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [reload]);

  const q = query.trim().toLowerCase();
  const reqTitle = useCallback((id: string) => data.requirements[id]?.title ?? id, [data.requirements]);
  const artifacts = useMemo(
    () =>
      q
        ? data.artifacts.filter((v) => [v.name, v.kind, reqTitle(v.requirementId), v.commitSha ?? ""].join(" ").toLowerCase().includes(q))
        : data.artifacts,
    [data.artifacts, q, reqTitle],
  );
  const changes = useMemo(
    () =>
      q
        ? data.changes.filter((c) => [c.code, c.category, reqTitle(c.requirementId)].join(" ").toLowerCase().includes(q))
        : data.changes,
    [data.changes, q, reqTitle],
  );

  const requirementCell = (requirementId: string, tab: string) => {
    const r = data.requirements[requirementId];
    const status = r ? requirementStatusLabel(r) : null;
    return (
      <Space size={4}>
        <Button type="link" size="small" onClick={() => openCollabRequirementDetail(requirementId, tab)}>
          {reqTitle(requirementId)}
        </Button>
        {status ? <Tag color={status.tone}>{status.label}</Tag> : null}
      </Space>
    );
  };

  const taskRepo = (taskId: string | null) => {
    if (!taskId) return "—";
    const t = data.tasks[taskId];
    return t ? `${repoName(repositories, t.repositoryId)} · ${t.title}` : taskId;
  };

  return (
    <div className="collab-deliverables">
      <div className="collab-inbox__toolbar">
        <Segmented
          size="small"
          value={view}
          options={[
            { value: "artifacts", label: `接口与交付（${artifacts.length}）` },
            { value: "changes", label: `修正记录（${changes.length}）` },
          ]}
          onChange={(v) => setView(v as "artifacts" | "changes")}
        />
        <Button size="small" loading={loading} onClick={() => void reload()}>
          刷新
        </Button>
      </div>
      {view === "artifacts" ? (
        <Table<CollabArtifactVersion>
          size="small"
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          dataSource={artifacts}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有跨仓库交付物。多仓库协作任务发布接口包后会出现在这里。" /> }}
          columns={[
            { title: "交付物", render: (_, v) => `${v.name}@${v.version}${v.isDraft ? "（草稿）" : ""}` },
            { title: "类型", width: 90, dataIndex: "kind" },
            { title: "需求", render: (_, v) => requirementCell(v.requirementId, "artifacts") },
            {
              title: "代码版本",
              width: 200,
              render: (_, v) => `${repoName(repositories, v.repositoryId)} · ${v.commitSha?.slice(0, 8) ?? "无提交"}${v.branch ? `（${v.branch}）` : ""}`,
            },
            {
              title: "校验 / 兼容",
              width: 150,
              render: (_, v) => {
                const s = artifactValidationLabel(v.validationState);
                const c = COMPAT_LABEL[v.compatibility] ?? { label: v.compatibility, color: "default" };
                return (
                  <Space size={2}>
                    <Tag color={s.tone} title={v.invalidReason ?? undefined}>{s.label}</Tag>
                    <Tag color={c.color}>{c.label}</Tag>
                  </Space>
                );
              },
            },
            { title: "测试证据", width: 80, render: (_, v) => evidenceCount(v) || "—" },
            { title: "发布时间", width: 160, render: (_, v) => formatTime(v.createdAt) },
            {
              title: "",
              width: 60,
              render: (_, v) => (
                <Button size="small" type="link" onClick={() => setViewing(v)}>
                  查看
                </Button>
              ),
            },
          ]}
        />
      ) : (
        <Table<CollabChangeRequest>
          size="small"
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          dataSource={changes}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有修正记录" /> }}
          columns={[
            { title: "编号", width: 110, dataIndex: "code" },
            { title: "需求", render: (_, c) => requirementCell(c.requirementId, "artifacts") },
            { title: "分类", width: 100, render: (_, c) => CATEGORY_LABEL[c.category] ?? c.category },
            {
              title: "状态",
              width: 110,
              render: (_, c) => {
                const s = changeStateLabel(c.state);
                return <Tag color={s.tone}>{s.label}</Tag>;
              },
            },
            { title: "轮次", width: 70, render: (_, c) => `${c.round}/${c.roundBudget}` },
            { title: "提出方", render: (_, c) => taskRepo(c.reporterTaskId) },
            { title: "修复方", render: (_, c) => taskRepo(c.producerTaskId) },
            {
              title: "复验",
              width: 90,
              render: (_, c) => {
                const passed = c.consumers.filter((x) => x.ackStatus === "passed").length;
                return (
                  <Tooltip title={c.consumers.map((x) => `${taskRepo(x.consumerTaskId)}：${x.ackStatus}`).join("\n") || undefined}>
                    <span>
                      {passed}/{c.consumers.length}
                    </span>
                  </Tooltip>
                );
              },
            },
            { title: "更新时间", width: 160, render: (_, c) => formatTime(c.updatedAt) },
          ]}
        />
      )}
      <ArtifactVersionViewModal version={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
