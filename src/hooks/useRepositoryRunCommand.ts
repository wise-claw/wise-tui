import { message } from "antd";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Repository } from "../types";
import {
  getRepositoryRunCommandState,
  startRepositoryRunCommand,
  stopRepositoryRunCommand,
  subscribeRepositoryRunCommandRuntime,
  syncRepositoryRunCommandFormState,
  toggleRepositoryRunCommand,
} from "../stores/repositoryRunCommandRuntimeStore";
import {
  normalizeRunOpenUrl,
  readRunAutoOpenPageEnabled,
  repositoryRunCommandStorageKeys,
} from "../utils/repositoryRunCommand";

export type RepositoryRunStatus = "idle" | "running" | "stopping";

export type RunCommandOutputLine = { text: string; isError: boolean };

const IDLE_REPOSITORY_RUN_RUNTIME = {
  status: "idle" as const,
  statusHint: "未运行",
  outputPreview: [] as RunCommandOutputLine[],
  detectedUrl: null as string | null,
};

export type UseRepositoryRunCommandOptions = {
  repository: Pick<Repository, "id"> | null;
  runCwd: string;
  onAutoFixRunError?: (prompt: string) => void;
  /** 需要用户先填写/保存指令时打开外层 Popover/Modal */
  onRequestOpenPanel?: () => void;
  /** 成功下发运行命令后（顶栏 Popover 会关闭） */
  onRunStarted?: () => void;
};

function useLocalStorageBackedState(storageKey: string | null, fallback = "") {
  const [value, setValue] = useState(() =>
    storageKey ? (window.localStorage.getItem(storageKey) ?? fallback) : fallback,
  );
  useEffect(() => {
    if (!storageKey) {
      setValue(fallback);
      return;
    }
    setValue(window.localStorage.getItem(storageKey) ?? fallback);
  }, [fallback, storageKey]);
  return [value, setValue] as const;
}

