import { useEffect, useRef, useState } from "react";
import { Alert, Button, Progress, Space, Switch } from "antd";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DefaultConfigRow } from "./DefaultConfigRow";

import { APP_UPDATE_AUTO_CHECK_CHANGED, loadAppUpdateAutoCheck, saveAppUpdateAutoCheck } from "../../services/appUpdatePreferences";

import { checkWiseUpdate, WISE_RELEASES_URL as RELEASES_URL } from "../../services/appUpdateCheck";

export function AppUpdateSection({ checkOnOpen = false }: { checkOnOpen?: boolean }) {
  const [autoCheck, setAutoCheck] = useState(true);
  const [preferenceLoading, setPreferenceLoading] = useState(true);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [version, setVersion] = useState("读取中…");
  const [manualUpdate, setManualUpdate] = useState<{ version: string; body?: string } | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const resource = useRef<Update | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [phase, setPhase] = useState<"idle" | "checking" | "installing" | "installed">("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | undefined>();
  const desktop = isTauri();
  const busy = phase === "checking" || phase === "installing";

  useEffect(() => {
    mounted.current = true;
    if (desktop) {
      void getVersion().then((value) => { if (mounted.current) setVersion(value); })
        .catch(() => { if (mounted.current) setVersion("未知"); });
    } else setVersion("浏览器预览");
    return () => {
      mounted.current = false;
      if (!busyRef.current) void resource.current?.close().catch(() => {});
    };
  }, [desktop]);

  useEffect(() => {
    let active = true;
    let revision = 0;
    const changed = (event: Event) => {
      revision++;
      setAutoCheck((event as CustomEvent<boolean>).detail);
    };
    window.addEventListener(APP_UPDATE_AUTO_CHECK_CHANGED, changed);
    void loadAppUpdateAutoCheck().then((enabled) => {
      if (active && revision === 0) setAutoCheck(enabled);
    }).finally(() => { if (active) setPreferenceLoading(false); });
    return () => { active = false; window.removeEventListener(APP_UPDATE_AUTO_CHECK_CHANGED, changed); };
  }, []);

  async function changeAutoCheck(enabled: boolean) {
    setPreferenceSaving(true);
    try { await saveAppUpdateAutoCheck(enabled); }
    catch (cause) { setError(`保存自动更新检查设置失败：${String(cause)}`); }
    finally { if (mounted.current) setPreferenceSaving(false); }
  }

  async function checkUpdate() {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase("checking");
    setError("");
    setStatus("");
    try {
      await resource.current?.close();
      resource.current = null;
      setUpdate(null);
      setManualUpdate(null);
      const result = await checkWiseUpdate();
      if (!mounted.current) { if (result.kind === "installable") await result.update.close(); return; }
      if (result.kind === "installable") {
        resource.current = result.update;
        setUpdate(result.update);
        setStatus(`发现新版本 ${result.update.version}`);
      } else if (result.kind === "manual") {
        setManualUpdate(result);
        setStatus(`发现新版本 ${result.version}，该版本未提供应用内更新清单，请前往发布页面下载安装包`);
      } else {
        setStatus(result.latestVersion ? `当前版本 ${result.currentVersion}，最新公开版本 ${result.latestVersion}，暂无可用更新` : "当前已是最新版本");
      }
    } catch (cause) {
      if (mounted.current) setError(`检查更新失败：${String(cause)}。可前往发布页面下载安装包。`);
    } finally {
      busyRef.current = false;
      if (mounted.current) setPhase("idle");
    }
  }

  useEffect(() => {
    if (desktop && checkOnOpen) void checkUpdate();
  }, [desktop, checkOnOpen]);

  async function installUpdate() {
    const next = resource.current;
    if (!next || busyRef.current) return;
    busyRef.current = true;
    setPhase("installing");
    setError("");
    setProgress(undefined);
    let total = 0;
    let downloaded = 0;
    try {
      await next.downloadAndInstall((event) => {
        if (!mounted.current) return;
        if (event.event === "Started") { total = event.data.contentLength ?? 0; downloaded = 0; }
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        if (total > 0) setProgress(Math.min(100, Math.floor(downloaded / total * 100)));
        if (event.event === "Finished") setStatus("下载完成，正在安装…");
      });
      if (mounted.current) {
        setPhase("installed");
        setStatus("更新已安装，请在保存工作后重启 Wise");
      }
    } catch (cause) {
      if (mounted.current) { setError(`安装更新失败：${String(cause)}`); setPhase("idle"); }
    } finally {
      busyRef.current = false;
      if (!mounted.current) await next.close().catch(() => {});
    }
  }

  async function openReleases() {
    try { await openUrl(RELEASES_URL); }
    catch (cause) { setError(`打开发布页面失败：${String(cause)}`); }
  }

  return (
    <>
      <DefaultConfigRow title="自动检查更新" hint="启动后自动检查，每 6 小时复查；发现新版时提示" control={
        <Switch size="small" aria-label="自动检查更新" checked={autoCheck} disabled={!desktop || preferenceLoading || preferenceSaving} loading={preferenceSaving} onChange={(enabled) => void changeAutoCheck(enabled)} />
      } />
      <DefaultConfigRow title="Wise 版本" hint={`当前版本：${version}`} control={
        <Space wrap>
          <Button size="small" disabled={!desktop || busy || phase === "installed"} loading={phase === "checking"} onClick={() => void checkUpdate()}>检查更新</Button>
          {update && phase !== "installed" ? <Button size="small" type="primary" disabled={busy} loading={phase === "installing"} onClick={() => void installUpdate()}>下载并安装</Button> : null}
          {phase === "installed" ? <Button size="small" type="primary" onClick={() => void relaunch().catch((cause) => setError(`重启失败：${String(cause)}`))}>重启 Wise</Button> : null}
          {desktop ? <Button size="small" onClick={() => void openReleases()}>发布页面</Button> : <a href={RELEASES_URL} target="_blank" rel="noreferrer">发布页面</a>}
        </Space>
      } />
      {!desktop ? <Alert type="info" title="请在 Wise 桌面应用中检查和安装更新" /> : null}
      {status ? <p role="status">{status}</p> : null}
      {phase === "installing" ? <Progress percent={progress} status="active" format={(value) => progress === undefined ? "下载中…" : `${value}%`} /> : null}
      {(update?.body || manualUpdate?.body) ? <details><summary>更新说明 · {update?.version ?? manualUpdate?.version}</summary><div style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflowY: "auto" }}>{update?.body ?? manualUpdate?.body}</div></details> : null}
      {error ? <Alert type="error" title={error} /> : null}
    </>
  );
}
