import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  archiveCollabResource,
  formatCollabError,
  grantCollabResource,
  listCollabResourceSuggestions,
  projectSelectOptions,
  listCollabResourceVersions,
  publishCollabResourceVersion,
  readCollabResource,
  resolveCollabResourceSuggestion,
  resourceKindLabel,
  RESOURCE_VISIBILITY_LABELS,
  revokeCollabResourceGrant,
  setCollabResourceVisibility,
  subscribeCollabResource,
  suggestCollabResource,
} from "../../../services/collaboration";
import type {
  CollabResource,
  CollabResourceGrant,
  CollabResourceSuggestion,
  CollabResourceVersion,
  CollabResourceVersionSummary,
  CollabResourceVisibility,
} from "../../../types/collaboration";
import { formatTime } from "../requirement/detailContext";
import { projectLabel, type CollabDirectory } from "./useCollabDirectory";

interface Props {
  resourceId: string | null;
  directory: CollabDirectory;
  onClose: () => void;
}

type GranteeKind = CollabResourceGrant["granteeKind"];

const GRANTEE_LABELS: Record<GranteeKind, string> = { project: "项目", agent: "智能体", space: "协作空间", task: "任务" };

function parseGrants(raw: unknown[]): CollabResourceGrant[] {
  return raw.filter((g): g is CollabResourceGrant => {
    const r = g as Record<string, unknown>;
    return typeof r?.id === "string" && typeof r.granteeKind === "string" && typeof r.granteeId === "string";
  });
}