export function useRepositoryRunCommand({
  repository,
  runCwd,
  onAutoFixRunError: _onAutoFixRunError,
  onRequestOpenPanel,
  onRunStarted,
}: UseRepositoryRunCommandOptions) {
  const repositoryId = repository?.id ?? null;
  const trimmedCwd = runCwd.trim();
  const { runKey, runUrlKey, runAutoOpenKey } = repositoryRunCommandStorageKeys(trimmedCwd);

  const subscribeRuntime = useCallback(
    (listener: () => void) => subscribeRepositoryRunCommandRuntime(listener),
    [],
  );

  const getRuntimeSlice = useCallback(() => {
    if (repositoryId == null) {
      return IDLE_REPOSITORY_RUN_RUNTIME;
    }
    return getRepositoryRunCommandState(repositoryId);
  }, [repositoryId]);

  const runtime = useSyncExternalStore(subscribeRuntime, getRuntimeSlice, getRuntimeSlice);

  const [runCommand, setRunCommand] = useLocalStorageBackedState(runKey, "");
  const [runPreferredUrl, setRunPreferredUrl] = useLocalStorageBackedState(runUrlKey, "");
  const [runAutoOpenPageEnabled, setRunAutoOpenPageEnabled] = useState(() =>
    readRunAutoOpenPageEnabled(runAutoOpenKey),
  );
  const [runErrorMonitorEnabled, setRunErrorMonitorEnabled] = useState(false);

  useEffect(() => {
    setRunAutoOpenPageEnabled(readRunAutoOpenPageEnabled(runAutoOpenKey));
  }, [runAutoOpenKey]);

  useEffect(() => {
    if (repositoryId == null || !trimmedCwd) return;
    syncRepositoryRunCommandFormState(repositoryId, trimmedCwd, {
      runCommand,
      runPreferredUrl,
      runAutoOpenPageEnabled,
      runErrorMonitorEnabled,
    });
  }, [
    repositoryId,
    runAutoOpenPageEnabled,
    runCommand,
    runErrorMonitorEnabled,
    runPreferredUrl,
    trimmedCwd,
  ]);

  const saveRunCommand = useCallback(() => {
    if (!runKey) return;
    const next = runCommand.trim();
    if (!next) {
      message.warning("请输入运行指令");
      return;
    }
    window.localStorage.setItem(runKey, next);
    setRunCommand(next);
    message.success("运行指令已保存");
  }, [runCommand, runKey, setRunCommand]);

  const saveRunOpenUrl = useCallback(() => {
    if (!runUrlKey) return;
    const next = runPreferredUrl.trim();
    if (!next) {
      window.localStorage.removeItem(runUrlKey);
      setRunPreferredUrl("");
      message.success("已清空指定打开地址");
      return;
    }
    const normalized = normalizeRunOpenUrl(next);
    if (!normalized) {
      message.warning("请输入有效的访问地址（http/https），不能是仓库本地路径。");
      return;
    }
    window.localStorage.setItem(runUrlKey, normalized);
    setRunPreferredUrl(normalized);
    message.success("指定打开地址已保存");
  }, [runPreferredUrl, runUrlKey, setRunPreferredUrl]);

  const inferDefaultRunUrl = useCallback((): string => {
    const cmd = runCommand.trim();
    const portByFlag = cmd.match(/(?:--port|-p)\s*(\d{2,5})/i)?.[1];
    const portByEnv = cmd.match(/PORT=(\d{2,5})/i)?.[1];
    const port = portByFlag || portByEnv || "16088";
    return `http://localhost:${port}`;
  }, [runCommand]);

  const resolveOpenUrl = useCallback((): string => {
    const preferred = normalizeRunOpenUrl(runPreferredUrl);
    if (preferred) return preferred;
    if (runtime.detectedUrl) return runtime.detectedUrl;
    return inferDefaultRunUrl();
  }, [inferDefaultRunUrl, runPreferredUrl, runtime.detectedUrl]);

  const handleRunAutoOpenPageChange = useCallback(
    (checked: boolean) => {
      setRunAutoOpenPageEnabled(checked);
      if (!runAutoOpenKey) return;
      window.localStorage.setItem(runAutoOpenKey, checked ? "1" : "0");
    },
    [runAutoOpenKey],
  );

  const startRun = useCallback(async () => {
    if (!repository || !trimmedCwd) return;
    await startRepositoryRunCommand({
      repository: { id: repository.id, path: trimmedCwd },
      onRequestConfigure: onRequestOpenPanel,
      onRunStarted,
    });
  }, [onRequestOpenPanel, onRunStarted, repository, trimmedCwd]);

  const stopRun = useCallback(async () => {
    if (!repository) return;
    await stopRepositoryRunCommand(repository);
  }, [repository]);

  const handleRunButtonClick = useCallback(() => {
    if (!trimmedCwd) {
      message.warning("当前会话未绑定仓库路径，无法运行。请先切换到具体仓库会话。");
      return;
    }
    if (!repository) return;
    void toggleRepositoryRunCommand({
      repository: { id: repository.id, path: trimmedCwd },
      onRequestConfigure: onRequestOpenPanel,
      onRunStarted,
    });
  }, [onRequestOpenPanel, onRunStarted, repository, trimmedCwd]);

  return {
    runCwd: trimmedCwd,
    runCommand,
    setRunCommand,
    runPreferredUrl,
    setRunPreferredUrl,
    runStatus: runtime.status,
    runStatusHint: runtime.statusHint,
    runOutputPreview: runtime.outputPreview,
    runDetectedUrl: runtime.detectedUrl,
    runErrorMonitorEnabled,
    setRunErrorMonitorEnabled,
    runAutoOpenPageEnabled,
    handleRunAutoOpenPageChange,
    saveRunCommand,
    saveRunOpenUrl,
    resolveOpenUrl,
    startRun,
    stopRun,
    handleRunButtonClick,
  };
}
