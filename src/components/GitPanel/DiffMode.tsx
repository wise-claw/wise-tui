import { useCallback, useMemo, useState } from "react";
import { Button, Empty, Input, message, Popconfirm, Space, Tooltip, Typography } from "antd";
import {
  ApartmentOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
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
  onPush: () => void;
  onPull: () => void;
  onFetch: () => void;
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
  onPush,
  onPull,
  onFetch,
  onOpenFile,
}: DiffModeProps) {
  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;
  const [commitMsg, setCommitMsg] = useState("");
  const [unstagedViewMode, setUnstagedViewMode] = useState<UnstagedViewMode>("tree");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeAllExpanded, setTreeAllExpanded] = useState(false);
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

      {(status.branch || loading.fetch) && (
        <div className="git-sync-row">
          <div className="git-branch-info">
            <Tooltip title={`当前分支：${status.branch || "unknown"}`} placement="topLeft">
              <Button
                type="text"
                size="small"
                className="git-ai-summary-btn"
                onClick={() => void handleGenerateCommitByAi()}
                loading={aiSummaryLoading}
              >
                AI 生成信息
              </Button>
            </Tooltip>
          </div>
          <Space size={2} className="git-sync-row-actions">
            <Tooltip title="获取远程" placement="top">
              <Button
                type="text"
                size="small"
                className="git-sync-count-btn"
                icon={<ReloadOutlined spin={loading.fetch} />}
                onClick={onFetch}
                disabled={loading.fetch}
              />
            </Tooltip>
            <Tooltip title="拉取" placement="top">
              <Button
                type="text"
                size="small"
                className="git-sync-count-btn"
                icon={loading.pull ? <ReloadOutlined spin /> : <ArrowDownOutlined />}
                onClick={onPull}
                disabled={loading.pull || loading.fetch}
              >
                {!loading.pull && behind > 0 && (
                  <span className="sync-count sync-count--behind">{behind}</span>
                )}
              </Button>
            </Tooltip>
            <Tooltip title="推送" placement="top">
              <Button
                type="text"
                size="small"
                className="git-sync-count-btn"
                icon={loading.push ? <ReloadOutlined spin /> : <ArrowUpOutlined />}
                onClick={onPush}
                disabled={loading.push || loading.pull}
              >
                {!loading.push && ahead > 0 && (
                  <span className="sync-count sync-count--ahead">{ahead}</span>
                )}
              </Button>
            </Tooltip>
            {status.staged.length > 0 && (
              <Tooltip title="待提交" placement="top">
                <Button
                  type="text"
                  size="small"
                  className="git-sync-count-btn"
                  icon={<CheckOutlined />}
                  disabled
                >
                  <span className="sync-count sync-count--staged">{status.staged.length}</span>
                </Button>
              </Tooltip>
            )}
          </Space>
        </div>
      )}

      {hasChanges && (
        <div className="git-commit-section">
          <TextArea
            className="git-commit-input"
            placeholder="提交信息..."
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            rows={2}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
          <Button
            type="primary"
            block
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

      {hasStaged && (
        <div className="git-section">
          <div className="git-section-header">
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>
              已暂存 ({status.staged.length})
            </Text>
            <Tooltip title="全部取消暂存" placement="topRight">
              <Button
                type="text"
                size="small"
                icon={<MinusOutlined />}
                onClick={onUnstageAll}
                disabled={loading.unstageAll || loading.stageAll}
                style={{ width: 24, height: 20, padding: 0 }}
              />
            </Tooltip>
          </div>
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
        </div>
      )}

      {hasUnstaged && (
        <div className="git-section">
          <div className="git-section-header">
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>
              更改 ({status.unstaged.length})
            </Text>
            <Space size={4}>
              {unstagedViewMode === "tree" && (
                <Tooltip title={treeAllExpanded ? "收起" : "展开"} placement="top">
                  <Button
                    type="text"
                    size="small"
                    icon={treeAllExpanded ? <VerticalAlignBottomOutlined /> : <VerticalAlignTopOutlined />}
                    onClick={handleToggleTree}
                    style={{ width: 24, height: 20, padding: 0 }}
                  />
                </Tooltip>
              )}
              <Tooltip title="全部暂存" placement="top">
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={onStageAll}
                  disabled={loading.stageAll || loading.unstageAll || loading.discardAll}
                  style={{ width: 24, height: 20, padding: 0 }}
                />
              </Tooltip>
              <Popconfirm
                title="确认放弃全部更改？"
                description="所有未暂存的本地修改将被永久丢弃，此操作不可恢复。"
                okText="全部放弃"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                placement="bottomRight"
                getPopupContainer={() => document.body}
                overlayInnerStyle={{ width: 300 }}
                disabled={loading.stageAll || loading.unstageAll || loading.discardAll}
                onConfirm={onDiscardAll}
              >
                <Tooltip title="放弃全部更改" placement="topRight">
                  <Button
                    type="text"
                    size="small"
                    icon={<RevertIcon />}
                    disabled={loading.stageAll || loading.unstageAll || loading.discardAll}
                    style={{ width: 24, height: 20, padding: 0 }}
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
  );
}
