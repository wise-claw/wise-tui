import { Drawer, Empty, Space, Tag, Typography } from "antd";
import { useMemo, useRef } from "react";
import { ROLE_LABEL } from "../copy";
import type { ClaudeSession } from "../../../types";
import type { TaskDetailVM } from "../presenter/types";
import { ClaudeSessionMessagesColumn } from "../../ClaudeSessions/ClaudeSessionMessagesColumn";
import { buildDispatchSession } from "./buildDispatchSession";
import { useDispatchTranscript } from "./useDispatchTranscript";
import { buildDispatchSessionNeedles, resolveDispatchClaudeSession } from "./dispatchSessionResolver";
import { TraceabilityPanel } from "./TraceabilityPanel";
import { EngineeringFoldout } from "./EngineeringFoldout";
import { TaskEditorInline } from "./TaskEditorInline";
import { FailureEvidenceBlock } from "./FailureEvidenceBlock";

interface TaskDetailDrawerProps {
  open: boolean;
  detail: TaskDetailVM | null;
  stdoutLines: string[];
  sessions?: ClaudeSession[];
  repoPath?: string;
  repoName?: string;
  onClose: () => void;
  onPatchTitle: (clusterId: string, taskId: string, title: string, isManual: boolean) => void;
  onPatchDescription: (clusterId: string, taskId: string, description: string, isManual: boolean) => void;
  onPatchRole: (clusterId: string, taskId: string, role: TaskDetailVM["role"], isManual: boolean) => void;
  onPatchTaskList: (clusterId: string, taskId: string, field: "subtasks" | "dod", items: string[], isManual: boolean) => void;
  onDeleteTask: (clusterId: string, taskId: string) => void;
  onRestoreTask: (clusterId: string, taskId: string) => void;
  onAddTask: (clusterId: string, sourceRequirementIds: string[]) => string | null;
  onOpenPrdAnchor: () => void;
  onRetryFromRunDir?: (runId: string, clusterId: string) => void;
}

