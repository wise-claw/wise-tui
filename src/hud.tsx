import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HudComposerBar, type HudOverlayMode } from "./components/HudMode/HudComposerBar";
import { wiseHudIsActive, wiseHudRequestState, wiseHudSaveBounds, wiseHudSetOverlayHeight } from "./services/wiseHud";
import { setWiseHudModeActive } from "./stores/wiseHudModeStore";
import { bootstrapAppTheme, startSystemThemeWatch, useAppTheme } from "./stores/appThemeStore";
import { buildAppThemeConfig } from "./constants/appThemeTokens";
import { ensureTauriEventUnlistenPatched, safeUnlisten } from "./utils/safeTauriUnlisten";
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

const HUD_COMPACT_HEIGHT = 64;
const HUD_IMAGE_OVERLAY_MAX = 780;
const HUD_MENU_OVERLAY_HEIGHT = 400;

function overlayHeightForMode(mode: HudOverlayMode): number {
  if (mode === "menu") return HUD_MENU_OVERLAY_HEIGHT;
  if (mode === "images") return HUD_IMAGE_OVERLAY_MAX;
  return HUD_COMPACT_HEIGHT;
}

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
  const overlayModeRef = useRef(overlayMode);
  overlayModeRef.current = overlayMode;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncWindowHeight = useCallback(async (mode: HudOverlayMode) => {
    try {
      await wiseHudSetOverlayHeight(overlayHeightForMode(mode));
    } catch {
      /* 窗口 API 在非 Tauri 预览时不可用 */
    }
  }, []);

  useEffect(() => {
    void syncWindowHeight(overlayMode);
  }, [overlayMode, syncWindowHeight]);

  useEffect(() => {
    let cancelled = false;
    const unsubs: UnlistenFn[] = [];
    void (async () => {
      await wiseHudRequestState();
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
              if (overlayModeRef.current !== "none") return;
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
    <HudComposerBar snapshot={snapshot} onOverlayOpenChange={setOverlayMode} />
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
