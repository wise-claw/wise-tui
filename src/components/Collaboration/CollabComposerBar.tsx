import { useMemo } from "react";
import { Segmented, Select, Space, Tooltip, Typography } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import {
  continuableSessionRequirements,
  DISPATCH_MODE_LABELS,
  type CollabComposerTarget,
} from "../../services/collaboration";
import {
  selectCollabComposerAgent,
  setCollabComposerSelection,
  useCollabComposerAgents,
  useCollabComposerSelection,
  useCollabSessionRequirements,
} from "../../stores/collabComposerStore";
import type { CollabDispatchMode } from "../../types/collaboration";
import { CollabSessionRequirementCard } from "./CollabSessionRequirementCard";
import "./collaboration.css";

export interface CollabComposerRepositoryOption {
  repositoryId: number;
  label: string;
}

interface Props {
  sessionId: string;
  repositories: readonly CollabComposerRepositoryOption[];
}

const MODE_OPTIONS: { label: string; value: CollabDispatchMode }[] = [
  { label: DISPATCH_MODE_LABELS.discuss.label, value: "discuss" },
  { label: "先规划", value: "plan" },
  { label: "执行需求", value: "execute" },
];

function targetKey(t: CollabComposerTarget): string {
  return t.kind === "continue" ? `continue:${t.requirementId}` : t.kind;
}

/**
 * 输入框上方：接收者（智能体 / 仓库 / 角色分类，值总是稳定的智能体 ID）、模式、需求关联，以及本会话的需求卡片。
 * 未选择接收者时不影响原有聊天与 @仓库 派发。
 */
export function CollabComposerBar({ sessionId, repositories }: Props) {
  const agents = useCollabComposerAgents();
  const selection = useCollabComposerSelection(sessionId);
  const sessionReqs = useCollabSessionRequirements(sessionId);
  const repoName = useMemo(() => new Map(repositories.map((r) => [r.repositoryId, r.label])), [repositories]);
  const usable = agents.filter((a) => a.status !== "archived");
  const agent = usable.find((a) => a.id === selection.agentId) ?? null;

  const options = useMemo(() => {
    const enabled = usable.filter((a) => a.status === "enabled");
    const byAgent = usable.map((a) => ({
      value: `agent:${a.id}`,
      label: (
        <span>
          {a.name}
          {a.status !== "enabled" ? <Typography.Text type="secondary">（仅讨论）</Typography.Text> : null}
        </span>
      ),
      searchText: a.name,
    }));
    const byRepo: { value: string; label: string; searchText: string }[] = [];
    const byRole: { value: string; label: string; searchText: string }[] = [];
    const seenRole = new Set<string>();
    for (const a of enabled) {
      for (const b of a.bindings.filter((x) => x.status === "active")) {
        const name = repoName.get(b.repositoryId) ?? `仓库 #${b.repositoryId}`;
        byRepo.push({ value: `repo:${b.repositoryId}:${a.id}`, label: `${name} → ${a.name}`, searchText: name });
        for (const tag of b.roleTags) {
          const key = `${tag}:${a.id}`;
          if (seenRole.has(key)) continue;
          seenRole.add(key);
          byRole.push({ value: `role:${key}`, label: `${tag} → ${a.name}`, searchText: tag });
        }
      }
    }
    return [
      { label: "智能体", title: "智能体", options: byAgent },
      ...(byRepo.length ? [{ label: "仓库", title: "仓库", options: byRepo }] : []),
      ...(byRole.length ? [{ label: "角色", title: "角色", options: byRole }] : []),
    ];
  }, [repoName, usable]);

  const continuable = continuableSessionRequirements(sessionReqs).filter(
    (r) => !agent || r.requirement.ownerAgentId === agent.id,
  );
  const effectiveTarget: CollabComposerTarget =
    selection.target.kind === "auto"
      ? continuable.length === 1
        ? { kind: "continue", requirementId: continuable[0].requirement.id }
        : { kind: "new" }
      : selection.target;

  if (!usable.length && !sessionReqs.length) return null;

  const coverage = agent
    ? agent.bindings
        .filter((b) => b.status === "active")
        .map((b) => repoName.get(b.repositoryId) ?? `#${b.repositoryId}`)
        .join(" / ")
    : "";

  return (
    <div className="collab-composer-bar">
      {usable.length ? (
        <div className="collab-composer-bar__row">
          <Space size={6} wrap>
            <RobotOutlined />
            <Select
              size="small"
              allowClear
              showSearch
              style={{ minWidth: 180 }}
              placeholder="接收者：普通对话"
              value={agent ? `agent:${agent.id}` : undefined}
              options={options}
              optionFilterProp="searchText"
              popupMatchSelectWidth={false}
              onChange={(v?: string) => {
                if (!v) return selectCollabComposerAgent(sessionId, null);
                const agentId = v.startsWith("agent:") ? v.slice(6) : v.slice(v.lastIndexOf(":") + 1);
                selectCollabComposerAgent(sessionId, agentId);
              }}
            />
            {agent ? (
              <>
                {coverage ? (
                  <Tooltip title="该智能体覆盖的仓库">
                    <Typography.Text type="secondary" ellipsis style={{ maxWidth: 260 }}>
                      · {coverage}
                    </Typography.Text>
                  </Tooltip>
                ) : (
                  <Typography.Text type="warning">尚未绑定仓库</Typography.Text>
                )}
                <Segmented
                  size="small"
                  value={selection.mode}
                  options={MODE_OPTIONS.map((o) => ({
                    ...o,
                    disabled: o.value !== "discuss" && agent.status !== "enabled",
                  }))}
                  onChange={(v) => setCollabComposerSelection(sessionId, { mode: v as CollabDispatchMode })}
                />
                {selection.mode !== "discuss" ? (
                  <Select
                    size="small"
                    style={{ minWidth: 160 }}
                    value={targetKey(effectiveTarget)}
                    popupMatchSelectWidth={false}
                    options={[
                      ...continuable.map((r) => ({
                        value: `continue:${r.requirement.id}`,
                        label: `继续：${r.requirement.title}`,
                      })),
                      { value: "new", label: "新需求" },
                    ]}
                    onChange={(v: string) =>
                      setCollabComposerSelection(sessionId, {
                        target: v === "new" ? { kind: "new" } : { kind: "continue", requirementId: v.slice(9) },
                      })
                    }
                  />
                ) : (
                  <Typography.Text type="secondary">{DISPATCH_MODE_LABELS.discuss.hint}</Typography.Text>
                )}
              </>
            ) : null}
          </Space>
        </div>
      ) : null}
      {sessionReqs.length ? (
        <div className="collab-composer-bar__cards">
          {sessionReqs.slice(0, 3).map((r) => (
            <CollabSessionRequirementCard
              key={`${r.relation}:${r.requirement.id}`}
              item={r}
              agentName={agents.find((a) => a.id === r.requirement.ownerAgentId)?.name ?? "智能体"}
              continuing={
                agent != null &&
                selection.mode !== "discuss" &&
                effectiveTarget.kind === "continue" &&
                effectiveTarget.requirementId === r.requirement.id
              }
              onContinue={
                r.relation === "origin" && r.requirement.ownerAgentId
                  ? () => {
                      selectCollabComposerAgent(sessionId, r.requirement.ownerAgentId);
                      setCollabComposerSelection(sessionId, {
                        mode: selection.mode === "discuss" ? "execute" : selection.mode,
                        target: { kind: "continue", requirementId: r.requirement.id },
                      });
                    }
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
