import { useState } from "react";
import { App as AntApp, Button, Empty, Space, Table, Tag, Typography } from "antd";
import { formatCollabError, readCollabResource } from "../../../services/collaboration";
import type { CollabResource, CollabResourceVersion } from "../../../types/collaboration";
import { CollabResourceReader, CollabResourceSearch } from "../resources/CollabResourceSearch";
import { formatTime, taskTitle, type CollabDetailContext } from "./detailContext";

interface RefItem {
  id: string;
  version: number | null;
  source: string;
}

function refs(value: unknown): RefItem[] {
  if (!Array.isArray(value)) return [];
  const out: RefItem[] = [];
  for (const v of value) {
    if (typeof v !== "object" || v === null) continue;
    const rec = v as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : typeof rec.resourceId === "string" ? rec.resourceId : null;
    if (!id) continue;
    const version = typeof rec.version === "number" ? rec.version : typeof rec.revision === "number" ? rec.revision : null;
    out.push({ id, version, source: typeof rec.source === "string" ? rec.source : "" });
  }
  return out;
}

const SOURCE_LABEL: Record<string, string> = { knowledge_ref: "智能体知识", search: "授权检索" };

/** 共享知识：每次执行实际拿到的资源 / 记忆版本（上下文包审计），以及当前可访问资源的检索。 */
export function RequirementKnowledgeTab({ ctx }: { ctx: CollabDetailContext }) {
  const { message } = AntApp.useApp();
  const { snapshot } = ctx;
  const [reading, setReading] = useState<{ resource: CollabResource; version: CollabResourceVersion } | null>(null);
  const rows = snapshot.resources
    .map((r) => ({
      attemptId: typeof r.attemptId === "string" ? r.attemptId : "",
      taskId: typeof r.taskId === "string" ? r.taskId : "",
      createdAt: typeof r.createdAt === "number" ? r.createdAt : 0,
      resources: refs(r.resources),
      memories: refs(r.memories),
    }))
    .filter((r) => r.attemptId);

  const open = async (id: string, version: number | null) => {
    try {
      setReading(await readCollabResource(id, version));
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <div>
        <div className="collab-section-title">执行时使用的知识与记忆</div>
        {rows.length ? (
          <Table
            size="small"
            pagination={false}
            rowKey="attemptId"
            dataSource={rows}
            columns={[
              { title: "任务", render: (_, r) => taskTitle(snapshot.tasks, r.taskId) },
              {
                title: "共享资源",
                render: (_, r) =>
                  r.resources.length ? (
                    <Space size={4} wrap>
                      {r.resources.map((x) => (
                        <Button key={`${x.id}:${x.version}`} size="small" type="dashed" onClick={() => void open(x.id, x.version)}>
                          {x.id.slice(0, 14)} v{x.version ?? "?"}
                          {x.source ? <Tag style={{ marginInlineStart: 4 }}>{SOURCE_LABEL[x.source] ?? x.source}</Tag> : null}
                        </Button>
                      ))}
                    </Space>
                  ) : (
                    "—"
                  ),
              },
              { title: "记忆", width: 90, render: (_, r) => (r.memories.length ? `${r.memories.length} 条` : "—") },
              { title: "时间", width: 160, render: (_, r) => formatTime(r.createdAt) },
            ]}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无执行记录" />
        )}
      </div>
      <div>
        <div className="collab-section-title">检索可访问的共享知识</div>
        <CollabResourceSearch projectId={snapshot.requirement.ownerProjectId} />
        <Typography.Text type="secondary">
          检索范围受主责项目的授权限制；智能体只能读取来源项目、所在协作空间或被显式授权的资源。
        </Typography.Text>
      </div>
      <CollabResourceReader value={reading} onClose={() => setReading(null)} />
    </Space>
  );
}
