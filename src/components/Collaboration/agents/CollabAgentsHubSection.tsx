import { useCallback, useEffect, useState } from "react";
import { Button, Tag, Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { agentStatusLabel, DISPATCH_MODE_LABELS, listCollabAgents, onCollabChanged } from "../../../services/collaboration";
import type { CollabAgentSummary } from "../../../types/collaboration";
import { CollabAgentCreateModal } from "./CollabAgentCreateModal";
import { CollabAgentEditorDrawer } from "./CollabAgentEditorDrawer";
import "../collaboration.css";

/** Hub「助手」中的仓库智能体分区：列表、新建、打开配置。 */
export function CollabAgentsHubSection() {
  const [agents, setAgents] = useState<CollabAgentSummary[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    void listCollabAgents(showArchived)
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [showArchived]);

  useEffect(() => {
    load();
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onCollabChanged((requirementId) => {
      if (requirementId == null) load();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [load]);

  return (
    <section className="cockpit-hub__recents collab-hub-agents" aria-label="仓库智能体">
      <div className="collab-hub-agents__head">
        <h2 className="cockpit-hub__section-title">仓库智能体</h2>
        <span>
          <Button size="small" type="link" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "隐藏已归档" : "显示已归档"}
          </Button>
          <Button size="small" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            新建
          </Button>
        </span>
      </div>
      {agents.length === 0 ? (
        <p className="collab-hub-agents__empty">
          仓库智能体是可以反复接收需求的持久身份：绑定一个或多个仓库，在输入框 @它 即可讨论、规划或执行需求。
        </p>
      ) : (
        <ul className="cockpit-hub__recent-list">
          {agents.map((a) => {
            const status = agentStatusLabel(a.status);
            return (
              <li key={a.id}>
                <button type="button" className="cockpit-hub__recent-item" onClick={() => setEditingId(a.id)}>
                  <span className="cockpit-hub__recent-title">
                    <span className="collab-hub-agents__dot" style={{ background: a.avatarColor ?? "var(--ant-color-primary, #1677ff)" }} />
                    {a.name}
                    <Tag color={status.tone} style={{ marginInlineStart: 8 }}>
                      {status.label}
                    </Tag>
                    {a.hasUnpublishedChanges ? (
                      <Tooltip title="草稿有未发布的修改，新需求仍使用生效版本">
                        <Tag color="warning">未发布</Tag>
                      </Tooltip>
                    ) : null}
                  </span>
                  <span className="cockpit-hub__recent-meta">
                    {a.bindings.filter((b) => b.status === "active").length} 个仓库
                    {" · "}
                    {a.engineId}
                    {" · 默认"}
                    {DISPATCH_MODE_LABELS[a.defaultMode]?.label ?? a.defaultMode}
                    {a.activeRevision ? ` · v${a.activeRevision}` : " · 未发布"}
                    {a.description ? ` · ${a.description}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <CollabAgentCreateModal
        open={creating}
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
        onDuplicated={(id) => {
          load();
          setEditingId(id);
        }}
      />
    </section>
  );
}
