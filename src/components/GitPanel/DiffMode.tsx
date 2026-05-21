import { useCallback, useMemo, useState } from "react";
import { Button, Empty, Input, message, Popconfirm, Space, Tooltip, Typography } from "antd";
import {
  ApartmentOutlined,
  CheckOutlined,
  MinusOutlined,
  PlusOutlined,
  UnorderedListOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import { executeClaudeCodeAndWait, getClaudeConfigModel } from "../../services/claude";
import type { GitStatusResponse } from "../../types";
import { extractClaudeInvocationFinalText } from "../../utils/claudeInvocationText";
import { buildFileTree } from "./fileTree";
import { FileRow } from "./FileRow";
import { FileTreeView } from "./FileTreeView";
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
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

export function DiffMode({
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
  onOpenFile,
}: DiffModeProps) {
  const [commitMsg, setCommitMsg] = useState("");
  const [unstagedViewMode, setUnstagedViewMode] = useState<UnstagedViewMode>("tree");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeAllExpanded, setTreeAllExpanded] = useState(false);
  const [stagedCollapsed, setStagedCollapsed] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const hasStaged = status.staged.length > 0;
  const hasUnstaged = status.unstaged.length > 0;
  const hasChanges = hasStaged || hasUnstaged;
  const canCommit = commitMsg.trim().length > 0 && hasChanges && !loading.commit;

  const unstagedDirPaths = useMemo(() => {
    if (unstagedViewMode !== "tree") return [];
    const dirs: string[] = [];
    const tree = buildFileTree(status.unstaged);
    function collect(node: FileTreeNode) {
      if (node.isDir) {
        dirs.push(node.path);
        node.children?.forEach(collect);
      }
    }
    tree.forEach(collect);
    return dirs;
  }, [status.unstaged, unstagedViewMode]);

  const handleExpandAll = useCallback(() => {
    setExpandedDirs(new Set(unstagedDirPaths));
    setTreeAllExpanded(true);
  }, [unstagedDirPaths]);

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

  const handleGenerateCommitByAi = useCallback(async () => {
    if (aiSummaryLoading) return;
    setAiSummaryLoading(true);
    try {
      const fallback = buildCommitDraftFromStatus(status);
      const files = [...status.staged, ...status.unstaged]
        .map((f) => `- ${f.path} (${f.status}, +${f.additions}, -${f.deletions})`)
        .join("\n");
      const model = await getClaudeConfigModel(repositoryPath);
      const result = await executeClaudeCodeAndWait({
        repositoryPath,
        prompt: [
          "你是资深工程师，请根据 git 变更生成可直接提交的中文 commit message。",
          "要求：1-3 行，简洁专业，仅输出提交信息正文，不要解释。",
          "",
          `分支: ${status.branch ?? "unknown"}`,
          `统计: +${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`,
          `暂存数量: ${status.staged.length}, 未暂存数量: ${status.unstaged.length}`,
          "文件列表：",
          files || "- 无",
        ].join("\n"),
        model: model ?? undefined,
        timeoutMs: 45_000,
        connectionMode: "oneshot",
      });
      if (!result.success) {
        setCommitMsg(fallback);
        message.warning("AI 生成失败，已填充默认提交信息。");
        return;
      }
      const text = extractClaudeInvocationFinalText(result.outputLines);
      setCommitMsg(text || fallback);
    } catch {
      setCommitMsg(buildCommitDraftFromStatus(status));
      message.warning("AI 生成失败，已填充默认提交信息。");
    } finally {
      setAiSummaryLoading(false);
    }
  }, [aiSummaryLoading, repositoryPath, status]);

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

      {hasChanges && (
        <div className="git-commit-section">
          <div className="git-commit-card">
            <TextArea
              className="git-commit-card__input"
              variant="borderless"
              placeholder="提交信息..."
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              rows={1}
              autoSize={{ minRows: 1, maxRows: 2 }}
            />
            <div className="git-commit-card__footer">
              <Button
                type="text"
                size="small"
                className="git-ai-summary-btn"
                title="根据当前变更 AI 生成提交信息"
                onClick={() => void handleGenerateCommitByAi()}
                loading={aiSummaryLoading}
                disabled={aiSummaryLoading}
              >
                AI 生成
              </Button>
              <Button
                type="text"
                size="small"
                className="git-commit-btn"
                onClick={() => {
                  if (canCommit) {
                    onCommit(commitMsg);
                    setCommitMsg("");
                  }
                }}
                disabled={!canCommit}
                loading={loading.commit}
                icon={<CheckOutlined />}
              >
                {loading.commit ? "提交中..." : "提交"}
              </Button>
            </div>
          </div>
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
          {hasUnstaged && (
            <span className="git-view-toggle">
              <Button
                type={unstagedViewMode === "tree" ? "primary" : "text"}
                size="small"
                icon={<ApartmentOutlined />}
                onClick={() => setUnstagedViewMode("tree")}
                style={{ width: 24, height: 20, padding: 0, fontSize: 11 }}
              />
              <Button
                type={unstagedViewMode === "list" ? "primary" : "text"}
                size="small"
                icon={<UnorderedListOutlined />}
                onClick={() => setUnstagedViewMode("list")}
                style={{ width: 24, height: 20, padding: 0, fontSize: 11 }}
              />
            </span>
          )}
        </div>
      )}

      <div className="git-diff-mode-scroll">
      {hasStaged && (
        <div className={`git-section${stagedCollapsed ? " git-section--collapsed" : ""}`}>
          <div className="git-section-header">
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>
              已暂存 ({status.staged.length})
            </Text>
            <Space size={4} className="git-section-header-actions-space">
              <Tooltip title={stagedCollapsed ? "展开已暂存" : "收起已暂存"} placement="top">
                <Button
                  type="text"
                  size="small"
                  className="git-section-action-btn"
                  icon={stagedCollapsed ? <VerticalAlignTopOutlined /> : <VerticalAlignBottomOutlined />}
                  onClick={() => setStagedCollapsed((prev) => !prev)}
                  aria-expanded={!stagedCollapsed}
                  aria-label={stagedCollapsed ? "展开已暂存" : "收起已暂存"}
                />
              </Tooltip>
              <Tooltip title="全部取消暂存" placement="topRight">
                <Button
                  type="text"
                  size="small"
                  className="git-section-action-btn"
                  icon={<MinusOutlined />}
                  onClick={onUnstageAll}
                  disabled={loading.unstageAll || loading.stageAll}
                />
              </Tooltip>
            </Space>
          </div>
          {!stagedCollapsed ? (
            <div className="git-file-list">
              {status.staged.map((f) => (
                <FileRow
                  key={f.path}
                  file={f}
                  section="staged"
                  onUnstage={onUnstage}
                />
              ))}
            </div>
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
              {unstagedViewMode === "tree" && (
                <Tooltip title={treeAllExpanded ? "收起目录树" : "展开目录树"} placement="top">
                  <Button
                    type="text"
                    size="small"
                    className="git-section-action-btn"
                    icon={treeAllExpanded ? <VerticalAlignBottomOutlined /> : <VerticalAlignTopOutlined />}
                    onClick={handleToggleTree}
                  />
                </Tooltip>
              )}
              <Tooltip title="全部暂存" placement="top">
                <Button
                  type="text"
                  size="small"
                  className="git-section-action-btn"
                  icon={<PlusOutlined />}
                  onClick={onStageAll}
                  disabled={loading.stageAll || loading.unstageAll || loading.discardAll}
                />
              </Tooltip>
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
                <Tooltip title="放弃全部更改" placement="topRight">
                  <Button
                    type="text"
                    size="small"
                    className="git-section-action-btn"
                    icon={<RevertIcon />}
                    disabled={loading.stageAll || loading.unstageAll || loading.discardAll}
                  />
                </Tooltip>
              </Popconfirm>
            </Space>
          </div>
          {unstagedViewMode === "tree" ? (
            <FileTreeView
              files={status.unstaged}
              expandedDirs={expandedDirs}
              onToggleDir={handleToggleDir}
              onStage={onStage}
              onUnstage={onUnstage}
              onDiscard={onDiscard}
              onOpenFile={onOpenFile}
            />
          ) : (
            <div className="git-file-list">
              {status.unstaged.map((f) => (
                <FileRow
                  key={f.path}
                  file={f}
                  section="unstaged"
                  onStage={onStage}
                  onDiscard={onDiscard}
                  onOpenFile={onOpenFile}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!hasChanges && status.branch && (
        <Empty description="没有检测到变更" style={{ padding: "24px 0" }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
      </div>
    </div>
  );
}
