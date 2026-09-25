import { useCallback, useEffect, useState } from "react";
import { App as AntApp, Button, Empty, List, Modal, Popconfirm, Select, Space, Tag, Typography } from "antd";
import {
  agentStatusLabel,
  bindCollabAgent,
  formatCollabError,
  listCollabAgents,
  onCollabChanged,
  unbindCollabAgent,
} from "../../../services/collaboration";
import { closeCollabAgentScope, useCollabAgentScope } from "../../../stores/collabUiStore";
import type { CollabAgentBinding, CollabAgentSummary } from "../../../types/collaboration";
import { CollabAgentCreateModal } from "./CollabAgentCreateModal";
import { CollabAgentEditorDrawer } from "./CollabAgentEditorDrawer";

interface Row {
  agent: CollabAgentSummary;
  bindings: CollabAgentBinding[];
}

/** 仓库 / 工作区设置入口：查看绑定到此处的智能体，绑定已有或新建并绑定。 */
export function CollabRepositoryAgentsModal() {
  const scope = useCollabAgentScope();
  const { message } = AntApp.useApp();
  const [agents, setAgents] = useState<CollabAgentSummary[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!scope) return;
    void listCollabAgents(false)
      .then(setAgents)
      .catch((e) => message.error(formatCollabError(e)));
  }, [message, scope]);

  useEffect(() => {
    if (!scope) return;
    load();
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onCollabChanged((id) => {
      if (id == null) load();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [load, scope]);

  if (!scope) return null;

  const matches = (b: CollabAgentBinding) =>
    b.status === "active" && b.projectId === scope.projectId && (scope.repositoryId == null || b.repositoryId === scope.repositoryId);
  const rows: Row[] = agents
    .map((agent) => ({ agent, bindings: agent.bindings.filter(matches) }))
    .filter((r) => r.bindings.length > 0);
  const bindable = agents.filter((a) => !rows.some((r) => r.agent.id === a.id) && a.status !== "archived");

  const bindExisting = async () => {
    if (!pick || scope.repositoryId == null) return;
    try {
      await bindCollabAgent({ agentId: pick, projectId: scope.projectId, repositoryId: scope.repositoryId });
      setPick(null);
      message.success("已绑定，可在智能体配置中设置职责与覆盖项");
      load();
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  return (
    <>
      <Modal open title={`仓库智能体 · ${scope.title}`} footer={null} width={640} onCancel={closeCollabAgentScope}>
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <List
            size="small"
            dataSource={rows}
            locale={{ emptyText: <Empty description="还没有智能体绑定到这里" /> }}
            renderItem={({ agent, bindings }) => {
              const status = agentStatusLabel(agent.status);
              return (
                <List.Item
                  actions={[
                    <Button key="edit" size="small" type="link" onClick={() => setEditingId(agent.id)}>
                      配置
                    </Button>,
                    ...(scope.repositoryId != null
                      ? bindings.map((b) => (
                          <Popconfirm
                            key={b.id}
                            title="解除绑定？进行中的任务会在下次授权校验时停止"
                            onConfirm={() =>
                              void unbindCollabAgent(b.id)
                                .then(load)
                                .catch((e) => message.error(formatCollabError(e)))
                            }
                          >
                            <Button size="small" type="link" danger>
                              解绑
                            </Button>
                          </Popconfirm>
                        ))
                      : []),
                  ]}
                >
                  <Space direction="vertical" size={2}>
                    <Space size={6}>
                      <Typography.Text strong>{agent.name}</Typography.Text>
                      <Tag color={status.tone}>{status.label}</Tag>
                      {bindings.some((b) => b.isDefault) ? <Tag color="blue">默认</Tag> : null}
                    </Space>
                    <Typography.Text type="secondary">
                      {bindings.map((b) => b.responsibility || b.roleTags.join("、") || "未填写职责").join("；")}
                    </Typography.Text>
                  </Space>
                </List.Item>
              );
            }}
          />
          <Space wrap>
            {scope.repositoryId != null ? (
              <>
                <Select
                  style={{ width: 240 }}
                  placeholder="绑定已有智能体"
                  value={pick ?? undefined}
                  options={bindable.map((a) => ({ value: a.id, label: a.name }))}
                  onChange={setPick}
                />
                <Button disabled={!pick} onClick={() => void bindExisting()}>
                  绑定
                </Button>
              </>
            ) : null}
            <Button type="primary" onClick={() => setCreating(true)}>
              新建智能体
            </Button>
          </Space>
        </Space>
      </Modal>
      <CollabAgentCreateModal
        open={creating}
        presetProjectId={scope.projectId}
        presetRepositoryIds={scope.repositoryId != null ? [scope.repositoryId] : []}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          load();
          setEditingId(id);
        }}
      />
      <CollabAgentEditorDrawer
        agentId={editingId}
        open={editingId != null}
        onClose={() => {
          setEditingId(null);
          load();
        }}
        onDuplicated={(id) => setEditingId(id)}
      />
    </>
  );
}
