import { message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  formatBrowseProbeHint,
  formatBrowseInstallSummary,
  installStagehandBrowseDeps,
  loadStagehandBrowseConfig,
  loadStagehandBrowseLatestReport,
  parseStagehandPageStatus,
  probeStagehandBrowse,
  readStagehandDaemonStatus,
  saveStagehandBrowseConfig,
  stopStagehandDaemon,
  buildBrowseReadiness,
  resolveBrowseUrl,
  type StagehandBrowseLatestReport,
  type StagehandStartOptions,
} from "../services/stagehandBrowse";
import {
  appendStagehandBrowseLog,
  getStagehandBrowseRuntimeSnapshot,
  setStagehandBrowsePage,
  setStagehandBrowseProbe,
  setStagehandBrowseStatus,
  subscribeStagehandBrowseRuntime,
} from "../stores/stagehandBrowseRuntimeStore";
import { normalizeRunOpenUrl } from "../utils/repositoryRunCommand";

function emptyProbe(error: string) {
  return {
    browseAvailable: false,
    browseBinary: null,
    browseVersion: null,
    sidecarAvailable: false,
    sidecarDir: null,
    sidecarReady: false,
    runtime: null,
    hasBrowserbaseKey: false,
    cliAvailable: false,
    cliBinary: null,
    skillInstalled: false,
    configPath: null,
    error,
  };
}

