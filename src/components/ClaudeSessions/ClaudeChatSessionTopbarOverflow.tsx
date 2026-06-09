import { Dropdown, type MenuProps } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { memo, useCallback, useMemo, useState } from "react";
import type { ClaudeSession } from "../../types";
import { useWiseTopbarChromeVisibility } from "../../hooks/useWiseTopbarChromeVisibility";
import { FccTopbarTrigger } from "./FccTopbarTrigger";
import { FccTrafficTopbarTrigger } from "./FccTrafficTopbarTrigger";
import { OpencodeGoProxyTopbarTrigger } from "./OpencodeGoProxyTopbarTrigger";
import { LlmProxyTopbarTrigger } from "./LlmProxyTopbarTrigger";
import { SessionDataLinkTopbarTrigger } from "./SessionDataLinkTopbarTrigger";
import { topbarOverflowMenuIcon, type SessionTopbarOverflowPanel } from "./topbarOverflowMenuIcons";

export type { SessionTopbarOverflowPanel };

function IconMoreGrid() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.25" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.25" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.25" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.25" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export interface ClaudeChatSessionTopbarOverflowProps {
  /** 与主会话顶栏 OpenApp / LLM 代理一致的仓库目录 */
  repositoryPath: string;
  mainSessionForDataLink: ClaudeSession | null;
  onSessionInsightsAiAnalysis?: (prompt: string) => void | Promise<void>;
}

export const ClaudeChatSessionTopbarOverflow = memo(function ClaudeChatSessionTopbarOverflow({
  repositoryPath,
  mainSessionForDataLink,
  onSessionInsightsAiAnalysis,
}: ClaudeChatSessionTopbarOverflowProps) {
  const topbarChrome = useWiseTopbarChromeVisibility();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<SessionTopbarOverflowPanel | null>(null);

  const overflowItems = useMemo(() => {
    const items: Array<{ key: SessionTopbarOverflowPanel; label: string; disabled?: boolean }> = [];
    if (!topbarChrome.showFccTopbar) {
      items.push({ key: "fcc", label: "Free Claude Code" });
    }
    if (!topbarChrome.showFccTrafficTopbar) {
      items.push({ key: "fccTraffic", label: "FCC 请求流量" });
    }
    if (!topbarChrome.showOpencodeProxyTopbar) {
      items.push({ key: "opencodeProxy", label: "OpenCode 代理" });
    }
    if (!topbarChrome.showLlmProxyTopbar) {
      items.push({ key: "llmProxy", label: "LLM 代理" });
    }
    if (!topbarChrome.showSessionDataLinkTopbar) {
      items.push({
        key: "sessionDataLink",
        label: "全链路分析",
        disabled: !mainSessionForDataLink,
      });
    }
    return items;
  }, [topbarChrome, mainSessionForDataLink]);

  const handlePanelOpenChange = useCallback((panel: SessionTopbarOverflowPanel, open: boolean) => {
    setActivePanel(open ? panel : null);
  }, []);

  const menuItems = useMemo((): MenuProps["items"] => {
    return overflowItems.map((item) => ({
      key: item.key,
      icon: topbarOverflowMenuIcon(item.key),
      label: <span className="app-topbar-overflow-menu-label">{item.label}</span>,
      disabled: item.disabled,
    }));
  }, [overflowItems]);

  if (!repositoryPath.trim() || overflowItems.length === 0) {
    return null;
  }

  return (
    <div className="app-topbar-overflow">
      <Dropdown
        menu={{
          items: menuItems,
          className: "app-topbar-overflow-menu-inner",
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            setMenuOpen(false);
            const panel = key as SessionTopbarOverflowPanel;
            if (panel === "sessionDataLink" && !mainSessionForDataLink) return;
            setActivePanel(panel);
          },
        }}
        trigger={["click"]}
        placement="bottomRight"
        open={menuOpen}
        onOpenChange={setMenuOpen}
        classNames={{ root: "app-topbar-overflow-dropdown" }}
      >
        <HoverHint title="更多：默认配置中隐藏的顶栏工具" open={menuOpen ? false : undefined} getPopupContainer={() => document.body}>
          <button
            type="button"
            className={`app-topbar-btn app-topbar-overflow-btn${menuOpen ? " active" : ""}`}
            aria-haspopup="menu"
            aria-label="更多顶栏工具"
            aria-expanded={menuOpen}
          >
            <IconMoreGrid />
          </button>
        </HoverHint>
      </Dropdown>

      {!topbarChrome.showFccTopbar && activePanel === "fcc" ? (
        <FccTopbarTrigger
          triggerHidden
          open
          onOpenChange={(open) => handlePanelOpenChange("fcc", open)}
        />
      ) : null}
      {!topbarChrome.showFccTrafficTopbar && activePanel === "fccTraffic" ? (
        <FccTrafficTopbarTrigger
          triggerHidden
          open
          onOpenChange={(open) => handlePanelOpenChange("fccTraffic", open)}
        />
      ) : null}
      {!topbarChrome.showOpencodeProxyTopbar && activePanel === "opencodeProxy" ? (
        <OpencodeGoProxyTopbarTrigger
          triggerHidden
          open
          onOpenChange={(open) => handlePanelOpenChange("opencodeProxy", open)}
        />
      ) : null}
      {!topbarChrome.showLlmProxyTopbar && activePanel === "llmProxy" ? (
        <LlmProxyTopbarTrigger
          repositoryPath={repositoryPath}
          triggerHidden
          open
          onOpenChange={(open) => handlePanelOpenChange("llmProxy", open)}
        />
      ) : null}
      {!topbarChrome.showSessionDataLinkTopbar && activePanel === "sessionDataLink" ? (
        <SessionDataLinkTopbarTrigger
          mainSession={mainSessionForDataLink}
          onRequestAiAnalysis={onSessionInsightsAiAnalysis}
          triggerHidden
          open
          onOpenChange={(open) => handlePanelOpenChange("sessionDataLink", open)}
        />
      ) : null}
    </div>
  );
});
