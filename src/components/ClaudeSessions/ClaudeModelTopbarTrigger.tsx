import { Popover, Spin } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useModelProfileSwitcher } from "../../hooks/useClaudeModelProfileStore";
import { pickBadgeEffectiveModel } from "../../types/claudeModelProfile";
import { ClaudeModelTopbarPanelLazy } from "./ClaudeModelTopbarPanel.lazy";
import "./ClaudeModelTopbarTrigger.css";

const claudeModelTopbarPanelChunk = import("./ClaudeModelTopbarPanel");

function IconClaudeModel() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M12 3c-1.5 2.2-4.5 4.1-4.5 7.2 0 2.5 2 4.5 4.5 4.5S16.5 12.7 16.5 10.2C16.5 7.1 13.5 5.2 12 3Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 14.5 6 21M15.5 14.5 18 21M9 18h6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="12" cy="10" r="1.75" fill="currentColor" />
    </svg>
  );
}

interface Props {
  /** 左栏顶栏与主会话顶栏按钮样式 */
  variant?: "sidebar" | "chat";
}

export function ClaudeModelTopbarTrigger({ variant = "chat" }: Props) {
  const [open, setOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const { effectiveModels, store, setStore, loading } = useModelProfileSwitcher(open);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      setPanelMounted(true);
      void claudeModelTopbarPanelChunk;
    }
  }, []);

  const effectiveModel = useMemo(
    () => pickBadgeEffectiveModel(effectiveModels),
    [effectiveModels],
  );

  const showBadge = Boolean(effectiveModel);
  const isSidebar = variant === "sidebar";
  const btnClass =
    (isSidebar ? "app-left-sidebar-topbar-btn" : "app-topbar-btn") +
    " app-claude-model-topbar-btn" +
    (open ? (isSidebar ? " app-left-sidebar-topbar-btn--active" : " active") : "");

  return (
    <Popover
      trigger="click"
      placement={isSidebar ? "bottomRight" : "rightTop"}
      arrow={!isSidebar}
      open={open}
      onOpenChange={handleOpenChange}
      destroyOnHidden={false}
      getPopupContainer={() => document.body}
      classNames={{ root: "app-claude-model-topbar-popover" }}
      styles={{
        container: { padding: 0 },
        content: { padding: 0 },
      }}
      content={
        panelMounted ? (
          <Suspense
            fallback={
              <div className="app-claude-model-topbar-panel app-claude-model-topbar-panel--loading">
                <Spin />
              </div>
            }
          >
            <ClaudeModelTopbarPanelLazy
              store={store}
              setStore={setStore}
              loading={loading}
              onApplied={() => setOpen(false)}
            />
          </Suspense>
        ) : (
          <div className="app-claude-model-topbar-panel app-claude-model-topbar-panel--loading">
            <Spin />
          </div>
        )
      }
    >
      {isSidebar ? (
        <HoverHint title="模型切换" open={open ? false : undefined}>
          <button
            type="button"
            className={btnClass}
            aria-label="模型切换"
            aria-expanded={open}
          >
            <IconClaudeModel />
            {showBadge ? <span className="app-claude-model-topbar-btn__badge" aria-hidden /> : null}
          </button>
        </HoverHint>
      ) : (
        <HoverHint title="模型切换" open={open ? false : undefined}>
          <button
            type="button"
            className={btnClass}
            aria-label="模型切换"
            aria-expanded={open}
          >
            <IconClaudeModel />
            {showBadge ? <span className="app-claude-model-topbar-btn__badge" aria-hidden /> : null}
          </button>
        </HoverHint>
      )}
    </Popover>
  );
}