export function TaskDetailDrawer({
  open,
  detail,
  stdoutLines,
  sessions = [],
  repoPath,
  repoName,
  onClose,
  onPatchTitle,
  onPatchDescription,
  onPatchRole,
  onPatchTaskList,
  onDeleteTask,
  onRestoreTask,
  onAddTask,
  onOpenPrdAnchor,
  onRetryFromRunDir,
}: TaskDetailDrawerProps) {
  const isPlaceholder = detail
    ? detail.subtasks.length === 0 && detail.dod.length === 0 && detail.role === null
    : false;
  const hasDispatchRaw = Boolean(detail?.technical.dispatchRaw);
  const showDispatchSession = Boolean(detail && (isPlaceholder || hasDispatchRaw));
  const dispatchSessionMatch = useMemo(
    () => resolveDispatchClaudeSession({ sessions, detail, repoPath }),
    [sessions, detail, repoPath],
  );
  const dispatchSessionNeedles = useMemo(
    () => buildDispatchSessionNeedles({ detail, raw: detail?.technical.dispatchRaw, repoPath }),
    [detail, repoPath],
  );
  const shouldLoadFallbackTranscript = showDispatchSession && (dispatchSessionMatch?.session.messages.length ?? 0) === 0;
  const dispatchTranscript = useDispatchTranscript({
    open: open && shouldLoadFallbackTranscript,
    raw: detail?.technical.dispatchRaw,
    liveStdoutLines: stdoutLines,
    repositoryPath: repoPath,
    sessionId: dispatchSessionMatch?.session.claudeSessionId ?? dispatchSessionMatch?.session.id ?? null,
    fallbackSessionNeedles:
      dispatchSessionMatch?.reason === "claude-session-id" || detail?.technical.dispatchRaw?.claudeSessionId
        ? []
        : dispatchSessionNeedles,
  });
  const dispatchErrorText = detail?.status === "blocked" ? detail.description.trim() : "";
  const dispatchProgressError = detail?.technical.dispatchError ?? null;
  const dispatchError = detail?.technical.dispatchRaw || dispatchProgressError || detail?.status === "blocked"
    ? detail?.technical.dispatchRaw
      ? {
        summary: dispatchErrorText || "Dispatch failed",
        exitCode: detail.technical.dispatchRaw.exitCode,
        stdoutPath: detail.technical.dispatchRaw.stdoutPath,
        stderrPath: detail.technical.dispatchRaw.stderrPath,
      }
      : {
        summary: dispatchProgressError?.summary || dispatchErrorText || "Dispatch failed",
        exitCode: dispatchProgressError?.exitCode ?? null,
        stdoutPath: dispatchProgressError?.stdoutPath ?? "",
        stderrPath: dispatchProgressError?.stderrPath ?? "",
      }
    : null;

  const dispatchSession = useMemo(() => {
    if (!detail || !showDispatchSession) return null;
    if (dispatchSessionMatch?.session.messages.length) return dispatchSessionMatch.session;
    return buildDispatchSession({
      clusterId: detail.clusterId,
      clusterTitle: detail.title,
      repoPath: repoPath ?? "",
      repoName: repoName ?? "",
      claudeSessionId: detail.technical.dispatchRaw?.claudeSessionId ?? null,
      stdout: dispatchTranscript.stdoutText,
      stderr: [dispatchTranscript.stderrText, dispatchErrorText].filter(Boolean).join("\n\n"),
      result: dispatchTranscript.resultText,
      diskMessages: dispatchTranscript.diskMessages,
      isRunning: dispatchTranscript.loading || detail.status === "running" || detail.status === "preparing",
    });
  }, [detail, showDispatchSession, dispatchSessionMatch, repoPath, repoName, dispatchTranscript, dispatchErrorText]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  if (!detail) {
    return (
      <Drawer
        title="任务详情"
        open={open}
        onClose={onClose}
        size={560}
        push
        rootClassName="mission-task-detail-drawer"
        classNames={{ body: "mission-task-detail-drawer__body" }}
      >
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击左侧任务卡片查看详情" />
      </Drawer>
    );
  }

  const bodyClassName = [
    "mission-task-detail-drawer__body",
    showDispatchSession ? "mission-task-detail-drawer__body--session" : "",
  ].filter(Boolean).join(" ");
  const contentClassName = [
    "mission-task-detail-drawer__content",
    showDispatchSession ? "mission-task-detail-drawer__content--session" : "",
  ].filter(Boolean).join(" ");
  const showDescription = Boolean(detail.description && (!isPlaceholder || detail.status === "blocked"));

  return (
    <Drawer
      title={detail.title}
      open={open}
      onClose={onClose}
      size={560}
      push
      rootClassName="mission-task-detail-drawer"
      classNames={{ body: bodyClassName }}
    >
      <div className={contentClassName}>
        {/* Status summary */}
        <div className="mission-evidence-summary">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography.Text type="secondary">{detail.repositoryLabel ?? ""}</Typography.Text>
            <span className={`mission-status mission-status--${detail.status}`}>
              <i />
              {detail.statusLabel}
            </span>
          </div>
          {!isPlaceholder ? (
            <Space size={6} wrap style={{ marginTop: 8 }}>
              {detail.role ? <Tag>{ROLE_LABEL[detail.role]}</Tag> : null}
              {detail.priority ? <Tag color="red">{detail.priority}</Tag> : null}
              {detail.isEdited ? <Tag color="warning">已编辑</Tag> : null}
              {detail.isManual ? <Tag color="blue">手动添加</Tag> : null}
            </Space>
          ) : null}
          {showDescription ? (
            <Typography.Paragraph className="mission-evidence__description" type="secondary">
              {detail.description}
            </Typography.Paragraph>
          ) : null}
        </div>

        {showDispatchSession && dispatchSession ? (
          <>
            {detail.status === "blocked" || detail.technical.dispatchRaw ? (
              <FailureEvidenceBlock
                raw={detail.technical.dispatchRaw}
                error={dispatchError}
                clusterId={detail.clusterId}
                onRetryFromRunDir={onRetryFromRunDir}
              />
            ) : null}
            <div className="mission-dispatch-session">
              <ClaudeSessionMessagesColumn
                session={dispatchSession}
                showAllMessages
                scrollContainerRef={scrollRef}
              />
            </div>
          </>
        ) : (
          <>
            {/* Source requirements */}
            <section className="mission-evidence-section">
              <Typography.Text className="mission-evidence-section__title">关联需求</Typography.Text>
              {detail.sourceRequirements.map((requirement) => (
                <div key={requirement.id} className="mission-source-requirement">
                  <Typography.Text strong>{requirement.id}</Typography.Text>
                  <Typography.Text>{requirement.bodyPreview}</Typography.Text>
                </div>
              ))}
            </section>

            {/* PRD & code anchors */}
            <TraceabilityPanel detail={detail} onOpenPrdAnchor={onOpenPrdAnchor} />

            {/* Task editor */}
            <TaskEditorInline
              evidence={detail}
              onPatchTitle={onPatchTitle}
              onPatchDescription={onPatchDescription}
              onPatchRole={onPatchRole}
              onPatchTaskList={onPatchTaskList}
              onDeleteTask={onDeleteTask}
              onRestoreTask={onRestoreTask}
              onAddTask={onAddTask}
            />

            {/* Engineering details (collapsed by default) */}
            <EngineeringFoldout evidence={detail} />
          </>
        )}
      </div>
    </Drawer>
  );
}
