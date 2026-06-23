import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dingtalkStreamGatewayStart,
  dingtalkStreamGatewayStop,
} from "../services/dingtalkStreamGateway";
import {
  genericWsStart,
  genericWsStop,
  loadGenericWsConfig,
  type GenericWsStatus,
} from "../services/remoteChannels";
import {
  loadRemoteEntryTopbarSnapshot,
  type RemoteEntryStartableId,
  type RemoteEntryTopbarSnapshot,
} from "../services/remoteEntryTopbar";
import { readVisiblePollIntervalMs } from "../utils/adaptivePoll";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "../services/mainWindow";
import { safeUnlisten } from "../utils/safeTauriUnlisten";

const POLL_MS = 5000;

export function useRemoteEntryTopbar() {
  const [snapshot, setSnapshot] = useState<RemoteEntryTopbarSnapshot | null>(null);
  const [busyId, setBusyId] = useState<RemoteEntryStartableId | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setSnapshot(await loadRemoteEntryTopbarSnapshot());
    } catch {
      setSnapshot(null);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void refresh();
    const remotePrimaryMs = POLL_MS;
    const remoteHiddenMs = 20000;
    const remoteVisibleMs = isCurrentPrimaryMainWorkspaceWindowSync() ? remotePrimaryMs : remoteHiddenMs;
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refresh();
    }, readVisiblePollIntervalMs(remoteVisibleMs, remoteHiddenMs * 2));
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      const u = await listen<GenericWsStatus>("wise:generic-ws:status", (event) => {
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            genericWs: {
              configured: prev.genericWs.configured,
              running: event.payload.running,
              phase: event.payload.phase ?? (event.payload.running ? "connected" : "stopped"),
              lastError: event.payload.lastError ?? null,
            },
          };
        });
      });
      if (cancelled) {
        safeUnlisten(u);
        return;
      }
      unlisten = u;
    })();
    return () => {
      cancelled = true;
      if (unlisten) safeUnlisten(unlisten);
    };
  }, []);

  const toggleDingtalk = useCallback(
    async (next: boolean) => {
      if (!snapshot?.dingtalk.configured) return;
      setBusyId("dingtalk");
      try {
        if (next) {
          await dingtalkStreamGatewayStart();
        } else {
          await dingtalkStreamGatewayStop();
        }
        await refresh();
      } catch (err) {
        await refresh();
        void message.error(err instanceof Error ? err.message : "钉钉远程入口切换失败");
      } finally {
        setBusyId(null);
      }
    },
    [refresh, snapshot?.dingtalk.configured],
  );

  const toggleGenericWs = useCallback(
    async (next: boolean) => {
      if (!snapshot?.genericWs.configured) return;
      setBusyId("genericWs");
      try {
        if (next) {
          const cfg = await loadGenericWsConfig();
          if (!cfg?.url?.trim()) {
            void message.warning("请先在远程入口中配置 WebSocket URL");
            return;
          }
          await genericWsStart(cfg);
        } else {
          await genericWsStop();
        }
        await refresh();
      } catch (err) {
        await refresh();
        void message.error(err instanceof Error ? err.message : "WebSocket 远程入口切换失败");
      } finally {
        setBusyId(null);
      }
    },
    [refresh, snapshot?.genericWs.configured],
  );

  const startableEntries = useMemo(() => {
    if (!snapshot) return [];
    const rows: Array<{
      id: RemoteEntryStartableId;
      state: RemoteEntryTopbarSnapshot["dingtalk"];
    }> = [];
    if (snapshot.dingtalk.configured) {
      rows.push({ id: "dingtalk", state: snapshot.dingtalk });
    }
    if (snapshot.genericWs.configured) {
      rows.push({ id: "genericWs", state: snapshot.genericWs });
    }
    return rows;
  }, [snapshot]);

  const anyRunning = useMemo(
    () => Boolean(snapshot?.dingtalk.running || snapshot?.genericWs.running),
    [snapshot],
  );

  const webhookConfiguredCount = useMemo(() => {
    if (!snapshot) return 0;
    return [snapshot.feishuConfigured, snapshot.wecomConfigured, snapshot.telegramConfigured].filter(Boolean)
      .length;
  }, [snapshot]);

  return {
    snapshot,
    startableEntries,
    anyRunning,
    webhookConfiguredCount,
    busyId,
    toggleDingtalk,
    toggleGenericWs,
    refresh,
  };
}
