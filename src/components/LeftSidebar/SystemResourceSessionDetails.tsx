import type { ReactNode } from "react";
import { Tag, Typography } from "antd";
import type { ClaudeHostProcess, ClaudeSessionInfo } from "../../types";
import { formatBytes } from "./systemSessions";
import "./SystemResourceSessionDetails.css";

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="app-sys-resource-details__dt">{label}</dt>
      <dd className="app-sys-resource-details__dd">{children}</dd>
    </>
  );
}

function CopyableValue({ value }: { value: string }) {
  const trimmed = value.trim();
  if (!trimmed) return <span className="app-sys-resource-details__muted">—</span>;
  return (
    <Typography.Text className="app-sys-resource-details__mono" copyable={{ text: trimmed }}>
      {trimmed}
    </Typography.Text>
  );
}

export function HostProcessSessionDetails({ proc }: { proc: ClaudeHostProcess }) {
  const sid = proc.sessionId?.trim() ?? "";
  const path = proc.projectPath?.trim() ?? "";
  const sourceLabel =
    proc.sessionSource === "lsof_jsonl"
      ? "jsonl（lsof）"
      : proc.sessionSource === "resume_arg"
        ? "命令行 -r"
        : "未解析";

  return (
    <div className="app-monitor-panel__history-session-drawer-scroll">
      <div className="app-sys-resource-details">
        <dl className="app-sys-resource-details__grid">
          <MetaRow label="类型">
            <span className="app-sys-resource-details__inline">
              本机 Claude
              <Tag bordered={false} className="app-sys-resource-details__tag">
                系统扫描
              </Tag>
            </span>
          </MetaRow>
          <MetaRow label="PID">{proc.pid}</MetaRow>
          <MetaRow label="内存">{formatBytes(proc.memoryBytes)}</MetaRow>
          <MetaRow label="会话来源">{sourceLabel}</MetaRow>
          <MetaRow label="工作区路径">
            <CopyableValue value={path} />
          </MetaRow>
          <MetaRow label="Claude 会话 ID">
            {sid ? (
              <CopyableValue value={sid} />
            ) : (
              <span className="app-sys-resource-details__muted">尚未解析</span>
            )}
          </MetaRow>
        </dl>
        <p className="app-sys-resource-details__note">
          有会话 ID 时可用侧栏「停止」结束；仅有 PID 时请在终端确认后再操作。
        </p>
      </div>
    </div>
  );
}

export function RegistryOrphanSessionDetails({
  sid,
  info,
}: {
  sid: string;
  info?: ClaudeSessionInfo;
}) {
  const path = info?.project_path.trim() ?? "";
  const model = info?.model.trim() ?? "";

  return (
    <div className="app-monitor-panel__history-session-drawer-scroll">
      <div className="app-sys-resource-details">
        <dl className="app-sys-resource-details__grid">
          <MetaRow label="类型">
            <span className="app-sys-resource-details__inline">
              注册表进程
              <Tag bordered={false} color="processing" className="app-sys-resource-details__tag">
                运行中
              </Tag>
            </span>
          </MetaRow>
          <MetaRow label="模型">{model || "—"}</MetaRow>
          <MetaRow label="工作区路径">
            <CopyableValue value={path} />
          </MetaRow>
          <MetaRow label="Claude 会话 ID">
            <CopyableValue value={sid} />
          </MetaRow>
        </dl>
        {!info ? (
          <p className="app-sys-resource-details__note app-sys-resource-details__note--warn">
            注册表元数据刷新中或进程已结束。
          </p>
        ) : (
          <p className="app-sys-resource-details__note">
            未绑定 Wise 标签，可直接「停止」或在终端确认。
          </p>
        )}
      </div>
    </div>
  );
}
