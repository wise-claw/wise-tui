import { Button, Checkbox, Space, Spin, Tag, Typography, message } from "antd";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckOutlined,
  CloseOutlined,
  DiffOutlined,
  DownOutlined,
  FileTextOutlined,
  HistoryOutlined,
  ReloadOutlined,
  RobotOutlined,
  UndoOutlined,
  UpOutlined,
} from "@ant-design/icons";
import type { FeedbackPatchBackupRecord } from "../../utils/sessionFeedbackConfigPatchJson";
import type { UseSessionFeedbackLoopResult } from "../../hooks/useSessionFeedbackLoop";
import { enrichPatchWithPreview } from "../../services/sessionFeedbackConfigPatchApply";
import {
  feedbackConfigArtifactKindLabel,
  type FeedbackConfigPatch,
} from "../../utils/sessionFeedbackConfigPatch";
import {
  buildPatchDiffLines,
  compactPatchDiffLines,
  computePatchDiffStats,
  formatPatchDiffStats,
} from "../../utils/sessionFeedbackConfigPatchDiff";

const { Text } = Typography;

interface Props {
  loop: UseSessionFeedbackLoopResult;
  optimizeConfigArtifacts: boolean;
  onRequestAiAnalysis?: (prompt: string) => void | Promise<void>;
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
}: {
  patch: FeedbackConfigPatch;
  selected: boolean;
  repositoryPath?: string | null;
  onToggle: (checked: boolean) => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffPreview, setDiffPreview] = useState<{ before: string; after: string } | null>(null);

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
          <Text strong className="app-session-feedback-loop__patch-path">
            {patch.path}
          </Text>
          <Space size={4} wrap>
            <Tag bordered={false}>{feedbackConfigArtifactKindLabel(patch.kind)}</Tag>
            <Tag bordered={false}>{patch.action}</Tag>
            <Tag bordered={false} color={patch.source === "ai" ? "purple" : "blue"}>
              {patch.source === "ai" ? "AI" : "规则"}
            </Tag>
            <Tag bordered={false} color={statusColor}>
              {patch.status}
            </Tag>
          </Space>
          <Text type="secondary" className="app-session-feedback-loop__patch-rationale">
            {patch.rationale}
          </Text>
        </div>
        <Space size={0}>
          {canPreviewDiff ? (
            <Button
              size="small"
              type="text"
              icon={<DiffOutlined />}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            />
          ) : null}
          {patch.status === "pending" ? (
            <Button size="small" type="text" danger icon={<CloseOutlined />} onClick={onReject} />
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
  onRequestAiAnalysis,
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
  const [backupsExpanded, setBackupsExpanded] = useState(false);

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
    if (!prompt || !onRequestAiAnalysis) {
      message.info("暂无配置补丁生成上下文");
      return;
    }
    try {
      await onRequestAiAnalysis(prompt);
      message.success("已发送 AI 配置补丁请求；回复完成后点「从剪贴板解析」");
    } catch (e) {
      message.error(`发送失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [onRequestAiAnalysis, requestConfigPatchPrompt]);

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
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined spin={configSnapshotLoading} />}
          onClick={() => void refreshConfigSnapshot()}
        />
      </div>

      {patchEffectivenessHint ? (
        <Text type="secondary" className="app-session-feedback-loop__effectiveness-hint">
          历史有效补丁：{patchEffectivenessHint}
        </Text>
      ) : null}

      <div className="app-session-feedback-loop__config-patches-actions">
        <Space size={4} wrap>
          {onRequestAiAnalysis ? (
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
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined spin={configPatchBackupsLoading} />}
            onClick={(e) => {
              e.stopPropagation();
              void refreshConfigPatchBackups();
            }}
          />
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
