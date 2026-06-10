import { ReloadOutlined } from "@ant-design/icons";
import { Button, Input, Space, Typography } from "antd";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { CopyFeedbackIcon } from "../shared/CopyFeedbackIcon";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import {
  describeCursorAgentStatus,
  probeCursorAgent,
  probeCursorAgentWrite,
  probeCursorRepositoryFiles,
  type CursorAgentStatus,
} from "../../services/cursorAgent";
import "./index.css";

export interface CursorSdkDiagnosticPanelProps {
  /** 预填仓库绝对路径 */
  initialRepositoryPath?: string | null;
  /** 挂载后自动跑一次 SDK 探测 */
  autoProbeOnMount?: boolean;
  /** 嵌入工作台配置时为 false，独立 /demo.html 为 true */
  showStandaloneHint?: boolean;
}

function formatStatus(status: CursorAgentStatus): string {
  return JSON.stringify(
    {
      summary: describeCursorAgentStatus(status),
      ...status,
    },
    null,
    2,
  );
}

export function CursorSdkDiagnosticPanel({
  initialRepositoryPath = "",
  autoProbeOnMount = true,
  showStandaloneHint = false,
}: CursorSdkDiagnosticPanelProps) {
  const [repositoryPath, setRepositoryPath] = useState(
    () => initialRepositoryPath?.trim() ?? "",
  );
  const [output, setOutput] = useState("等待探测…");
  const [hasError, setHasError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = initialRepositoryPath?.trim() ?? "";
    if (next) setRepositoryPath(next);
  }, [initialRepositoryPath]);

  const ensureTauri = useCallback((): boolean => {
    if (isTauri()) return true;
    setHasError(true);
    setOutput(
      showStandaloneHint
        ? "当前页面不在 Wise/Tauri 环境中。\n请从 Wise 开发窗口访问本页，或使用 tauri dev 启动后在应用内打开 /demo.html。"
        : "Tauri IPC 不可用。请确认在 Wise 桌面应用中打开本页，勿使用外部浏览器或 iframe 嵌套访问 /demo.html。",
    );
    return false;
  }, [showStandaloneHint]);

  const runProbe = useCallback(async () => {
    if (!ensureTauri()) return;
    setHasError(false);
    setBusy(true);
    setOutput("探测中…");
    try {
      const repo = repositoryPath.trim() || null;
      const status = await probeCursorAgent(repo);
      setOutput(formatStatus(status));
      setHasError(!status.available);
    } catch (error) {
      setHasError(true);
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [ensureTauri, repositoryPath]);

  const runFilesProbe = useCallback(async () => {
    if (!ensureTauri()) return;
    const repo = repositoryPath.trim();
    if (!repo) {
      setHasError(true);
      setOutput("请先填写仓库路径");
      return;
    }
    setHasError(false);
    setBusy(true);
    setOutput("检查落盘中…");
    try {
      const result = await probeCursorRepositoryFiles(repo, "public/demo.html");
      setOutput(JSON.stringify(result, null, 2));
      setHasError(!result.repositoryWriteOk);
    } catch (error) {
      setHasError(true);
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [ensureTauri, repositoryPath]);

  const runAgentWriteProbe = useCallback(async () => {
    if (!ensureTauri()) return;
    const repo = repositoryPath.trim();
    if (!repo) {
      setHasError(true);
      setOutput("请先填写仓库路径");
      return;
    }
    setHasError(false);
    setBusy(true);
    setOutput("Agent 写盘自检中（composer-2.5 + agent 模式，请等待约 30–90 秒）…");
    try {
      const result = await probeCursorAgentWrite(repo);
      setOutput(JSON.stringify(result, null, 2));
      setHasError(!result.agentWriteOk);
    } catch (error) {
      setHasError(true);
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [ensureTauri, repositoryPath]);

  useEffect(() => {
    if (!autoProbeOnMount) return;
    void runProbe();
    // 仅挂载时自动探测；避免仓库路径输入变化时反复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const win = window as Window & {
      __wiseCursorSdkProbe?: (path?: string) => Promise<CursorAgentStatus>;
      __wiseCursorAgentWriteProbe?: (path: string) => ReturnType<typeof probeCursorAgentWrite>;
      __wiseCursorRepositoryFilesProbe?: (
        path: string,
      ) => ReturnType<typeof probeCursorRepositoryFiles>;
    };
    win.__wiseCursorSdkProbe = (path?: string) => probeCursorAgent(path?.trim() || null);
    win.__wiseCursorAgentWriteProbe = (path: string) => probeCursorAgentWrite(path);
    win.__wiseCursorRepositoryFilesProbe = (path: string) =>
      probeCursorRepositoryFiles(path, "public/demo.html");
    return () => {
      delete win.__wiseCursorSdkProbe;
      delete win.__wiseCursorAgentWriteProbe;
      delete win.__wiseCursorRepositoryFilesProbe;
    };
  }, []);

  const { copied, copy } = useCopyToClipboard();

  const copyOutput = useCallback(() => {
    if (!output) return;
    void copy(output);
  }, [copy, output]);

  return (
    <div className="wise-cursor-sdk-diagnostic-panel">
      {showStandaloneHint ? (
        <Typography.Paragraph type="secondary" className="wise-cursor-sdk-diagnostic-panel__hint">
          开发时可访问 <Typography.Text code>/demo.html</Typography.Text>
          。请在 Wise 桌面窗口内打开（需 Tauri IPC）；单独用浏览器打开无法探测 SDK。
        </Typography.Paragraph>
      ) : null}
      <label className="wise-cursor-sdk-diagnostic-panel__label" htmlFor="wise-cursor-sdk-repo">
        仓库路径（可选，用于读/写探测）
      </label>
      <Input
        id="wise-cursor-sdk-repo"
        value={repositoryPath}
        onChange={(event) => setRepositoryPath(event.target.value)}
        placeholder="/path/to/your/repo"
        disabled={busy}
      />
      <Space wrap className="wise-cursor-sdk-diagnostic-panel__actions">
        <Button icon={<ReloadOutlined />} onClick={() => void runProbe()} loading={busy}>
          重新探测 SDK
        </Button>
        <Button onClick={() => void runFilesProbe()} loading={busy}>
          检查 public/demo.html 落盘
        </Button>
        <Button onClick={() => void runAgentWriteProbe()} loading={busy}>
          Agent 写盘自检（约 1 分钟）
        </Button>
        <Button icon={<CopyFeedbackIcon copied={copied} />} onClick={copyOutput} disabled={!output}>
          {copied ? "已复制" : "复制结果"}
        </Button>
      </Space>
      <pre
        className={
          "wise-cursor-sdk-diagnostic-panel__out" +
          (hasError ? " wise-cursor-sdk-diagnostic-panel__out--err" : "")
        }
      >
        {output}
      </pre>
    </div>
  );
}
