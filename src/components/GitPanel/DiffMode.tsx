import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { HoverHint } from "../shared/HoverHint";
import { Button, Input, message, Popconfirm, Space, Typography } from "antd";
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
import { executeClaudeCodeAndWait, getClaudeConfigModel } from "../../services/claude";
import type { GitFileStatus, GitStatusResponse } from "../../types";
import { extractClaudeInvocationFinalText } from "../../utils/claudeInvocationText";
import {
  conventionalCommitPromptLines,
  normalizeConventionalCommitMessage,
} from "../../utils/conventionalCommitMessage";
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

interface DiffModeProps {
  repositoryPath: string;
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
}

function DiffModeInner({
  repositoryPath,
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
}: DiffModeProps) {
  const [commitMsg, setCommitMsg] = useState("");
  const [unstagedViewMode, setUnstagedViewMode] = useState<UnstagedViewMode>("tree");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeAllExpanded, setTreeAllExpanded] = useState(false);
  const [stagedCollapsed, setStagedCollapsed] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [pushPreparing, setPushPreparing] = useState(false);
  const commitMsgRef = useRef(commitMsg);
  const hasChangesRef = useRef(false);
  const commitSubmitLockRef = useRef(false);
  commitMsgRef.current = commitMsg;
  const hasStaged = status.staged.length > 0;
  const hasUnstaged = status.unstaged.length > 0;
  const hasChanges = hasStaged || hasUnstaged;
  const ahead = status.ahead ?? 0;
  hasChangesRef.current = hasChanges;
  const showCommitCard = hasChanges || ahead > 0;
  const canCommit = commitMsg.trim().length > 0 && hasChanges && !loading.commit && !loading.commitAndPush;
  const canPush =
    (hasChanges || ahead > 0) &&
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

  const treeDirPaths = useMemo(() => {
    if (!useTreeView) return [];
    const dirs: string[] = [];
    const tree = buildFileTree([...status.staged, ...status.unstaged]);
    function collect(node: FileTreeNode) {
      if (node.isDir) {
        dirs.push(node.path);
        node.children?.forEach(collect);
      }
    }
    tree.forEach(collect);
    return dirs;
  }, [status.staged, status.unstaged, useTreeView]);

  const handleExpandAll = useCallback(() => {
    setExpandedDirs(new Set(treeDirPaths));
    setTreeAllExpanded(true);
  }, [treeDirPaths]);

  const handleCollapseAll = useCallback(() => {
    setExpandedDirs(new Set());
    setTreeAllExpanded(false);
  }, []);

  const handleToggleTree = useCallback(() => {
    if (treeAllExpanded) {
      handleCollapseAll();
    } else {
      handleExpandAll();
    }
  }, [treeAllExpanded, handleCollapseAll, handleExpandAll]);

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const generateCommitMessageByAi = useCallback(async (): Promise<{ message: string; aiFailed: boolean }> => {
    const fallback = buildCommitDraftFromStatus(status);
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
      const model = await getClaudeConfigModel(repositoryPath);
      const result = await executeClaudeCodeAndWait({
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
        connectionMode: "oneshot",
      });
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
  }, [ahead, repositoryPath, status]);

  const handleGenerateCommitByAi = useCallback(async () => {
    if (aiSummaryLoading) return;
    setAiSummaryLoading(true);
    try {
      const generated = await generateCommitMessageByAi();
      setCommitMsg(generated.message);
      if (generated.aiFailed) {
        message.warning("AI 生成失败，已填充默认提交信息。");
      }
    } finally {
      setAiSummaryLoading(false);
    }
  }, [aiSummaryLoading, generateCommitMessageByAi]);

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
    if (!hasChangesRef.current && ahead <= 0) return;

    commitSubmitLockRef.current = true;
    const rawMsg = commitMsgRef.current.trim();
    let trimmed = rawMsg ? normalizeConventionalCommitMessage(rawMsg) : "";
    try {
      if (!rawMsg) {
        setPushPreparing(true);
        setAiSummaryLoading(true);
        try {
          const generated = await generateCommitMessageByAi();
          trimmed = generated.message;
          setCommitMsg(trimmed);
          if (generated.aiFailed) {
            message.warning("AI 生成失败，已使用默认提交信息继续推送。");
          }
        } finally {
          setAiSummaryLoading(false);
          setPushPreparing(false);
        }
      }
      if (!trimmed) {
        message.warning("请先填写或生成提交信息");
        commitSubmitLockRef.current = false;
        return;
      }
      onCommitAndPush(trimmed);
      setCommitMsg("");
    } catch {
      commitSubmitLockRef.current = false;
    }
  }, [
    ahead,
    aiSummaryLoading,
    generateCommitMessageByAi,
    loading.commit,
    loading.commitAndPush,
    onCommitAndPush,
    pushPreparing,
  ]);

  return (
    <div className="git-diff-mode">
      {errors.commit && (
        <div className="git-error-banner">
          <Text type="danger" style={{ fontSize: 12 }}>{errors.commit}</Text>
          <Button
            type="text"
            size="small"
            icon={<span style={{ fontSize: 14 }}>&times;</span>}
            onClick={() => { }}
          />
        </div>
      )}

      {showCommitCard && (
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
              placeholder={hasChanges ? "提交信息..." : "待推送提交，可 AI 生成描述后推送"}
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
                disabled={aiSummaryLoading || loading.commitAndPush}
              >
                AI 生成
              </Button>
              {hasChanges ? (
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
              ) : null}
              <Button
                htmlType="button"
                type="text"
                size="small"
                className="git-push-btn"
                title="AI 生成提交信息并提交、拉取、推送"
                disabled={!canPush}
                icon={<CloudUploadOutlined />}
                onMouseDown={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (event.button !== 0 || !canPush) return;
                  event.preventDefault();
                  void submitCommitAndPush();
                }}
              >
                {loading.commitAndPush ? "推送中..." : pushPreparing ? "生成中..." : "推送"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {status.branch && (hasStaged || hasUnstaged) && (
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
            {hasChanges && (
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
            )}
          </div>
        </div>
      )}

      {hasChanges ? (
        <div className="git-diff-mode-scroll">
      {hasStaged && (
        <div className={`git-section${stagedCollapsed ? " git-section--collapsed" : ""}`}>
          <div className="git-section-header">
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>
              已暂存 ({status.staged.length})
            </Text>
            <Space size={4} className="git-section-header-actions-space">
              {useTreeView && (
                <HoverHint title={treeAllExpanded ? "收起目录树" : "展开目录树"} placement="top">
                  <Button
                    type="text"
                    size="small"
                    className="git-section-action-btn"
                    icon={treeAllExpanded ? <VerticalAlignBottomOutlined /> : <VerticalAlignTopOutlined />}
                    onClick={handleToggleTree}
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
                expandedDirs={expandedDirs}
                onToggleDir={handleToggleDir}
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
                <HoverHint title={treeAllExpanded ? "收起目录树" : "展开目录树"} placement="top">
                  <Button
                    type="text"
                    size="small"
                    className="git-section-action-btn"
                    icon={treeAllExpanded ? <VerticalAlignBottomOutlined /> : <VerticalAlignTopOutlined />}
                    onClick={handleToggleTree}
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
              expandedDirs={expandedDirs}
              onToggleDir={handleToggleDir}
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

      {hasChanges ? null : status.branch ? (
        <div className="git-diff-mode__empty" role="status">
          <CheckOutlined className="git-diff-mode__empty-icon" aria-hidden />
          <span>没有检测到变更</span>
        </div>
      ) : null}
    </div>
  );
}

export const DiffMode = memo(DiffModeInner);
