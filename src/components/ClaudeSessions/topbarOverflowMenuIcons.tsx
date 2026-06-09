import type { ReactNode } from "react";
import { IconSessionDataLink } from "./SessionDataLinkTopbarTrigger";

export type SessionTopbarOverflowPanel =
  | "fcc"
  | "fccTraffic"
  | "opencodeProxy"
  | "llmProxy"
  | "sessionDataLink";

function TopbarMenuIconSvg({ children }: { children: ReactNode }) {
  return (
    <span className="app-topbar-overflow-menu-icon" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        {children}
      </svg>
    </span>
  );
}

function IconFccProxyMenu() {
  return (
    <TopbarMenuIconSvg>
      <path
        d="M12 3 4 8v8l8 5 8-5V8l-8-5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M12 12 4 8M12 12l8-4M12 12v8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </TopbarMenuIconSvg>
  );
}

function IconFccTrafficMenu() {
  return (
    <TopbarMenuIconSvg>
      <path d="M5 7h14M5 12h10M5 17h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="19" cy="7" r="1.75" fill="currentColor" />
      <circle cx="17" cy="12" r="1.75" fill="currentColor" />
      <circle cx="19" cy="17" r="1.75" fill="currentColor" />
    </TopbarMenuIconSvg>
  );
}

function IconOpencodeProxyMenu() {
  return (
    <TopbarMenuIconSvg>
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.75" />
      <path d="M9 12h6M12 9v6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </TopbarMenuIconSvg>
  );
}

function IconLlmProxyMenu() {
  return (
    <TopbarMenuIconSvg>
      <path d="M4 8h6M14 8h6M4 16h6M14 16h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 8v8M14 8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="7" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="16" r="2" stroke="currentColor" strokeWidth="1.5" />
    </TopbarMenuIconSvg>
  );
}

function IconSessionDataLinkMenu() {
  return (
    <span className="app-topbar-overflow-menu-icon" aria-hidden>
      <IconSessionDataLink />
    </span>
  );
}

const OVERFLOW_MENU_ICONS: Record<SessionTopbarOverflowPanel, ReactNode> = {
  fcc: <IconFccProxyMenu />,
  fccTraffic: <IconFccTrafficMenu />,
  opencodeProxy: <IconOpencodeProxyMenu />,
  llmProxy: <IconLlmProxyMenu />,
  sessionDataLink: <IconSessionDataLinkMenu />,
};

export function topbarOverflowMenuIcon(panel: SessionTopbarOverflowPanel): ReactNode {
  return OVERFLOW_MENU_ICONS[panel];
}
