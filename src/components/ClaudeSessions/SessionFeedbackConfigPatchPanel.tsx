import { Button, Checkbox, Space, Spin, Tag, Typography, App, message } from "antd";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { HoverHint } from "../shared/HoverHint";
import {
  CheckOutlined,
  CloseOutlined,
  DiffOutlined,
  DownOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  ReloadOutlined,
  RobotOutlined,
  RiseOutlined,
  UndoOutlined,
  UpOutlined,
} from "@ant-design/icons";
import type { FeedbackPatchBackupRecord } from "../../utils/sessionFeedbackConfigPatchJson";
import type { UseSessionFeedbackLoopResult } from "../../hooks/useSessionFeedbackLoop";
import { enrichPatchWithPreview, openFeedbackConfigPatchFile, enrichFeedbackConfigPatchFileTarget } from "../../services/sessionFeedbackConfigPatchApply";
import {
  feedbackConfigArtifactKindLabel,
  resolveFeedbackConfigPatchFileTarget,
  type FeedbackConfigPatch,
} from "../../utils/sessionFeedbackConfigPatch";
import { OPEN_WORKSPACE_ERROR } from "../../services/openWorkspaceWithPreference";
import {
  buildPatchDiffLines,
  compactPatchDiffLines,
  computePatchDiffStats,
  formatPatchDiffStats,
} from "../../utils/sessionFeedbackConfigPatchDiff";
import { useSessionFeedbackLoopSetting } from "../DefaultConfigPanel/useSessionFeedbackLoopSetting";
import {
  isPatchAlreadyPromotedToGlobal,
  promotePatchToGlobalRule,
} from "../../services/sessionFeedbackGlobalRulesStore";
import {
  isPatchPromotableToGlobalRule,
  isPatchSuggestedForGlobalPromotion,
} from "../../utils/sessionFeedbackGlobalRules";

const { Text } = Typography;

import type { FeedbackLoopDispatchKind } from "../../utils/sessionFeedbackLoopDispatch";

interface Props {
  loop: UseSessionFeedbackLoopResult;
  optimizeConfigArtifacts: boolean;
  onDispatchSessionFeedbackLoop?: (
    prompt: string,
    kind: FeedbackLoopDispatchKind,
    cycleIndex?: number,
  ) => void | Promise<void>;
}

function formatOverheadDelta(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : String(value);
}

