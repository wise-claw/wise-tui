import { Popover } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";
import { IconDefaultConfig } from "./SidebarIcons";
import "./DefaultConfigTopbarTrigger.css";

const DefaultConfigPanel = lazy(() =>
  import("../DefaultConfigPanel").then((module) => ({ default: module.DefaultConfigPanel })),
);

export function DefaultConfigTopbarTrigger() {
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen("global-open-default-config", () => {
      setOpen(true);
    })
      .then((fn) => {
        if (!cancelled) unlisten = fn;
        else safeUnlisten(fn);
      })
      .catch(() => {
        /* browser dev / non-Tauri */
      });
    return () => {
      cancelled = true;
      safeUnlisten(unlisten);
    };
  }, []);

  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      open={open}
      onOpenChange={handleOpenChange}
      destroyOnHidden={false}
      overlayClassName="app-default-config-topbar-popover"
      styles={{
        container: { padding: 0 },
        content: { padding: 0 },
      }}
      content={
        <Suspense
          fallback={<div className="app-default-config-topbar-popover-loading">加载中…</div>}
        >
          <div className="app-default-config-topbar-popover-body">
            <DefaultConfigPanel />
          </div>
        </Suspense>
      }
    >
      <HoverHint title="默认配置（⌥S）" open={open ? false : undefined}>
        <button
          type="button"
          className={
            "app-left-sidebar-topbar-btn app-default-config-topbar-btn" +
            (open ? " app-left-sidebar-topbar-btn--active" : "")
          }
          aria-label="默认配置"
          aria-expanded={open}
        >
          <IconDefaultConfig />
        </button>
      </HoverHint>
    </Popover>
  );
}
