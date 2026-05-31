import { message } from "antd";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Repository } from "../types";
import { detectRepositoryRunProfile } from "../services/repositoryRunProfileDetect";
import type { RepositoryRunProfile } from "../utils/detectRepositoryRunProfile";
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
  const [detectedProfile, setDetectedProfile] = useState<RepositoryRunProfile | null>(null);
  const [detectingProfile, setDetectingProfile] = useState(false);
  const autoAppliedProfileSourceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!trimmedCwd) {
      setDetectedProfile(null);
      setDetectingProfile(false);
      autoAppliedProfileSourceRef.current = null;
      return;
    }

    let cancelled = false;
    setDetectingProfile(true);
    void detectRepositoryRunProfile(trimmedCwd)
      .then((profile) => {
        if (cancelled) return;
        setDetectedProfile(profile);
        setDetectingProfile(false);
        if (!profile || runKey == null) return;
        const saved = window.localStorage.getItem(runKey)?.trim();
        if (saved) return;
        if (autoAppliedProfileSourceRef.current === profile.source) return;
        autoAppliedProfileSourceRef.current = profile.source;
        setRunCommand(profile.runCommand);
        window.localStorage.setItem(runKey, profile.runCommand);
        if (profile.defaultUrl && runUrlKey) {
          const existingUrl = window.localStorage.getItem(runUrlKey)?.trim();
          if (!existingUrl) {
            window.localStorage.setItem(runUrlKey, profile.defaultUrl);
            setRunPreferredUrl(profile.defaultUrl);
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        setDetectedProfile(null);
        setDetectingProfile(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runKey, runUrlKey, setRunCommand, setRunPreferredUrl, trimmedCwd]);

  useEffect(() => {
    setRunAutoOpenPageEnabled(readRunAutoOpenPageEnabled(runAutoOpenKey));
  }, [runAutoOpenKey]);

  const applyDetectedProfile = useCallback(() => {
    if (!detectedProfile || !runKey) return;
    setRunCommand(detectedProfile.runCommand);
    window.localStorage.setItem(runKey, detectedProfile.runCommand);
    if (detectedProfile.defaultUrl && runUrlKey) {
      window.localStorage.setItem(runUrlKey, detectedProfile.defaultUrl);
      setRunPreferredUrl(detectedProfile.defaultUrl);
    }
    message.success(`已应用检测到的运行配置（${detectedProfile.label}）`);
  }, [detectedProfile, runKey, runUrlKey, setRunCommand, setRunPreferredUrl]);

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
    if (detectedProfile?.defaultUrl) return detectedProfile.defaultUrl;
    const cmd = runCommand.trim();
    const portByFlag = cmd.match(/(?:--port|-p)\s*(\d{2,5})/i)?.[1];
    const portByEnv = cmd.match(/PORT=(\d{2,5})/i)?.[1];
    const port = portByFlag || portByEnv || "16088";
    return `http://localhost:${port}`;
  }, [detectedProfile?.defaultUrl, runCommand]);

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

  const startRun = useCallback(
    async (options?: { debug?: boolean }) => {
      if (!repository || !trimmedCwd) return;
      const commandOverride =
        options?.debug && detectedProfile?.debugCommand ? detectedProfile.debugCommand : undefined;
      await startRepositoryRunCommand({
        repository: { id: repository.id, path: trimmedCwd },
        commandOverride,
        onRequestConfigure: onRequestOpenPanel,
        onRunStarted,
      });
    },
    [detectedProfile?.debugCommand, onRequestOpenPanel, onRunStarted, repository, trimmedCwd],
  );

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
    detectedProfile,
    detectingProfile,
    applyDetectedProfile,
    startRun,
    stopRun,
    handleRunButtonClick,
  };
}
