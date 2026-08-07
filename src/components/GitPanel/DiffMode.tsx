import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { useDiffModeExpandedDirs } from "./useDiffModeExpandedDirs";
import { HoverHint } from "../shared/HoverHint";
import { Button, Input, Modal, message, notification, Popconfirm, Space, Typography } from "antd";
import {
  ApartmentOutlined,
  CheckOutlined,
  CloudUploadOutlined,
  MinusOutlined,
  PlusOutlined,
  UnorderedListOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import { cancelClaudeInvocation, getClaudeConfigModel } from "../../services/claude";
import { needsPublishBranch } from "../../services/gitCommitPullPush";
import { executeSessionEngineAndWait } from "../../services/sessionEngineInvocation";
import type { GitFileStatus, GitStatusResponse } from "../../types";
import { extractClaudeInvocationFinalText } from "../../utils/claudeInvocationText";
import {
  conventionalCommitPromptLines,
  normalizeConventionalCommitMessage,
} from "../../utils/conventionalCommitMessage";
import { openCodeReviewDrawer } from "../../constants/workflowUiEvents";
import {
  buildCodeReviewToastContent,
  evaluatePrePushCodeReview,
} from "../../services/codeReview";
import { useScrollEndClass } from "../../hooks/useScrollEndClass";
import { LEFT_SIDEBAR_SCROLLING_CLASS } from "../../constants/leftSidebarScrollPerformance";
import { buildFileTree } from "./fileTree";
import { FileRow } from "./FileRow";
import { FileTreeView } from "./FileTreeView";
import { GitFileListSection } from "./GitFileListSection";
import { GitBranchSwitcher } from "./GitBranchSwitcher";
import { buildCommitDraftFromStatus } from "./gitPanelUtils";
import { RevertIcon } from "./RevertIcon";
import type { FileTreeNode, GitPanelOpenFileOptions, UnstagedViewMode } from "./types";

const { TextArea } = Input;
const { Text } = Typography;

function collectTreeDirPaths(files: GitFileStatus[]): string[] {
  const dirs: string[] = [];
  function collect(node: FileTreeNode) {
    if (node.isDir) {
      dirs.push(node.path);
      node.children?.forEach(collect);
    }
  }
  buildFileTree(files).forEach(collect);
  return dirs;
}

interface DiffModeProps {
  repositoryPath: string;
  /** 仓库默认执行引擎；AI 生成提交信息时使用。 */
  executionEngine?: SessionExecutionEngine;
  status: GitStatusResponse;
  loading: Record<string, boolean>;
  errors: Record<string, string>;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void | Promise<void>;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardAll: () => void | Promise<void>;
  onCommit: (msg: string) => void;
  onCommitAndPush: (msg: string) => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onBranchChanged?: () => void;
  /** 用户主动关闭某个 error banner；key 与 errors 字典的键一致（如 "commit"）。 */
  onDismissError?: (key: string) => void;
}

function DiffModeInner({
  repositoryPath,
  executionEngine,
  status,
  loading,
  errors,
  onStage,
  onUnstage,
  onDiscard,
  onStageAll,
  onUnstageAll,
  onDiscardAll,
  onCommit,
  onCommitAndPush,
  onOpenFile,
  onBranchChanged,
  onDismissError,
}: DiffModeProps) {
  const [commitMsg, setCommitMsg] = useState("");
  const [unstagedViewMode, setUnstagedViewMode] = useState<UnstagedViewMode>("tree");
  const [stagedCollapsed, setStagedCollapsed] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [pushPreparing, setPushPreparing] = useState(false);
  const commitMsgRef = useRef(commitMsg);
  const hasChangesRef = useRef(false);
  const commitSubmitLockRef = useRef(false);
  const aiInvocationKeyRef = useRef<string | null>(null);
  const aiGenerationCancelledRef = useRef(false);
  commitMsgRef.current = commitMsg;
  const hasStaged = status.staged.length > 0;
  const hasUnstaged = status.unstaged.length > 0;
  const hasChanges = hasStaged || hasUnstaged;
  const diffScrollRef = useRef<HTMLDivElement | null>(null);
  useScrollEndClass(diffScrollRef, LEFT_SIDEBAR_SCROLLING_CLASS, 180, {
    relieveSidePanelPriority: true,
  });
  const ahead = status.ahead ?? 0;
  hasChangesRef.current = hasChanges;
  const needsPublish = needsPublishBranch(status);

  const canCommit = commitMsg.trim().length > 0 && hasChanges && !loading.commit && !loading.commitAndPush;
  const canPush =
    (hasChanges || ahead > 0 || needsPublish) &&
    !loading.commit &&
    !loading.commitAndPush &&
    !aiSummaryLoading &&
    !pushPreparing;

  useEffect(() => {
    if (!loading.commit && !loading.commitAndPush) {
      commitSubmitLockRef.current = false;
    }
  }, [loading.commit, loading.commitAndPush]);

  const renderStagedRow = useCallback(
    (file: GitFileStatus) => (
      <FileRow file={file} section="staged" onUnstage={onUnstage} onOpenFile={onOpenFile} />
    ),
    [onUnstage, onOpenFile],
  );

  const renderUnstagedRow = useCallback(
    (file: GitFileStatus) => (
      <FileRow
        file={file}
        section="unstaged"
        onStage={onStage}
        onDiscard={onDiscard}
        onOpenFile={onOpenFile}
      />
    ),
    [onDiscard, onOpenFile, onStage],
  );

  const useTreeView = unstagedViewMode === "tree";

  const stagedTreeDirPaths = useMemo(() => {
    if (!useTreeView) return [];
    return collectTreeDirPaths(status.staged);
  }, [status.staged, useTreeView]);

  const unstagedTreeDirPaths = useMemo(() => {
    if (!useTreeView) return [];
    return collectTreeDirPaths(status.unstaged);
  }, [status.unstaged, useTreeView]);

  const stagedExpand = useDiffModeExpandedDirs(repositoryPath, stagedTreeDirPaths, "staged");
  const unstagedExpand = useDiffModeExpandedDirs(repositoryPath, unstagedTreeDirPaths, "unstaged");

  const handleToggleStagedTree = useCallback(() => {
    if (stagedExpand.isTreeAllExpanded) {
      stagedExpand.collapseAll();
    } else {
      stagedExpand.expandAll(stagedTreeDirPaths);
    }
  }, [
    stagedExpand.isTreeAllExpanded,
    stagedExpand.collapseAll,
    stagedExpand.expandAll,
    stagedTreeDirPaths,
  ]);

  const handleToggleUnstagedTree = useCallback(() => {
    if (unstagedExpand.isTreeAllExpanded) {
      unstagedExpand.collapseAll();
    } else {
      unstagedExpand.expandAll(unstagedTreeDirPaths);
    }
  }, [
    unstagedExpand.isTreeAllExpanded,
    unstagedExpand.collapseAll,
    unstagedExpand.expandAll,
    unstagedTreeDirPaths,
  ]);

  const generateCommitMessageByAi = useCallback(async (): Promise<{ message: string; aiFailed: boolean }> => {
    const fallback = buildCommitDraftFromStatus(status);
    if (aiGenerationCancelledRef.current) {
      return { message: fallback, aiFailed: true };
    }
    const allFiles = [...status.staged, ...status.unstaged];
    const previewLimit = 40;
    const filesPreview = allFiles
      .slice(0, previewLimit)
      .map((f) => `- ${f.path} (${f.status}, +${f.additions}, -${f.deletions})`)
      .join("\n");
    const files =
      allFiles.length > previewLimit
        ? `${filesPreview}\n- ... 另有 ${allFiles.length - previewLimit} 个文件未列出`
        : filesPreview;
    try {
      const engine = executionEngine ?? "claude";
      const model = engine === "claude" ? await getClaudeConfigModel(repositoryPath) : undefined;
      const result = await executeSessionEngineAndWait({
        executionEngine: engine,
        repositoryPath,
        prompt: [
          ...conventionalCommitPromptLines(),
          "",
          `分支: ${status.branch ?? "unknown"}`,
          `统计: +${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`,
          `暂存数量: ${status.staged.length}, 未暂存数量: ${status.unstaged.length}`,
          ahead > 0 ? `待推送提交数: ${ahead}` : "",
          "文件列表：",
          files || "- 无",
        ]
          .filter(Boolean)
          .join("\n"),
        model: model ?? undefined,
        timeoutMs: 45_000,
        onInvocationKey: (invocationKey) => {
          aiInvocationKeyRef.current = invocationKey;
        },
      });
      if (aiGenerationCancelledRef.current) {
        return { message: fallback, aiFailed: true };
      }
      if (!result.success) {
        return { message: fallback, aiFailed: true };
      }
      const text = extractClaudeInvocationFinalText(result.outputLines);
      return {
        message: normalizeConventionalCommitMessage(text || fallback),
        aiFailed: false,
      };
    } catch {
      return { message: fallback, aiFailed: true };
    }
  }, [ahead, executionEngine, repositoryPath, status]);

  const handleGenerateCommitByAi = useCallback(async () => {
    if (aiSummaryLoading) return;
    aiGenerationCancelledRef.current = false;
    aiInvocationKeyRef.current = null;
    setAiSummaryLoading(true);
    try {
      const generated = await generateCommitMessageByAi();
      if (aiGenerationCancelledRef.current) return;
      setCommitMsg(generated.message);
      if (generated.aiFailed) {
        message.warning("AI 生成失败，已填充默认提交信息。");
      }
    } finally {
      if (!aiGenerationCancelledRef.current) {
        setAiSummaryLoading(false);
      }
      aiInvocationKeyRef.current = null;
    }
  }, [aiSummaryLoading, generateCommitMessageByAi]);

  const cancelPushPreparation = useCallback(() => {
    aiGenerationCancelledRef.current = true;
    const invocationKey = aiInvocationKeyRef.current;
    if (invocationKey) {
      void cancelClaudeInvocation(invocationKey).catch(() => {});
    }
    aiInvocationKeyRef.current = null;
    commitSubmitLockRef.current = false;
    setAiSummaryLoading(false);
    setPushPreparing(false);
  }, []);

  /** 在 TextArea blur 之前于 pointerdown 触发，避免「第一次点击只失焦不提交」。 */
  const submitCommit = useCallback(() => {
    if (loading.commit || loading.commitAndPush || commitSubmitLockRef.current) return;
    const rawMsg = commitMsgRef.current.trim();
    if (!rawMsg || !hasChangesRef.current) return;
    const trimmed = normalizeConventionalCommitMessage(rawMsg);
    commitSubmitLockRef.current = true;
    onCommit(trimmed);
    setCommitMsg("");
  }, [loading.commit, loading.commitAndPush, onCommit]);

  const submitCommitAndPush = useCallback(async () => {
    if (loading.commit || loading.commitAndPush || commitSubmitLockRef.current || pushPreparing || aiSummaryLoading) {
      return;
    }
    const publishOnly = !hasChangesRef.current && needsPublishBranch(status) && ahead <= 0;
    if (!hasChangesRef.current && ahead <= 0 && !publishOnly) return;

    commitSubmitLockRef.current = true;

    // 仅发布本地分支到远端：无需提交信息 / AI 润色。
    if (publishOnly) {
      onCommitAndPush("");
      return;
    }

    const rawMsg = commitMsgRef.current.trim();
    let trimmed = rawMsg ? normalizeConventionalCommitMessage(rawMsg) : "";
    try {
      if (!rawMsg) {
        aiGenerationCancelledRef.current = false;
        aiInvocationKeyRef.current = null;
        setPushPreparing(true);
        setAiSummaryLoading(true);
        try {
          const generated = await generateCommitMessageByAi();
          if (aiGenerationCancelledRef.current) {
            commitSubmitLockRef.current = false;
            return;
          }
          trimmed = generated.message;
          setCommitMsg(trimmed);
          if (generated.aiFailed) {
            message.warning("AI 生成失败，已使用默认提交信息继续推送。");
          }
        } finally {
          if (!aiGenerationCancelledRef.current) {
            setAiSummaryLoading(false);
            setPushPreparing(false);
          }
          aiInvocationKeyRef.current = null;
        }
      }
      if (aiGenerationCancelledRef.current) {
        commitSubmitLockRef.current = false;
        return;
      }
      if (!trimmed) {
        message.warning("请先填写或生成提交信息");
        commitSubmitLockRef.current = false;
        return;
      }

      setPushPreparing(true);
      try {
        const decision = await evaluatePrePushCodeReview({
          repositoryPath,
          hasUncommittedChanges: hasChangesRef.current,
          executionEngine,
          onInvocationKey: (key) => {
            aiInvocationKeyRef.current = key;
          },
        });
        if (aiGenerationCancelledRef.current) {
          commitSubmitLockRef.current = false;
          return;
        }
        if (decision.action === "abort") {
          message.error(decision.reason);
          if (decision.run) {
            openCodeReviewDrawer({
              repositoryPath,
              executionEngine,
              autoStart: false,
              initialScope: hasChangesRef.current ? "uncommitted" : "branch",
              seededRun: decision.run,
            });
          }
          commitSubmitLockRef.current = false;
          return;
        }
        if (decision.action === "confirm") {
          const confirmed = await new Promise<boolean>((resolve) => {
            Modal.confirm({
              title: "推送前审查发现高危问题",
              content: decision.reason,
              okText: "仍要推送",
              cancelText: "查看详情",
              onOk: () => resolve(true),
              onCancel: () => resolve(false),
            });
          });
          if (!confirmed) {
            openCodeReviewDrawer({
              repositoryPath,
              executionEngine,
              autoStart: false,
              initialScope: hasChangesRef.current ? "uncommitted" : "branch",
              seededRun: decision.run,
            });
            commitSubmitLockRef.current = false;
            return;
          }
        }
        if (decision.action === "continue" && decision.run) {
          const toast = buildCodeReviewToastContent(decision.run, { context: "pre-push" });
          if (toast.actionable) {
            const seededRun = decision.run;
            const notificationKey = `code-review-pre-push-${seededRun.id}`;
            notification.open({
              key: notificationKey,
              type: toast.level,
              message: toast.title,
              description: toast.description,
              duration: 6,
              btn: (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    notification.destroy(notificationKey);
                    openCodeReviewDrawer({
                      repositoryPath,
                      executionEngine,
                      autoStart: false,
                      initialScope: hasChangesRef.current ? "uncommitted" : "branch",
                      seededRun,
                    });
                  }}
                >
                  查看详情
                </Button>
              ),
            });
          }
        }
      } finally {
        if (!aiGenerationCancelledRef.current) {
          setPushPreparing(false);
        }
        aiInvocationKeyRef.current = null;
      }

      onCommitAndPush(trimmed);
      setCommitMsg("");
    } catch {
      commitSubmitLockRef.current = false;
      setPushPreparing(false);
    }
  }, [
    ahead,
    aiSummaryLoading,
    executionEngine,
    generateCommitMessageByAi,
    loading.commit,
    loading.commitAndPush,
    onCommitAndPush,
    pushPreparing,
    repositoryPath,
    status,
  ]);

  return (
    <div className="git-diff-mode">
      {errors.commit && (
        <div className="git-error-banner">
          <Text type="danger" style={{ fontSize: 12 }}>{errors.commit}</Text>
          <Button
            type="text"
            size="small"
            aria-label="关闭错误提示"
            icon={<span style={{ fontSize: 14 }}>&times;</span>}
            onClick={() => onDismissError?.("commit")}
          />
        </div>
      )}

      {status.branch ? (
        <div className="git-diff-mode__head">
          <div className="git-commit-section">
            <form
              className="git-commit-card"
              onSubmit={(event) => {
                event.preventDefault();
                submitCommit();
              }}
            >
              <TextArea
                className="git-commit-card__input"
                variant="borderless"
                placeholder={
                  hasChanges
                    ? "提交信息..."
                    : needsPublish
                      ? "本地分支尚未同步到远端，可直接同步"
                      : "待推送提交，可 AI 生成描述后推送"
                }
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
                  event.preventDefault();
                  if (event.shiftKey) {
                    void submitCommitAndPush();
                    return;
                  }
                  submitCommit();
                }}
              rows={1}
              autoSize={{ minRows: 1, maxRows: 2 }}
            />
            <div className="git-commit-card__footer">
              <Button
                type="text"
                size="small"
                className="git-ai-summary-btn"
                title="根据当前变更 AI 生成提交信息"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleGenerateCommitByAi()}
                loading={aiSummaryLoading && !pushPreparing}
                disabled={aiSummaryLoading || loading.commitAndPush || !hasChanges}
              >
                AI 生成
              </Button>
              <Button
                htmlType="button"
                type="text"
                size="small"
                className="git-commit-btn"
                disabled={!canCommit || loading.commit}
                icon={<CheckOutlined />}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  submitCommit();
                }}
              >
                {loading.commit ? "提交中..." : "提交"}
              </Button>
              <div className="git-commit-card__push-group">
                <Button
                  htmlType="button"
                  type="text"
                  size="small"
                  className="git-push-btn"
                  title={
                    needsPublish && !hasChanges && ahead <= 0
                      ? "将本地分支同步（发布）到远端"
                      : "AI 生成提交信息并提交、拉取、推送（可开启推送前审查）"
                  }
                  disabled={!canPush}
                  icon={<CloudUploadOutlined />}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || !canPush) return;
                    event.preventDefault();
                    void submitCommitAndPush();
                  }}
                >
                  {loading.commitAndPush
                    ? "推送中..."
                    : pushPreparing
                      ? "生成中..."
                      : needsPublish && !hasChanges && ahead <= 0
                        ? "同步到远端"
                        : "推送"}
                </Button>
                {pushPreparing ? (
                  <Button
                    htmlType="button"
                    type="text"
                    size="small"
                    className="git-push-cancel-btn"
                    title="取消 AI 生成"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={cancelPushPreparation}
                  >
                    取消
                  </Button>
                ) : null}
              </div>
            </div>
          </form>
          </div>

          <div className="git-push-section">
            <Space size={2}>
              <Text style={{ fontSize: 11, color: "#8b8b8b" }}>合计:</Text>
              <Text style={{ fontSize: 11, color: "#52c41a" }}>
                +{status.additions}
              </Text>
              <Text style={{ fontSize: 11, color: "#8b8b8b" }}>/</Text>
              <Text style={{ fontSize: 11, color: "#ff4d4f" }}>
                -{status.deletions}
              </Text>
            </Space>
            <div className="git-push-section__actions">
              <GitBranchSwitcher
                repositoryPath={repositoryPath}
                branchHint={status.branch}
                onBranchChanged={onBranchChanged}
              />
              {hasChanges ? (
                <span className="git-view-toggle">
                  <Button
                    type={unstagedViewMode === "tree" ? "primary" : "text"}
                    size="small"
                    icon={<ApartmentOutlined />}
                    onClick={() => setUnstagedViewMode("tree")}
                    style={{ width: 24, height: 20, padding: 0, fontSize: 11 }}
                    aria-label="树状视图"
                  />
                  <Button
                    type={unstagedViewMode === "list" ? "primary" : "text"}
                    size="small"
                    icon={<UnorderedListOutlined />}
                    onClick={() => setUnstagedViewMode("list")}
                    style={{ width: 24, height: 20, padding: 0, fontSize: 11 }}
                    aria-label="列表视图"
                  />
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {!hasChanges && status.branch ? (
        needsPublish ? (
          <div className="git-diff-mode__empty git-diff-mode__empty--publish" role="status">
            <CloudUploadOutlined className="git-diff-mode__empty-icon git-diff-mode__empty-icon--publish" aria-hidden />
            <span>
              本地分支「{status.branch}」尚未同步到远端
            </span>
            <Button
              type="link"
              size="small"
              className="git-diff-mode__publish-btn"
              disabled={!canPush}
              loading={loading.commitAndPush}
              onClick={() => void submitCommitAndPush()}
            >
              同步到远端
            </Button>
          </div>
        ) : (
          <div className="git-diff-mode__empty" role="status">
            <CheckOutlined className="git-diff-mode__empty-icon" aria-hidden />
            <span>没有检测到变更</span>
          </div>
        )
      ) : null}

      {hasChanges ? (
        <div className="git-diff-mode-scroll" ref={diffScrollRef}>
      {hasStaged && (
        <div className={`git-section${stagedCollapsed ? " git-section--collapsed" : ""}`}>
          <div className="git-section-header">
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>
              已暂存 ({status.staged.length})
            </Text>
            <Space size={4} className="git-section-header-actions-space">
              {useTreeView && (
                <HoverHint title={stagedExpand.isTreeAllExpanded ? "收起目录树" : "展开目录树"} placement="top">
                  <Button
                    type="text"
                    size="small"
                    className="git-section-action-btn"
                    icon={stagedExpand.isTreeAllExpanded ? <VerticalAlignBottomOutlined /> : <VerticalAlignTopOutlined />}
                    onClick={handleToggleStagedTree}
                  />
                </HoverHint>
              )}
              <HoverHint title={stagedCollapsed ? "展开已暂存" : "收起已暂存"} placement="top">
                <Button
                  type="text"
                  size="small"
                  className="git-section-action-btn"
                  icon={stagedCollapsed ? <VerticalAlignTopOutlined /> : <VerticalAlignBottomOutlined />}
                  onClick={() => setStagedCollapsed((prev) => !prev)}
                  aria-expanded={!stagedCollapsed}
                  aria-label={stagedCollapsed ? "展开已暂存" : "收起已暂存"}
                />
              </HoverHint>
              <HoverHint title="全部取消暂存" placement="topRight">
                <Button
                  type="text"
                  size="small"
                  className="git-section-action-btn"
                  icon={<MinusOutlined />}
                  onClick={onUnstageAll}
                  disabled={loading.unstageAll || loading.stageAll}
                />
              </HoverHint>
            </Space>
          </div>
          {!stagedCollapsed ? (
            useTreeView ? (
              <FileTreeView
                files={status.staged}
                section="staged"
                expandedDirs={stagedExpand.expandedDirs}
                onToggleDir={stagedExpand.toggleDir}
                onToggleDirRecursive={stagedExpand.toggleDirRecursive}
                onUnstage={onUnstage}
                onOpenFile={onOpenFile}
              />
            ) : (
              <GitFileListSection files={status.staged} renderRow={renderStagedRow} />
            )
          ) : null}
        </div>
      )}

      {hasUnstaged && (
        <div className="git-section">
          <div className="git-section-header">
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>
              更改 ({status.unstaged.length})
            </Text>
            <Space size={4} className="git-section-header-actions-space">
              {useTreeView && (
                <HoverHint title={unstagedExpand.isTreeAllExpanded ? "收起目录树" : "展开目录树"} placement="top">
                  <Button
                    type="text"
                    size="small"
                    className="git-section-action-btn"
                    icon={unstagedExpand.isTreeAllExpanded ? <VerticalAlignBottomOutlined /> : <VerticalAlignTopOutlined />}
                    onClick={handleToggleUnstagedTree}
                  />
                </HoverHint>
              )}
              <HoverHint title="全部暂存" placement="top">
                <Button
                  type="text"
                  size="small"
                  className="git-section-action-btn"
                  icon={<PlusOutlined />}
                  onClick={onStageAll}
                  disabled={loading.stageAll || loading.unstageAll || loading.discardAll}
                />
              </HoverHint>
              <Popconfirm
                classNames={{ root: "app-git-discard-popconfirm" }}
                title="确认放弃全部更改？"
                description="未暂存修改将永久丢失。"
                okText="全部放弃"
                cancelText="取消"
                okButtonProps={{ danger: true, size: "small" }}
                cancelButtonProps={{ size: "small" }}
                placement="bottomRight"
                getPopupContainer={() => document.body}
                styles={{ container: { width: 228, maxWidth: "min(228px, 78vw)" } }}
                disabled={loading.stageAll || loading.unstageAll || loading.discardAll}
                onConfirm={onDiscardAll}
              >
                <HoverHint title="放弃全部更改" placement="topRight">
                  <Button
                    type="text"
                    size="small"
                    className="git-section-action-btn"
                    icon={<RevertIcon />}
                    disabled={loading.stageAll || loading.unstageAll || loading.discardAll}
                  />
                </HoverHint>
              </Popconfirm>
            </Space>
          </div>
          {useTreeView ? (
            <FileTreeView
              files={status.unstaged}
              section="unstaged"
              expandedDirs={unstagedExpand.expandedDirs}
              onToggleDir={unstagedExpand.toggleDir}
              onToggleDirRecursive={unstagedExpand.toggleDirRecursive}
              onStage={onStage}
              onDiscard={onDiscard}
              onOpenFile={onOpenFile}
            />
          ) : (
            <GitFileListSection files={status.unstaged} renderRow={renderUnstagedRow} />
          )}
        </div>
      )}
        </div>
      ) : null}

    </div>
  );
}

export const DiffMode = memo(DiffModeInner);