function PatchDiffView({ before, after }: { before: string; after: string }) {
  const stats = useMemo(() => computePatchDiffStats(before, after), [before, after]);
  const lines = useMemo(
    () => compactPatchDiffLines(buildPatchDiffLines(before, after), 2),
    [before, after],
  );

  return (
    <div className="app-session-feedback-loop__patch-diff">
      <Text type="secondary" className="app-session-feedback-loop__patch-diff-stats">
        {formatPatchDiffStats(stats)}
      </Text>
      <div className="app-session-feedback-loop__patch-diff-lines">
        {lines.map((line, idx) => (
          <div
            key={`${idx}-${line.kind}-${line.text.slice(0, 24)}`}
            className={`app-session-feedback-loop__patch-diff-line app-session-feedback-loop__patch-diff-line--${line.kind}`}
          >
            <span className="app-session-feedback-loop__patch-diff-gutter">
              {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
            </span>
            <span>{line.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PatchRow({
  patch,
  selected,
  repositoryPath,
  onToggle,
  onReject,
  canPromote,
  suggestPromote,
  alreadyPromoted,
  promoting,
  onPromote,
}: {
  patch: FeedbackConfigPatch;
  selected: boolean;
  repositoryPath?: string | null;
  onToggle: (checked: boolean) => void;
  onReject: () => void;
  canPromote?: boolean;
  suggestPromote?: boolean;
  alreadyPromoted?: boolean;
  promoting?: boolean;
  onPromote?: () => void;
}) {
  const { message } = App.useApp();
  const [expanded, setExpanded] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffPreview, setDiffPreview] = useState<{ before: string; after: string } | null>(null);
  const [openingFile, setOpeningFile] = useState(false);
  const [fileTarget, setFileTarget] = useState(() =>
    resolveFeedbackConfigPatchFileTarget(patch, repositoryPath),
  );

  const statusColor =
    patch.status === "applied"
      ? "success"
      : patch.status === "failed"
        ? "error"
        : patch.status === "rejected"
          ? "default"
          : "processing";

  const canPreviewDiff =
    patch.action !== "enable" && patch.action !== "disable" && Boolean(repositoryPath?.trim());

  const canOpenFile = fileTarget.openKind !== "none";

  useEffect(() => {
    const base = resolveFeedbackConfigPatchFileTarget(patch, repositoryPath);
    setFileTarget(base);
    if (base.openKind !== "memory") return;
    let cancelled = false;
    void enrichFeedbackConfigPatchFileTarget(patch, repositoryPath, base).then((enriched) => {
      if (!cancelled) setFileTarget(enriched);
    });
    return () => {
      cancelled = true;
    };
  }, [patch, repositoryPath]);

  const handleOpenFile = useCallback(async () => {
    if (!canOpenFile) {
      message.warning("缺少仓库路径，无法打开该文件");
      return;
    }
    setOpeningFile(true);
    try {
      await openFeedbackConfigPatchFile({ repositoryPath, patch });
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === OPEN_WORKSPACE_ERROR.NOT_CONFIGURED) {
        message.warning("未配置可用的编辑器或命令，请在中栏顶部「打开方式」中选择");
      } else if (code === OPEN_WORKSPACE_ERROR.NO_TARGET || code === OPEN_WORKSPACE_ERROR.EMPTY_PATH) {
        message.warning("无法打开该补丁目标文件");
      } else {
        message.error(typeof e === "string" ? e : e instanceof Error ? e.message : "打开文件失败");
      }
    } finally {
      setOpeningFile(false);
    }
  }, [canOpenFile, message, patch, repositoryPath]);

  useEffect(() => {
    if (!expanded || !canPreviewDiff) return;
    let cancelled = false;
    setDiffLoading(true);
    void enrichPatchWithPreview(repositoryPath!.trim(), patch)
      .then((preview) => {
        if (!cancelled) setDiffPreview(preview);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canPreviewDiff, expanded, patch, repositoryPath]);

  return (
    <div className="app-session-feedback-loop__patch">
      <div className="app-session-feedback-loop__patch-head">
        {patch.status === "pending" ? (
          <Checkbox checked={selected} onChange={(e) => onToggle(e.target.checked)} />
        ) : (
          <span className="app-session-feedback-loop__patch-spacer" />
        )}
        <div className="app-session-feedback-loop__patch-main">
          <div className="app-session-feedback-loop__patch-path-row">
            <Text strong className="app-session-feedback-loop__patch-path">
              {fileTarget.fileName}
            </Text>
            <Text
              type="secondary"
              className="app-session-feedback-loop__patch-abs-path"
              title={fileTarget.displayPath}
            >
              {fileTarget.displayPath}
            </Text>
          </div>
          <Space size={4} wrap>
            <Tag bordered={false}>{feedbackConfigArtifactKindLabel(patch.kind)}</Tag>
            <Tag bordered={false}>{patch.action}</Tag>
            <Tag bordered={false} color={patch.source === "ai" ? "purple" : "blue"}>
              {patch.source === "ai" ? "AI" : "规则"}
            </Tag>
            <Tag bordered={false} color={statusColor}>
              {patch.status}
            </Tag>
            {suggestPromote && canPromote && !alreadyPromoted ? (
              <Tag bordered={false} color="gold">
                建议提升
              </Tag>
            ) : null}
            {alreadyPromoted ? (
              <Tag bordered={false} color="success">
                已全局
              </Tag>
            ) : null}
          </Space>
          <Text type="secondary" className="app-session-feedback-loop__patch-rationale">
            {patch.rationale}
          </Text>
        </div>
        <Space size={0}>
          {canOpenFile ? (
            <HoverHint title="在编辑器中打开">
              <Button
                size="small"
                type="text"
                icon={<FolderOpenOutlined />}
                loading={openingFile}
                aria-label="在编辑器中打开"
                onClick={() => void handleOpenFile()}
              />
            </HoverHint>
          ) : null}
          {canPreviewDiff ? (
            <HoverHint title={expanded ? "收起 diff 预览" : "预览 diff"}>
              <Button
                size="small"
                type="text"
                icon={<DiffOutlined />}
                aria-expanded={expanded}
                aria-label={expanded ? "收起 diff 预览" : "预览 diff"}
                onClick={() => setExpanded((v) => !v)}
              />
            </HoverHint>
          ) : null}
          {patch.status === "pending" ? (
            <HoverHint title="拒绝此补丁">
              <Button
                size="small"
                type="text"
                danger
                icon={<CloseOutlined />}
                aria-label="拒绝此补丁"
                onClick={onReject}
              />
            </HoverHint>
          ) : null}
          {canPromote && !alreadyPromoted && onPromote ? (
            <Button
              size="small"
              type="text"
              icon={<RiseOutlined />}
              loading={promoting}
              onClick={onPromote}
              title="提升为 Wise 全局规则（注入所有 spawn）"
            >
              提升全局
            </Button>
          ) : null}
        </Space>
      </div>
      {!expanded && patch.action !== "enable" && patch.action !== "disable" && patch.content.trim() ? (
        <pre className="app-session-feedback-loop__patch-content">
          {patch.content.trim()}
        </pre>
      ) : null}
      {expanded ? (
        <div className="app-session-feedback-loop__patch-diff-wrap">
          {diffLoading ? (
            <Spin size="small" />
          ) : diffPreview ? (
            <PatchDiffView before={diffPreview.before} after={diffPreview.after} />
          ) : (
            <Text type="secondary">无法加载 diff 预览</Text>
          )}
          <Button
            size="small"
            type="text"
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setExpanded(false)}
          >
            收起 diff
          </Button>
        </div>
      ) : null}
      {patch.errorMessage ? (
        <Text type="danger" className="app-session-feedback-loop__patch-error">
          {patch.errorMessage}
        </Text>
      ) : null}
    </div>
  );
}

function BackupRow({
  backup,
  rollingBack,
  onRollback,
}: {
  backup: FeedbackPatchBackupRecord;
  rollingBack: boolean;
  onRollback: () => void;
}) {
  return (
    <div className="app-session-feedback-loop__backup-row">
      <div className="app-session-feedback-loop__backup-main">
        <Text className="app-session-feedback-loop__backup-path">{backup.path}</Text>
        <Space size={4} wrap>
          <Tag bordered={false}>{backup.kind}</Tag>
          <Tag bordered={false}>{backup.action}</Tag>
          <Text type="secondary">{new Date(backup.at).toLocaleString()}</Text>
        </Space>
      </div>
      <Button
        size="small"
        icon={<UndoOutlined />}
        loading={rollingBack}
        onClick={onRollback}
        disabled={backup.before == null && backup.action !== "enable" && backup.action !== "disable"}
      >
        回滚
      </Button>
    </div>
  );
}

export const SessionFeedbackConfigPatchPanel = memo(function SessionFeedbackConfigPatchPanel({
  loop,
  optimizeConfigArtifacts,
  onDispatchSessionFeedbackLoop,
}: Props) {
  const {
    configPatches,
    configSnapshot,
    configSnapshotLoading,
    configOverheadDelta,
    configPatchBackups,
    configPatchBackupsLoading,
    patchEffectivenessHint,
    repositoryPath,
    requestConfigPatchPrompt,
    applySelectedConfigPatches,
    rejectConfigPatch,
    refreshConfigSnapshot,
    refreshConfigPatchBackups,
    rollbackConfigPatchBackup,
  } = loop;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [promotingPatchId, setPromotingPatchId] = useState<string | null>(null);
  const [backupsExpanded, setBackupsExpanded] = useState(false);
  const feedbackLoopSettings = useSessionFeedbackLoopSetting();

  const pendingPatches = useMemo(
    () => configPatches.filter((p) => p.status === "pending"),
    [configPatches],
  );

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? pendingPatches.map((p) => p.id) : []);
    },
    [pendingPatches],
  );

  const handleApply = useCallback(async () => {
    if (selectedIds.length === 0) {
      message.info("请先选择要应用的补丁");
      return;
    }
    setApplying(true);
    try {
      const count = await applySelectedConfigPatches(selectedIds);
      if (count > 0) {
        message.success(`已应用 ${count} 条配置补丁（已备份至 ~/.wise/feedback-patches/）`);
        setSelectedIds([]);
      } else {
        message.warning("未能应用所选补丁");
      }
    } catch (e) {
      message.error(`应用失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setApplying(false);
    }
  }, [applySelectedConfigPatches, selectedIds]);

  const handleAiGenerate = useCallback(async () => {
    const prompt = requestConfigPatchPrompt();
    if (!prompt || !onDispatchSessionFeedbackLoop) {
      message.info("暂无配置补丁生成上下文");
      return;
    }
    try {
      await onDispatchSessionFeedbackLoop(prompt, "config_patch");
      message.success("已派发 AI 配置补丁请求至神经网 worker；完成后将自动解析 JSON 补丁");
    } catch (e) {
      message.error(`派发失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [onDispatchSessionFeedbackLoop, requestConfigPatchPrompt]);

  const handlePromoteToGlobal = useCallback(
    async (patch: FeedbackConfigPatch) => {
      setPromotingPatchId(patch.id);
      try {
        const result = await promotePatchToGlobalRule({ patch, repositoryPath });
        if (result.ok) {
          message.success(`已提升为全局规则：${result.rule.title}`);
          await feedbackLoopSettings.refresh();
        } else {
          message.warning(result.reason);
        }
      } catch (e) {
        message.error(`提升失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setPromotingPatchId(null);
      }
    },
    [feedbackLoopSettings, repositoryPath],
  );

  const handleParseClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const count = loop.ingestConfigPatchAiResponse(text);
      if (count > 0) message.success(`已解析 ${count} 条 AI 配置补丁`);
      else message.warning("剪贴板中未找到有效 JSON 补丁块");
    } catch (e) {
      message.error(`解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [loop]);

  const handleRollback = useCallback(
    async (backupId: string) => {
      setRollingBackId(backupId);
      try {
        const result = await rollbackConfigPatchBackup(backupId);
        if (result.ok) message.success(result.message);
        else message.error(result.message);
      } catch (e) {
        message.error(`回滚失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setRollingBackId(null);
      }
    },
    [rollbackConfigPatchBackup],
  );

  if (!optimizeConfigArtifacts) {
    return (
      <div className="app-session-feedback-loop__config-patches app-session-feedback-loop__config-patches--off">
        <Text type="secondary">
          配置 Artifact 优化已关闭。在「默认配置 → 开发实验」中开启「优化 CLAUDE.md / rules / MCP / skills」。
        </Text>
      </div>
    );
  }

  return (
    <div className="app-session-feedback-loop__config-patches">
      <div className="app-session-feedback-loop__config-patches-head">
        <FileTextOutlined />
        <Text strong>配置 Artifact 补丁</Text>
        {configSnapshot ? (
          <Tag bordered={false}>
            rules ~{configSnapshot.overhead.rules} · skills ~{configSnapshot.overhead.skills} · mcp ~
            {configSnapshot.overhead.mcp} tok
          </Tag>
        ) : null}
        {configOverheadDelta ? (
          <Tag
            bordered={false}
            color={
              configOverheadDelta.rules + configOverheadDelta.mcp <= 0 ? "success" : "warning"
            }
          >
            Δ rules {formatOverheadDelta(configOverheadDelta.rules)} · skills{" "}
            {formatOverheadDelta(configOverheadDelta.skills)} · mcp{" "}
            {formatOverheadDelta(configOverheadDelta.mcp)}
          </Tag>
        ) : null}
        <HoverHint title="刷新配置快照">
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined spin={configSnapshotLoading} />}
            aria-label="刷新配置快照"
            onClick={() => void refreshConfigSnapshot()}
          />
        </HoverHint>
      </div>

      {patchEffectivenessHint ? (
        <Text type="secondary" className="app-session-feedback-loop__effectiveness-hint">
          历史有效补丁：{patchEffectivenessHint}
        </Text>
      ) : null}

      <div className="app-session-feedback-loop__config-patches-actions">
        <Space size={4} wrap>
          {onDispatchSessionFeedbackLoop ? (
            <Button size="small" icon={<RobotOutlined />} onClick={() => void handleAiGenerate()}>
              AI 生成补丁
            </Button>
          ) : null}
          <Button size="small" onClick={() => void handleParseClipboard()}>
            从剪贴板解析
          </Button>
          {pendingPatches.length > 0 ? (
            <>
              <Checkbox
                indeterminate={selectedIds.length > 0 && selectedIds.length < pendingPatches.length}
                checked={selectedIds.length > 0 && selectedIds.length === pendingPatches.length}
                onChange={(e) => handleSelectAll(e.target.checked)}
              >
                全选 ({pendingPatches.length})
              </Checkbox>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                loading={applying}
                disabled={selectedIds.length === 0}
                onClick={() => void handleApply()}
              >
                应用选中
              </Button>
            </>
          ) : null}
        </Space>
      </div>

      {configPatches.length === 0 ? (
        <Text type="secondary" className="app-session-feedback-loop__config-patches-empty">
          启动闭环后将根据洞察自动生成规则引擎补丁；也可点「AI 生成补丁」获取结构化 JSON。点 diff 图标可预览落盘前后对比。
        </Text>
      ) : (
        <div className="app-session-feedback-loop__patch-list">
          {configPatches.map((patch) => (
            <PatchRow
              key={patch.id}
              patch={patch}
              repositoryPath={repositoryPath}
              selected={selectedIds.includes(patch.id)}
              canPromote={isPatchPromotableToGlobalRule(patch)}
              suggestPromote={isPatchSuggestedForGlobalPromotion(patch)}
              alreadyPromoted={isPatchAlreadyPromotedToGlobal(
                patch.id,
                feedbackLoopSettings.globalRules,
              )}
              promoting={promotingPatchId === patch.id}
              onPromote={() => void handlePromoteToGlobal(patch)}
              onToggle={(checked) => {
                setSelectedIds((prev) =>
                  checked ? [...prev, patch.id] : prev.filter((id) => id !== patch.id),
                );
              }}
              onReject={() => rejectConfigPatch(patch.id)}
            />
          ))}
        </div>
      )}

      <div className="app-session-feedback-loop__backups">
        <button
          type="button"
          className="app-session-feedback-loop__backups-toggle"
          onClick={() => setBackupsExpanded((v) => !v)}
        >
          <HistoryOutlined />
          <span>备份与回滚 ({configPatchBackups.length})</span>
          {backupsExpanded ? <UpOutlined /> : <DownOutlined />}
          <HoverHint title="刷新备份列表">
            <Button
              size="small"
              type="text"
              icon={<ReloadOutlined spin={configPatchBackupsLoading} />}
              aria-label="刷新备份列表"
              onClick={(e) => {
                e.stopPropagation();
                void refreshConfigPatchBackups();
              }}
            />
          </HoverHint>
        </button>
        {backupsExpanded ? (
          configPatchBackups.length === 0 ? (
            <Text type="secondary" className="app-session-feedback-loop__backups-empty">
              暂无备份记录（应用补丁后写入 ~/.wise/feedback-patches/）
            </Text>
          ) : (
            <div className="app-session-feedback-loop__backup-list">
              {configPatchBackups.map((backup) => (
                <BackupRow
                  key={backup.backupId}
                  backup={backup}
                  rollingBack={rollingBackId === backup.backupId}
                  onRollback={() => void handleRollback(backup.backupId)}
                />
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
});
