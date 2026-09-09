import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HudComposerBar, type HudOverlayMode } from "./components/HudMode/HudComposerBar";
import {
  wiseHudIsActive,
  wiseHudLoadDetailsHeight,
  wiseHudRequestState,
  wiseHudSaveBounds,
  wiseHudSaveDetailsHeight,
  wiseHudSetOverlayHeight,
} from "./services/wiseHud";
import { setWiseHudModeActive } from "./stores/wiseHudModeStore";
import { bootstrapAppTheme, startSystemThemeWatch, useAppTheme } from "./stores/appThemeStore";
import { buildAppThemeConfig } from "./constants/appThemeTokens";
import { ensureTauriEventUnlistenPatched, safeUnlisten } from "./utils/safeTauriUnlisten";
import { overlayHeightFor } from "./utils/hudOverlayHeight";
import { clampHudDetailsHeight, HUD_DETAILS_HEIGHT_DEFAULT } from "./utils/hudDetailsHeight";
import { loadHudDetailsDefaultsFromStore } from "./services/wiseDefaultConfigStore";
import { useHudClickThrough } from "./hooks/useHudClickThrough";
import { useHudCompletionToasts } from "./hooks/useHudCompletionToasts";
import {
  buildWiseHudSessionSnapshot,
  parseWiseHudActiveChanged,
  parseWiseHudSessionSnapshot,
  WISE_HUD_ACTIVE_EVENT,
  WISE_HUD_STATE_EVENT,
  type WiseHudSessionSnapshot,
} from "./utils/wiseHudSnapshot";
import "./components/ClaudeSessions/index.css";
import "./hud.css";

ensureTauriEventUnlistenPatched();
bootstrapAppTheme();
startSystemThemeWatch();

function HudThemeRoot({ children }: { children: ReactNode }) {
  const { dark } = useAppTheme();
  const themeConfig = useMemo(
    () => ({
      ...buildAppThemeConfig(dark),
      cssVar: { prefix: "ant" },
    }),
    [dark],
  );
  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <AntdApp className="app-hud-antd-app">{children}</AntdApp>
    </ConfigProvider>
  );
}

function HudApp() {
  const [snapshot, setSnapshot] = useState<WiseHudSessionSnapshot>(() =>
    buildWiseHudSessionSnapshot(null),
  );
  const [overlayMode, setOverlayMode] = useState<HudOverlayMode>("none");
  const [persistentDetailsEnabled, setPersistentDetailsEnabled] = useState(false);
  const [detailsPreferenceRevision, setDetailsPreferenceRevision] = useState(0);
  const [detailsHeight, setDetailsHeight] = useState(HUD_DETAILS_HEIGHT_DEFAULT);
  const overlayModeRef = useRef(overlayMode);
  overlayModeRef.current = overlayMode;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toasts, renderedCount, dismiss } = useHudCompletionToasts();
  const toastCountRef = useRef(renderedCount);
  toastCountRef.current = renderedCount;
  useHudClickThrough();
  const lastOverlayHeightRef = useRef<number | null>(null);
  const requestedOverlayHeightRef = useRef(HUD_DETAILS_HEIGHT_DEFAULT);
  const overlayHeightSyncingRef = useRef(false);

  const syncWindowHeight = useCallback((
    mode: HudOverlayMode,
    toastCount: number,
    preferredDetailsHeight: number,
  ) => {
    const height = overlayHeightFor(mode, toastCount, preferredDetailsHeight);
    requestedOverlayHeightRef.current = height;
    if (overlayHeightSyncingRef.current || lastOverlayHeightRef.current === height) return;
    overlayHeightSyncingRef.current = true;
    void (async () => {
      try {
        while (lastOverlayHeightRef.current !== requestedOverlayHeightRef.current) {
          const nextHeight = requestedOverlayHeightRef.current;
          await wiseHudSetOverlayHeight(nextHeight);
          lastOverlayHeightRef.current = nextHeight;
        }
      } catch {
        lastOverlayHeightRef.current = null;
      } finally {
        overlayHeightSyncingRef.current = false;
      }
    })();
  }, []);

  useEffect(() => {
    syncWindowHeight(overlayMode, renderedCount, detailsHeight);
  }, [overlayMode, renderedCount, detailsHeight, syncWindowHeight]);

  useEffect(() => {
    let cancelled = false;
    const unsubs: UnlistenFn[] = [];
    void (async () => {
      await wiseHudRequestState();
      void wiseHudLoadDetailsHeight()
        .then((height) => {
          if (height != null) setDetailsHeight(clampHudDetailsHeight(height));
        })
        .catch(() => undefined);
      void loadHudDetailsDefaultsFromStore()
        .then((defaults) => {
          setPersistentDetailsEnabled(defaults.showHudPersistentDetails);
          setDetailsPreferenceRevision((revision) => revision + 1);
        })
        .catch(() => {
          setPersistentDetailsEnabled(false);
          setDetailsPreferenceRevision((revision) => revision + 1);
        });
      void wiseHudIsActive()
        .then((active) => setWiseHudModeActive(active))
        .catch(() => setWiseHudModeActive(false));
      const u1 = await listen<unknown>(WISE_HUD_STATE_EVENT, (event) => {
        const next = parseWiseHudSessionSnapshot(event.payload);
        if (next) setSnapshot(next);
      });
      const uActive = await listen<unknown>(WISE_HUD_ACTIVE_EVENT, (event) => {
        const active = parseWiseHudActiveChanged(event.payload);
        if (active == null) return;
        setWiseHudModeActive(active);
        if (active) {
          void loadHudDetailsDefaultsFromStore()
            .then((defaults) => {
              setPersistentDetailsEnabled(defaults.showHudPersistentDetails);
              setDetailsPreferenceRevision((revision) => revision + 1);
            })
            .catch(() => undefined);
        }
      });
      if (cancelled) {
        safeUnlisten(u1);
        safeUnlisten(uActive);
        return;
      }
      unsubs.push(u1, uActive);

      const win = getCurrentWindow();
      const persist = () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null;
          void (async () => {
            try {
              if (overlayModeRef.current !== "none" || toastCountRef.current > 0) return;
              const pos = await win.outerPosition();
              const size = await win.outerSize();
              const scale = await win.scaleFactor();
              await wiseHudSaveBounds(pos.x, pos.y, size.width / scale);
            } catch {
              /* ignore */
            }
          })();
        }, 280);
      };
      const u2 = await win.onMoved(persist);
      if (cancelled) {
        safeUnlisten(u2);
        return;
      }
      unsubs.push(u2);
      const u3 = await win.onResized(persist);
      if (cancelled) {
        safeUnlisten(u3);
        return;
      }
      unsubs.push(u3);
    })();
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      for (const u of unsubs) safeUnlisten(u);
    };
  }, []);

  return (
    <HudComposerBar
      snapshot={snapshot}
      persistentDetailsEnabled={persistentDetailsEnabled}
      detailsPreferenceRevision={detailsPreferenceRevision}
      toasts={toasts}
      onDismissToast={dismiss}
      onOverlayOpenChange={setOverlayMode}
      detailsHeight={detailsHeight}
      onDetailsHeightChange={setDetailsHeight}
      onDetailsHeightCommit={(height) => void wiseHudSaveDetailsHeight(height)}
    />
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <HudThemeRoot>
      <HudApp />
    </HudThemeRoot>,
  );
}