export function useStagehandBrowse(_input?: {
  repositoryId: number | null | undefined;
  repositoryPath: string;
}) {
  const sessionId = "global";
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeStagehandBrowseRuntime(sessionId, onStoreChange),
    [sessionId],
  );
  const getSnapshot = useCallback(
    () => getStagehandBrowseRuntimeSnapshot(sessionId),
    [sessionId],
  );
  const runtime = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [urlDraft, setUrlDraft] = useState("https://www.google.com");
  const [env, setEnv] = useState<StagehandStartOptions["env"]>("local");
  const [headed, setHeaded] = useState(true);
  const [model, setModel] = useState("");
  const [modelApiKey, setModelApiKey] = useState("");
  const [browserbaseApiKey, setBrowserbaseApiKey] = useState("");
  const [cdpUrl, setCdpUrl] = useState("");
  const [persistAuth, setPersistAuth] = useState(true);
  const [authProfile, setAuthProfile] = useState("default");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [latestReport, setLatestReport] = useState<StagehandBrowseLatestReport | null>(null);
  const dirtyRef = useRef(false);
  const statusRef = useRef(runtime.status);
  dirtyRef.current = dirty;
  statusRef.current = runtime.status;

  const probeHint = useMemo(() => formatBrowseProbeHint(runtime.probe), [runtime.probe]);
  const readiness = useMemo(() => buildBrowseReadiness(runtime.probe), [runtime.probe]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [probe, daemon, config, report] = await Promise.all([
        probeStagehandBrowse(),
        readStagehandDaemonStatus().catch(() => parseStagehandPageStatus({ running: false })),
        loadStagehandBrowseConfig().catch(() => null),
        loadStagehandBrowseLatestReport().catch(() => null),
      ]);
      setStagehandBrowseProbe(sessionId, probe);
      setStagehandBrowsePage(sessionId, daemon);
      setLatestReport(report);
      if (daemon.running) {
        setStagehandBrowseStatus(sessionId, "running", daemon.title || daemon.url || "浏览器运行中");
      } else if (statusRef.current === "running") {
        setStagehandBrowseStatus(sessionId, "idle", "未启动");
      }
      if (config && !dirtyRef.current) {
        if (config.env) setEnv(config.env);
        if (typeof config.headed === "boolean") setHeaded(config.headed);
        if (typeof config.model === "string") setModel(config.model);
        if (typeof config.modelApiKey === "string") setModelApiKey(config.modelApiKey);
        if (typeof config.browserbaseApiKey === "string") setBrowserbaseApiKey(config.browserbaseApiKey);
        if (typeof config.cdpUrl === "string") setCdpUrl(config.cdpUrl);
        if (typeof config.persistAuth === "boolean") setPersistAuth(config.persistAuth);
        if (typeof config.authProfile === "string" && config.authProfile.trim()) {
          setAuthProfile(config.authProfile.trim());
        }
        if (typeof config.url === "string" && config.url.trim()) setUrlDraft(config.url);
      }
    } catch (error) {
      setStagehandBrowseProbe(
        sessionId,
        emptyProbe(error instanceof Error ? error.message : String(error)),
      );
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markDirty = useCallback(() => setDirty(true), []);

  const saveConfig = useCallback(async () => {
    const normalized = urlDraft.trim()
      ? resolveBrowseUrl(urlDraft) || normalizeRunOpenUrl(urlDraft) || ""
      : "";
    if (urlDraft.trim() && !normalized) {
      message.error("请输入合法的 http(s) 地址或站点名（如 谷歌）");
      return;
    }
    setBusy(true);
    try {
      await saveStagehandBrowseConfig({
        env,
        headed,
        model: model.trim() || undefined,
        modelApiKey: modelApiKey.trim() || undefined,
        browserbaseApiKey: browserbaseApiKey.trim() || undefined,
        cdpUrl: env === "cdp" ? cdpUrl.trim() || undefined : undefined,
        persistAuth,
        authProfile: authProfile.trim() || "default",
        url: normalized || undefined,
      });
      if (normalized) setUrlDraft(normalized);
      setDirty(false);
      appendStagehandBrowseLog(sessionId, "info", "已保存浏览器自动化配置");
      message.success("配置已保存，会话里可直接使用 wise browse");
      await refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      appendStagehandBrowseLog(sessionId, "error", text);
      message.error(text);
    } finally {
      setBusy(false);
    }
  }, [
    browserbaseApiKey,
    cdpUrl,
    env,
    headed,
    persistAuth,
    authProfile,
    model,
    modelApiKey,
    refresh,
    sessionId,
    urlDraft,
  ]);

  const installCli = useCallback(async () => {
    setBusy(true);
    try {
      const result = await installStagehandBrowseDeps();
      if (!result.ok) {
        throw new Error(result.stderr || result.stdout || "安装 CLI 失败");
      }
      await refresh();
      message.success(formatBrowseInstallSummary(result));
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      appendStagehandBrowseLog(sessionId, "error", text);
      message.error(text);
    } finally {
      setBusy(false);
    }
  }, [refresh, sessionId]);

  const stop = useCallback(async () => {
    setStagehandBrowseStatus(sessionId, "stopping", "正在停止…");
    try {
      await stopStagehandDaemon();
      setStagehandBrowseStatus(sessionId, "idle", "已停止");
      appendStagehandBrowseLog(sessionId, "info", "浏览器后台进程已停止");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setStagehandBrowseStatus(sessionId, "idle", "停止失败");
      appendStagehandBrowseLog(sessionId, "error", text);
      message.error(text);
    }
  }, [sessionId]);

  const isActive = runtime.status === "running" || runtime.status === "starting";

  return {
    ...runtime,
    urlDraft,
    setUrlDraft: (value: string) => {
      markDirty();
      setUrlDraft(value);
    },
    env,
    setEnv: (value: StagehandStartOptions["env"]) => {
      markDirty();
      setEnv(value);
    },
    headed,
    setHeaded: (value: boolean) => {
      markDirty();
      setHeaded(value);
    },
    model,
    setModel: (value: string) => {
      markDirty();
      setModel(value);
    },
    modelApiKey,
    setModelApiKey: (value: string) => {
      markDirty();
      setModelApiKey(value);
    },
    browserbaseApiKey,
    setBrowserbaseApiKey: (value: string) => {
      markDirty();
      setBrowserbaseApiKey(value);
    },
    cdpUrl,
    setCdpUrl: (value: string) => {
      markDirty();
      setCdpUrl(value);
    },
    persistAuth,
    setPersistAuth: (value: boolean) => {
      markDirty();
      setPersistAuth(value);
    },
    authProfile,
    setAuthProfile: (value: string) => {
      markDirty();
      setAuthProfile(value);
    },
    advancedOpen,
    setAdvancedOpen,
    probeHint,
    readiness,
    latestReport,
    busy,
    dirty,
    isActive,
    saveConfig,
    installCli,
    stop,
    refresh,
  };
}
