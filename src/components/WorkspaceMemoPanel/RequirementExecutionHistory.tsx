import { RequirementExecutionTimeline } from "./RequirementExecutionTimeline";
import { Button, Empty, Tag } from "antd";
import type { ClaudeSession } from "../../types";
import type { WorkspaceRequirementItem } from "../../types/workspaceRequirements";
import { SESSION_EXECUTION_ENGINE_LABELS } from "../../constants/sessionExecutionEngine";
import { openWorkspaceRequirementExecutionSession } from "../../stores/workspaceMemoPanelStore";
import {
  isRequirementExecutionActive,
  REQUIREMENT_EXECUTION_LABELS,
  requirementExecutionSessions,
  requirementExecutionState,
  type RequirementExecutionState,
} from "../../utils/workspaceRequirementExecution";

export function RequirementExecutionBadge({ state }: { state: RequirementExecutionState }) {
  const color = isRequirementExecutionActive(state) ? "processing"
    : state === "error" ? "error" : state === "cancelled" ? "warning" : "default";
  return <Tag color={color} className="app-requirement-execution-badge">{REQUIREMENT_EXECUTION_LABELS[state]}</Tag>;
}

export function RequirementExecutionHistory({ item, sessions, busy, onDispatch, onAccept, onReject }: {
  item: WorkspaceRequirementItem;
  sessions: readonly ClaudeSession[];
  busy: boolean;
  onDispatch: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const history = requirementExecutionSessions(item, sessions);
  const active = isRequirementExecutionActive(requirementExecutionState(item, sessions));
  return (
    <section className="app-requirement-execution-history" aria-label="执行与验收">
      <div className="app-requirement-execution-history__header">
        <strong>执行与验收</strong>
        <RequirementExecutionBadge state={requirementExecutionState(item, sessions)} />
        <span>{history.length} 个关联会话</span>
      </div>
      <p className="app-requirement-execution-history__hint">执行结束后请检查会话中的变更与验证结果，再确认需求完成。逐轮结果保存在下方时间线，完整过程可在会话内查看。</p>
      {history.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={item.lastDispatchedAt == null ? "尚未执行此需求" : "已派发，尚未关联执行会话"} />
      ) : (
        <ol className="app-requirement-execution-history__list">
          {[...history].reverse().map((row) => (
            <li key={row.sessionId}>
              <span>会话 {row.ordinal}{row.ordinal === history.length ? "（最近）" : ""}</span>
              <RequirementExecutionBadge state={row.state} />
              <span className="app-requirement-execution-history__hint">
                {row.session?.executionEngine ? SESSION_EXECUTION_ENGINE_LABELS[row.session.executionEngine].short : ""}
                {!row.session ? "会话未加载或已移除，打开会话尝试恢复" : ""}
              </span>
              <Button size="small" onClick={() => openWorkspaceRequirementExecutionSession(row.sessionId)}>
                {isRequirementExecutionActive(row.state) ? "查看运行" : "查看会话"}
              </Button>
            </li>
          ))}
        </ol>
      )}
      <RequirementExecutionTimeline key={item.id} requirementId={item.id} />
      <div className="app-requirement-execution-history__actions">
        {item.status !== "done" && <Button disabled={active || busy} loading={busy} onClick={onDispatch}>{history.length ? "重新执行" : "派发执行"}</Button>}
        {item.status === "verifying" && <>
          <Button disabled={active || busy || history.length === 0} onClick={onReject}>验收失败，继续修改</Button>
          <Button type="primary" disabled={active || busy} onClick={onAccept}>确认验收完成</Button>
        </>}
        {item.status === "done" && <Tag color="success">需求已验收完成</Tag>}
      </div>
    </section>
  );
}
