import { Alert, Button, Drawer, Dropdown, Empty, Space, Spin, Typography, message } from "antd";
import { CopyOutlined, DownloadOutlined } from "@ant-design/icons";
import { save } from "@tauri-apps/plugin-dialog";
import type { MenuProps } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClaudeMessage, ToolUsePart } from "../../types";
import { loadClaudeSessionJsonl } from "../../services/claudeDisk";
import { writeTextFileAbsolute } from "../../services/sessionLink";
import {
  buildSessionLinkExportBundle,
  serializeSessionLinkExportBundle,
} from "../../utils/sessionLinkExport";
import { buildSessionLinkRecordsFromSources } from "../../utils/sessionLinkPipeline";
import { useFccSessionTraces } from "../../hooks/useFccSessionTraces";
import { buildTrajectorySequenceModel, type SequenceEvent } from "../../utils/claudeSessionTrajectorySequence";
import { getToolDisplayInfo } from "./MessageParts";
import { ClaudeSessionSequenceDiagram } from "./ClaudeSessionSequenceDiagram";
import "./ClaudeSessionTrajectoryDrawer.css";

const { Paragraph, Text } = Typography;

const JSONL_TAIL = 8000;

interface Props {
  open: boolean;
  onClose: () => void;
  messages: ClaudeMessage[];
  wiseTabSessionId?: string;
  repositoryPath?: string;
  claudeSessionId?: string | null;
  diskTranscriptPartial?: boolean;
}