/** 共享资源详情：内容与不可变版本、可见范围与授权、订阅、修订建议。 */
export function CollabResourceDrawer({ resourceId, directory, onClose }: Props) {
  const { message } = AntApp.useApp();
  const [resource, setResource] = useState<CollabResource | null>(null);
  const [current, setCurrent] = useState<CollabResourceVersion | null>(null);
  const [versions, setVersions] = useState<CollabResourceVersionSummary[]>([]);
  const [suggestions, setSuggestions] = useState<CollabResourceSuggestion[]>([]);
  const [publishing, setPublishing] = useState<{ content: string; note: string } | null>(null);
  const [grantKind, setGrantKind] = useState<GranteeKind>("project");
  const [grantId, setGrantId] = useState<string | undefined>();
  const [subscriber, setSubscriber] = useState<string | undefined>();
  const [suggestion, setSuggestion] = useState({ projectId: undefined as string | undefined, body: "" });

  const load = useCallback(
    async (version?: number) => {
      if (!resourceId) return;
      try {
        const [read, vers, sugg] = await Promise.all([
          readCollabResource(resourceId, version ?? null),
          listCollabResourceVersions(resourceId),
          listCollabResourceSuggestions(resourceId),
        ]);
        setResource(read.resource);
        setCurrent(read.version);
        setVersions(vers);
        setSuggestions(sugg);
      } catch (e) {
        message.error(formatCollabError(e));
      }
    },
    [message, resourceId],
  );

  useEffect(() => {
    setResource(null);
    setCurrent(null);
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) message.success(ok);
      await load(current?.version);
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  if (!resourceId) return null;
  const grants = resource ? parseGrants(resource.grants) : [];
  const activeGrants = grants.filter((g) => g.revokedAt == null);
  const readOnly = resource?.status !== "active";

  const granteeOptions =
    grantKind === "project"
      ? projectSelectOptions(directory.projects, directory.repositories)
      : grantKind === "agent"
        ? directory.agents.map((a) => ({ value: a.id, label: a.name }))
        : grantKind === "space"
          ? directory.spaces.map((s) => ({ value: s.id, label: s.name }))
          : [];

  const granteeName = (g: CollabResourceGrant) =>
    g.granteeKind === "project"
      ? projectLabel(directory.projects, g.granteeId, directory.repositories)
      : g.granteeKind === "agent"
        ? directory.agents.find((a) => a.id === g.granteeId)?.name ?? g.granteeId
        : g.granteeKind === "space"
          ? directory.spaces.find((s) => s.id === g.granteeId)?.name ?? g.granteeId
          : g.granteeId;

  const contentTab = (
    <Space direction="vertical" size={10} style={{ width: "100%" }}>
      <Space wrap>
        <Select
          size="small"
          style={{ width: 200 }}
          value={current?.version}
          options={versions.map((v) => ({ value: v.version, label: `v${v.version} · ${formatTime(v.publishedAt)}` }))}
          onChange={(v) => void load(v)}
        />
        {!readOnly ? (
          <Button size="small" type="primary" onClick={() => setPublishing({ content: current?.content ?? "", note: "" })}>
            发布新版本
          </Button>
        ) : null}
      </Space>
      {current ? (
        <Typography.Text type="secondary">
          v{current.version} · 摘要 {current.contentHash.slice(0, 12)} · 发布者 {current.publisher || "—"}
          {current.note ? ` · ${current.note}` : ""}
        </Typography.Text>
      ) : null}
      <pre className="collab-pre">{current?.content ?? ""}</pre>
      <Typography.Text type="secondary">已发布版本不可修改；运行中的任务继续使用其锁定版本，订阅者会看到可升级提示。</Typography.Text>
    </Space>
  );

  const accessTab = resource ? (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Space wrap>
        <span>可见范围</span>
        <Select<CollabResourceVisibility>
          size="small"
          style={{ width: 140 }}
          disabled={readOnly}
          value={resource.visibility}
          options={Object.entries(RESOURCE_VISIBILITY_LABELS).map(([value, v]) => ({ value: value as CollabResourceVisibility, label: v.label }))}
          onChange={(v) => {
            if (v === "space" && !resource.spaceId && !directory.spaces.length) {
              message.warning("请先在项目的“协作与共享”中创建协作空间");
              return;
            }
            void run(() => setCollabResourceVisibility(resource.id, v, v === "space" ? resource.spaceId ?? directory.spaces[0]?.id : null));
          }}
        />
        {resource.visibility === "space" ? (
          <Select
            size="small"
            style={{ width: 180 }}
            disabled={readOnly}
            value={resource.spaceId ?? undefined}
            options={directory.spaces.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(sid) => void run(() => setCollabResourceVisibility(resource.id, "space", sid))}
          />
        ) : null}
        <Typography.Text type="secondary">{RESOURCE_VISIBILITY_LABELS[resource.visibility]?.hint}</Typography.Text>
      </Space>
      <div className="collab-section-title">授权</div>
      {!readOnly ? (
        <Space wrap>
          <Select<GranteeKind>
            size="small"
            style={{ width: 110 }}
            value={grantKind}
            options={(["project", "agent", "space"] as GranteeKind[]).map((k) => ({ value: k, label: GRANTEE_LABELS[k] }))}
            onChange={(k) => {
              setGrantKind(k);
              setGrantId(undefined);
            }}
          />
          <Select size="small" style={{ width: 220 }} value={grantId} options={granteeOptions} onChange={setGrantId} placeholder="选择授权对象" />
          <Button
            size="small"
            disabled={!grantId}
            onClick={() => grantId && void run(() => grantCollabResource(resource.id, grantKind, grantId), "已授权")}
          >
            授权读取
          </Button>
        </Space>
      ) : null}
      <Table<CollabResourceGrant>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={grants}
        locale={{ emptyText: "没有额外授权" }}
        columns={[
          { title: "对象", render: (_, g) => `${GRANTEE_LABELS[g.granteeKind] ?? g.granteeKind} · ${granteeName(g)}` },
          { title: "授权版本", width: 90, dataIndex: "authVersion" },
          { title: "时间", width: 160, render: (_, g) => formatTime(g.createdAt) },
          {
            title: "",
            width: 90,
            render: (_, g) =>
              g.revokedAt != null ? (
                <Tag>已撤销</Tag>
              ) : (
                <Popconfirm
                  title="撤销后该对象不能再检索或读取此资源；已分发给运行中任务的内容会保留审计记录。"
                  onConfirm={() => void run(() => revokeCollabResourceGrant(g.id), "已撤销")}
                >
                  <Button size="small" type="link" danger>
                    撤销
                  </Button>
                </Popconfirm>
              ),
          },
        ]}
      />
      <Typography.Text type="secondary">当前有效授权 {activeGrants.length} 个 · 授权版本 {resource.authVersion}</Typography.Text>
    </Space>
  ) : null;

  const subscribeTab = resource ? (
    <Space direction="vertical" size={10} style={{ width: "100%" }}>
      <Typography.Text type="secondary">订阅方跟踪逻辑资源；发布新版本后在其“协作与共享”中显示可升级，不会静默替换任务输入。</Typography.Text>
      <Space wrap>
        <Select
          size="small"
          style={{ width: 260 }}
          placeholder="选择订阅的项目或智能体"
          value={subscriber}
          onChange={setSubscriber}
          options={[
            { label: "项目", options: projectSelectOptions(directory.projects, directory.repositories).map((o) => ({ value: `project:${o.value}`, label: o.label })) },
            { label: "智能体", options: directory.agents.map((a) => ({ value: `agent:${a.id}`, label: a.name })) },
          ]}
        />
        <Button
          size="small"
          disabled={!subscriber}
          onClick={() => {
            if (!subscriber) return;
            const [kind, ...rest] = subscriber.split(":");
            void run(() => subscribeCollabResource(resource.id, kind as "project" | "agent", rest.join(":")), `已订阅，当前跟踪 v${resource.latestVersion}`);
          }}
        >
          订阅 / 升级到最新
        </Button>
      </Space>
    </Space>
  ) : null;

  const suggestionsTab = resource ? (
    <Space direction="vertical" size={10} style={{ width: "100%" }}>
      <Space.Compact style={{ width: "100%" }}>
        <Select
          size="small"
          style={{ width: 180 }}
          allowClear
          placeholder="建议来自项目"
          value={suggestion.projectId}
          options={projectSelectOptions(directory.projects, directory.repositories)}
          onChange={(v) => setSuggestion((s) => ({ ...s, projectId: v }))}
        />
        <Input
          size="small"
          placeholder="描述需要修订的内容（发送给维护者）"
          value={suggestion.body}
          onChange={(e) => setSuggestion((s) => ({ ...s, body: e.target.value }))}
        />
        <Button
          size="small"
          disabled={!suggestion.body.trim() || readOnly}
          onClick={() =>
            void run(async () => {
              await suggestCollabResource(resource.id, suggestion.body.trim(), suggestion.projectId ?? null);
              setSuggestion({ projectId: undefined, body: "" });
            }, "已提交修订建议")
          }
        >
          提交建议
        </Button>
      </Space.Compact>
      <Table<CollabResourceSuggestion>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={suggestions}
        locale={{ emptyText: "暂无修订建议" }}
        columns={[
          { title: "来源", width: 140, render: (_, s) => (s.fromTaskId ? `任务 ${s.fromTaskId.slice(0, 8)}` : projectLabel(directory.projects, s.fromProjectId, directory.repositories)) },
          { title: "建议", dataIndex: "body" },
          {
            title: "状态",
            width: 80,
            render: (_, s) => <Tag color={s.state === "open" ? "processing" : s.state === "accepted" ? "success" : "default"}>{s.state === "open" ? "待处理" : s.state === "accepted" ? "已采纳" : "已拒绝"}</Tag>,
          },
          { title: "时间", width: 160, render: (_, s) => formatTime(s.createdAt) },
          {
            title: "",
            width: 130,
            render: (_, s) =>
              s.state === "open" && !readOnly ? (
                <Space size={0}>
                  <Button
                    size="small"
                    type="link"
                    onClick={() =>
                      void run(async () => {
                        await resolveCollabResourceSuggestion(s.id, true);
                        setPublishing({ content: current?.content ?? "", note: `采纳建议：${s.body.slice(0, 60)}` });
                      })
                    }
                  >
                    采纳
                  </Button>
                  <Button size="small" type="link" onClick={() => void run(() => resolveCollabResourceSuggestion(s.id, false))}>
                    拒绝
                  </Button>
                </Space>
              ) : null,
          },
        ]}
      />
    </Space>
  ) : null;

  return (
    <Drawer
      open
      width={780}
      title={resource ? resource.title : "共享资源"}
      onClose={onClose}
      extra={
        resource && !readOnly ? (
          <Popconfirm title="归档后停止新检索和新派发，已有任务保留审计记录。" onConfirm={() => void run(() => archiveCollabResource(resource.id), "已归档")}>
            <Button size="small" danger>
              归档
            </Button>
          </Popconfirm>
        ) : null
      }
    >
      {resource ? (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {readOnly ? <Alert type="warning" showIcon message="资源已停用：不再参与检索和新派发。" /> : null}
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="类型">{resourceKindLabel(resource.kind)}</Descriptions.Item>
            <Descriptions.Item label="最新版本">v{resource.latestVersion}</Descriptions.Item>
            <Descriptions.Item label="来源项目">{projectLabel(directory.projects, resource.ownerProjectId, directory.repositories)}</Descriptions.Item>
            <Descriptions.Item label="来源智能体">
              {resource.ownerAgentId ? directory.agents.find((a) => a.id === resource.ownerAgentId)?.name ?? resource.ownerAgentId : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="维护者">{resource.maintainer || "—"}</Descriptions.Item>
            <Descriptions.Item label="位置">{resource.location || "—"}</Descriptions.Item>
          </Descriptions>
          <Tabs
            size="small"
            items={[
              { key: "content", label: `内容与版本（${versions.length}）`, children: contentTab },
              { key: "access", label: "可见范围与授权", children: accessTab },
              { key: "subscribe", label: "订阅", children: subscribeTab },
              { key: "suggestions", label: `修订建议（${suggestions.filter((s) => s.state === "open").length}）`, children: suggestionsTab },
            ]}
          />
        </Space>
      ) : null}
      <Modal
        open={publishing != null}
        title="发布新版本"
        okText="发布"
        width={680}
        onCancel={() => setPublishing(null)}
        onOk={() => {
          if (!resource || !publishing) return;
          void (async () => {
            try {
              const v = await publishCollabResourceVersion(resource.id, publishing.content, publishing.note);
              setPublishing(null);
              message.success(v.version === resource.latestVersion ? "内容未变化，沿用当前版本" : `已发布 v${v.version}`);
              await load();
            } catch (e) {
              message.error(formatCollabError(e));
            }
          })();
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input.TextArea
            autoSize={{ minRows: 8, maxRows: 20 }}
            value={publishing?.content ?? ""}
            onChange={(e) => setPublishing((p) => (p ? { ...p, content: e.target.value } : p))}
          />
          <Input placeholder="版本说明" value={publishing?.note ?? ""} onChange={(e) => setPublishing((p) => (p ? { ...p, note: e.target.value } : p))} />
        </Space>
      </Modal>
    </Drawer>
  );
}
