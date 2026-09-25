import { useCallback, useEffect, useState } from "react";
import { App as AntApp, Button, Input, List, Modal, Popconfirm, Select, Space, Switch, Tag, Typography } from "antd";
import {
  addCollabMemory,
  clearCollabMemories,
  deleteCollabMemory,
  formatCollabError,
  listCollabMemories,
  listCollabMemoryRevisions,
  onCollabChanged,
  updateCollabMemory,
  repositoryWorkspaceLabel,
} from "../../../services/collaboration";
import type { ProjectItem, Repository } from "../../../types";
import type { CollabMemoryItem } from "../../../types/collaboration";

interface Props {
  agentId: string;
  projects: ProjectItem[];
  repositories: Repository[];
}

const SCOPE_LABEL: Record<CollabMemoryItem["scope"], string> = {
  agent: "智能体",
  repository: "仓库",
  requirement: "需求",
};
const TRUST_LABEL: Record<CollabMemoryItem["trust"], { label: string; color: string }> = {
  verified: { label: "已验证", color: "success" },
  candidate: { label: "候选", color: "warning" },
  user: { label: "用户添加", color: "blue" },
};

/** 智能体私有记忆：来源、范围、版本、有效状态；可添加、修订、删除、清空与查看修订历史。 */
export function CollabAgentMemoryPanel({ agentId, projects, repositories }: Props) {
  const { message } = AntApp.useApp();
  const [items, setItems] = useState<CollabMemoryItem[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; content: string; scope: CollabMemoryItem["scope"]; repositoryId: number | null; projectId: string | null; revision: number } | null>(null);
  const [history, setHistory] = useState<{ id: string; rows: Record<string, unknown>[] } | null>(null);

  const load = useCallback(() => {
    void listCollabMemories(agentId, showDeleted)
      .then(setItems)
      .catch((e) => message.error(formatCollabError(e)));
  }, [agentId, message, showDeleted]);

  useEffect(() => {
    load();
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onCollabChanged(() => load()).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [load]);

  const save = async () => {
    if (!editing || !editing.content.trim()) return;
    try {
      if (editing.id) {
        await updateCollabMemory({ memoryId: editing.id, expectedRevision: editing.revision, content: editing.content });
      } else {
        await addCollabMemory({
          agentId,
          scope: editing.scope,
          content: editing.content,
          repositoryId: editing.scope === "repository" ? editing.repositoryId : null,
          projectId: editing.projectId,
        });
      }
      setEditing(null);
      load();
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  const repoName = (id: number | null) => (id == null ? "" : (repositories.find((r) => r.id === id)?.name ?? `#${id}`));

  return (
    <>
      <div className="collab-section-title" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>记忆条目</span>
        <Space size={8}>
          <span style={{ fontWeight: 400 }}>
            显示已删除 <Switch size="small" checked={showDeleted} onChange={setShowDeleted} />
          </span>
          <Button
            size="small"
            onClick={() =>
              setEditing({ id: null, content: "", scope: "agent", repositoryId: null, projectId: projects[0]?.id ?? null, revision: 0 })
            }
          >
            添加记忆
          </Button>
          <Popconfirm
            title="清空该智能体全部记忆？（保留修订历史）"
            onConfirm={async () => {
              try {
                const n = await clearCollabMemories(agentId);
                message.success(`已清空 ${n} 条`);
                load();
              } catch (e) {
                message.error(formatCollabError(e));
              }
            }}
          >
            <Button size="small" danger>
              清空
            </Button>
          </Popconfirm>
        </Space>
      </div>
      <List
        size="small"
        dataSource={items}
        locale={{ emptyText: "暂无记忆。失败猜测不会自动沉淀为已验证知识。" }}
        renderItem={(m) => (
          <List.Item
            actions={
              m.deletedAt
                ? [<Tag key="d">已删除</Tag>]
                : [
                    <Button
                      key="e"
                      size="small"
                      type="link"
                      onClick={() =>
                        setEditing({
                          id: m.id,
                          content: m.content,
                          scope: m.scope,
                          repositoryId: m.repositoryId,
                          projectId: m.projectId,
                          revision: m.revision,
                        })
                      }
                    >
                      修订
                    </Button>,
                    <Button
                      key="h"
                      size="small"
                      type="link"
                      onClick={() =>
                        void listCollabMemoryRevisions(m.id)
                          .then((rows) => setHistory({ id: m.id, rows }))
                          .catch((e) => message.error(formatCollabError(e)))
                      }
                    >
                      历史
                    </Button>,
                    ...(m.trust === "candidate"
                      ? [
                          <Button
                            key="v"
                            size="small"
                            type="link"
                            onClick={() =>
                              void updateCollabMemory({ memoryId: m.id, expectedRevision: m.revision, trust: "verified" })
                                .then(load)
                                .catch((e) => message.error(formatCollabError(e)))
                            }
                          >
                            标记已验证
                          </Button>,
                        ]
                      : []),
                    <Popconfirm key="x" title="删除这条记忆？" onConfirm={() => void deleteCollabMemory(m.id).then(load)}>
                      <Button size="small" type="link" danger>
                        删除
                      </Button>
                    </Popconfirm>,
                  ]
            }
          >
            <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
              <Space size={4} wrap>
                <Tag>{SCOPE_LABEL[m.scope]}</Tag>
                {m.scope === "repository" ? <Tag>{repoName(m.repositoryId)}</Tag> : null}
                <Tag color={TRUST_LABEL[m.trust].color}>{TRUST_LABEL[m.trust].label}</Tag>
                <Typography.Text type="secondary">v{m.revision}</Typography.Text>
                {m.expiresAt ? <Typography.Text type="secondary">有效期至 {new Date(m.expiresAt).toLocaleDateString()}</Typography.Text> : null}
                {m.sourceAttemptId ? <Typography.Text type="secondary">来源尝试 {m.sourceAttemptId.slice(0, 12)}</Typography.Text> : null}
              </Space>
              <Typography.Paragraph style={{ margin: 0 }} ellipsis={{ rows: 3, expandable: true }}>
                {m.content}
              </Typography.Paragraph>
            </Space>
          </List.Item>
        )}
      />
      <Modal
        open={editing != null}
        title={editing?.id ? "修订记忆" : "添加记忆"}
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
        okText="保存"
        destroyOnClose
      >
        {editing ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            {!editing.id ? (
              <Space wrap>
                <Select
                  style={{ width: 140 }}
                  value={editing.scope}
                  options={[
                    { value: "agent", label: "智能体范围" },
                    { value: "repository", label: "仓库范围" },
                  ]}
                  onChange={(v) => setEditing({ ...editing, scope: v })}
                />
                {editing.scope === "repository" ? (
                  <Select
                    style={{ width: 220 }}
                    placeholder="仓库"
                    value={editing.repositoryId ?? undefined}
                    options={repositories.map((r) => ({ value: r.id, label: repositoryWorkspaceLabel(r) }))}
                    onChange={(v: number) => setEditing({ ...editing, repositoryId: v })}
                  />
                ) : null}
              </Space>
            ) : null}
            <Input.TextArea
              autoSize={{ minRows: 4, maxRows: 12 }}
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
            />
          </Space>
        ) : null}
      </Modal>
      <Modal open={history != null} title="修订历史" footer={null} onCancel={() => setHistory(null)} width={640}>
        <List
          size="small"
          dataSource={history?.rows ?? []}
          renderItem={(r) => (
            <List.Item>
              <Space direction="vertical" size={0}>
                <Typography.Text type="secondary">
                  v{String(r.revision ?? "")} · {typeof r.createdAt === "number" ? new Date(r.createdAt).toLocaleString() : ""}
                  {typeof r.changeKind === "string" ? ` · ${r.changeKind}` : ""}
                </Typography.Text>
                <Typography.Text>{typeof r.content === "string" ? r.content : ""}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      </Modal>
    </>
  );
}