export function ClaudeSessionTrajectoryDrawer({
  open,
  onClose,
  messages,
  wiseTabSessionId,
  repositoryPath,
  claudeSessionId,
  diskTranscriptPartial,
}: Props) {
  const [jsonlLines, setJsonlLines] = useState<string[] | null>(null);
  const [jsonlLoading, setJsonlLoading] = useState(false);
  const [jsonlError, setJsonlError] = useState<string | null>(null);
  const [subagentOpen, setSubagentOpen] = useState(false);
  const [subagentPart, setSubagentPart] = useState<ToolUsePart | null>(null);

  const canLoadDisk = Boolean(repositoryPath?.trim() && claudeSessionId?.trim());

  const { fccAligned, traces: fccTraces } = useFccSessionTraces({
    open,
    sessionHint: claudeSessionId ?? undefined,
  });

  useEffect(() => {
    if (!open) {
      setSubagentOpen(false);
      setSubagentPart(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setJsonlLines(null);
    setJsonlError(null);
    if (!canLoadDisk || !repositoryPath || !claudeSessionId) return;
    let cancelled = false;
    setJsonlLoading(true);
    void loadClaudeSessionJsonl(repositoryPath, claudeSessionId, { tailLines: JSONL_TAIL })
      .then((lines) => {
        if (cancelled) return;
        setJsonlLines(lines);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setJsonlError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setJsonlLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, canLoadDisk, repositoryPath, claudeSessionId]);

  const events = useMemo(
    () =>
      buildTrajectorySequenceModel(messages, jsonlLines ?? undefined, {
        fccTraces: fccAligned ? fccTraces : undefined,
      }),
    [messages, jsonlLines, fccAligned, fccTraces],
  );

  const linkRecords = useMemo(
    () =>
      buildSessionLinkRecordsFromSources({
        messages,
        jsonlLines: jsonlLines ?? undefined,
        fccTraces: fccAligned ? fccTraces : undefined,
      }),
    [messages, jsonlLines, fccAligned, fccTraces],
  );

  const exportBundle = useMemo(
    () =>
      buildSessionLinkExportBundle({
        messages,
        jsonlLines: jsonlLines ?? undefined,
        records: linkRecords,
        wiseTabSessionId,
        claudeSessionId,
        repositoryPath,
      }),
    [messages, jsonlLines, linkRecords, wiseTabSessionId, claudeSessionId, repositoryPath],
  );

  const runExport = useCallback(async () => {
    if (!exportBundle) return;
    const text = serializeSessionLinkExportBundle(exportBundle);
    const sid = claudeSessionId?.slice(0, 8) ?? wiseTabSessionId?.slice(0, 8) ?? "session";
    try {
      const path = await save({
        defaultPath: `session-link-${sid}-${Date.now()}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeTextFileAbsolute(path, text);
    } catch (e) {
      message.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [exportBundle, claudeSessionId, wiseTabSessionId]);

  const exportMenuItems: MenuProps["items"] = useMemo(() => {
    if (!exportBundle) return [];
    const text = serializeSessionLinkExportBundle(exportBundle);
    return [
      {
        key: "copy",
        label: "复制 JSON",
        icon: <CopyOutlined />,
        onClick: () => {
          void navigator.clipboard.writeText(text).then(
            () => undefined,
            () => message.error("复制失败"),
          );
        },
      },
      {
        key: "save",
        label: "保存文件…",
        icon: <DownloadOutlined />,
        onClick: () => void runExport(),
      },
    ];
  }, [exportBundle, runExport]);

  const onSubagentDrilldown = useCallback((ev: SequenceEvent) => {
    if (!ev.drilldown) return;
    setSubagentPart(ev.drilldown.toolPart);
    setSubagentOpen(true);
  }, []);

  const subagentInfo = subagentPart ? getToolDisplayInfo(subagentPart) : null;
  const subagentInputStr = useMemo(() => {
    if (!subagentPart) return "";
    try {
      return JSON.stringify(subagentPart.input, null, 2);
    } catch {
      return String(subagentPart.input);
    }
  }, [subagentPart]);

  return (
    <>
      <Drawer
        title="工作轨迹 · 序列视图"
        placement="right"
        size={800}
        destroyOnClose
        open={open}
        onClose={onClose}
        extra={
          <Space size={8}>
            <Dropdown menu={{ items: exportMenuItems }} disabled={!exportBundle}>
              <Button size="small" icon={<DownloadOutlined />} disabled={!exportBundle}>
                导出链路包
              </Button>
            </Dropdown>
          </Space>
        }
        styles={{ body: { padding: 0, display: "flex", flexDirection: "column", height: "100%" } }}
      >
        <div className="app-session-trajectory-drawer">
          {diskTranscriptPartial && canLoadDisk ? (
            <Alert
              className="app-session-trajectory-drawer__alert"
              type="info"
              showIcon
              message="当前会话可能为磁盘尾部子集；轨迹中的模型消息与 JSONL 补充均以已加载内容为准，完整历史请先在聊天区加载。"
            />
          ) : null}
          {canLoadDisk ? (
            <div className="app-session-trajectory-drawer__disk">
              {jsonlLoading ? (
                <span className="app-session-trajectory-drawer__disk-loading">
                  <Spin size="small" /> 正在合并磁盘 JSONL（Hooks / init / result 等）…
                </span>
              ) : jsonlError ? (
                <Text type="danger">JSONL 读取失败：{jsonlError}</Text>
              ) : jsonlLines ? (
                <Text type="secondary">
                  已合并最近 {jsonlLines.length} 行 JSONL 补充事件（最多 {JSONL_TAIL} 行）。
                </Text>
              ) : null}
            </div>
          ) : (
            <div className="app-session-trajectory-drawer__disk">
              <Text type="secondary">无仓库路径或未绑定 Claude 会话 ID，仅展示内存消息轨迹（无 Hooks 等磁盘补充）。</Text>
            </div>
          )}

          <div className="app-session-trajectory-drawer__body">
            {events.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无轨迹事件" />
            ) : (
              <ClaudeSessionSequenceDiagram
                events={events}
                onSubagentDrilldown={onSubagentDrilldown}
                markInferredHttp
              />
            )}
          </div>
        </div>
      </Drawer>

      <Drawer
        title={subagentInfo ? `子代理 · ${subagentInfo.label}` : "子代理"}
        placement="right"
        size={520}
        open={subagentOpen}
        onClose={() => {
          setSubagentOpen(false);
          setSubagentPart(null);
        }}
        destroyOnClose
      >
        {subagentPart && subagentInfo ? (
          <div className="app-session-trajectory-subagent">
            <Paragraph type="secondary">{subagentInfo.subtitle || "Task 工具调用"}</Paragraph>
            <Text strong>输入（JSON）</Text>
            <pre className="app-session-trajectory-subagent__pre">{subagentInputStr}</pre>
            {subagentPart.output?.trim() ? (
              <>
                <Text strong>输出</Text>
                <pre className="app-session-trajectory-subagent__pre">{subagentPart.output}</pre>
              </>
            ) : null}
            {subagentPart.error?.trim() ? (
              <>
                <Text type="danger">错误</Text>
                <pre className="app-session-trajectory-subagent__pre app-session-trajectory-subagent__pre--err">{subagentPart.error}</pre>
              </>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
