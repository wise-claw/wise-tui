import type { ClaudeSession, ProjectItem, Repository } from "../../types";
import { Dropdown, message, Popover, Spin, Switch, Tooltip, type TooltipProps } from "antd";
import { lazy, Suspense, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useWiseTopbarChromeVisibility } from "../../hooks/useWiseTopbarChromeVisibility";
import { DingTalkStreamGatewayTopbarSwitch } from "../DingTalkStreamGatewayTopbarSwitch";
import { OpenAppMenu } from "../OpenAppMenu";
import { FccTopbarTrigger } from "./FccTopbarTrigger";
import { FccTrafficTopbarTrigger } from "./FccTrafficTopbarTrigger";
import { LlmProxyTopbarTrigger } from "./LlmProxyTopbarTrigger";
import { SessionDataLinkTopbarTrigger } from "./SessionDataLinkTopbarTrigger";
import { ClaudeChatSessionTopbarOverflow } from "./ClaudeChatSessionTopbarOverflow";
import { DEFAULT_OPEN_APP_ID } from "../OpenAppMenu/constants";
import { getOpenAppPreferenceSync, hydrateOpenAppPreference } from "../../services/openAppPreference";
import { useRepositoryRunCommand } from "../../hooks/useRepositoryRunCommand";
import { resolveChatTopbarContext } from "../../utils/workspaceSelectionState";
import { RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK } from "../../utils/rightPanelStorage";
import type { WorkspaceFocus } from "../../utils/workspaceMode";
import { PANE_COUNT_OPTIONS, isPaneCount, type PaneCount } from "../../constants/mainLayoutWidths";

const RunCommandPanelLazy = lazy(() =>
  import("../RunCommand").then((module) => ({ default: module.RunCommandPanel })),
);

// ── SVG Icons ──

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="11" cy="11" r="7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <polygon
        points="6 4 19 12 6 20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.05"
      />
    </svg>
  );
}

function IconStop() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect
        x="5"
        y="5"
        width="14"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.05"
      />
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 9l3 3-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="15" x2="16" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconDualPane() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="3" y="3" width="8" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="13" y="3" width="8" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCollapseSidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 3v18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {collapsed ? (
        <path d="M13 9l3 3-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M16 15l-3-3 3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function IconRightPanel({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 3v18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {collapsed ? (
        <path d="M11 15l-3-3 3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M8 9l3 3-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

// ── Topbar Button ──

interface TopbarBtnProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  tooltipPlacement?: TooltipProps["placement"];
}

function TopbarBtn({
  icon,
  label,
  onClick,
  onContextMenu,
  active,
  tooltipPlacement = "bottom",
}: TopbarBtnProps) {
  return (
    <Tooltip
      title={label}
      mouseEnterDelay={0.3}
      placement={tooltipPlacement}
      getPopupContainer={() => document.body}
    >
      <button
        className={`app-topbar-btn ${active ? "active" : ""}`}
        onClick={onClick}
        onContextMenu={onContextMenu}
        type="button"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

// ── Topbar ──

export interface TopbarProps {
  activeProject?: ProjectItem | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  activeRepository?: Repository;
  repositories?: Repository[];
  activeSessionRepositoryPath?: string;
  /** 当前项目/仓库主会话；全链路分析固定分析此会话，非活动标签 */
  mainSessionForDataLink?: ClaudeSession | null;
  /** 全链路洞察 AI 深度解读：向主会话发送分析 prompt */
  onSessionInsightsAiAnalysis?: (prompt: string) => void | Promise<void>;
  onToggleSidebar?: () => void;
  onToggleRightPanel?: () => void;
  rightPanelDefaultCollapsed?: boolean;
  onSetRightPanelDefaultCollapsed?: (collapsed: boolean) => void;
  onToggleTerminal?: () => void;
  onSearch?: () => void;
  collapsed?: boolean;
  rightCollapsed?: boolean;
  terminalCollapsed?: boolean;
  onAutoFixRunError?: (prompt: string) => void | Promise<void>;
  /** 多屏模式屏数 */
  paneCount?: PaneCount;
  onChangePaneCount?: (count: PaneCount) => void;
}

export function Topbar({
  activeProject,
  activeWorkspaceFocus = "repository",
  activeRepository,
  repositories = [],
  activeSessionRepositoryPath,
  mainSessionForDataLink = null,
  onSessionInsightsAiAnalysis,
  onToggleSidebar,
  onToggleRightPanel,
  rightPanelDefaultCollapsed = RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
  onSetRightPanelDefaultCollapsed,
  onToggleTerminal,
  onSearch,
  collapsed,
  rightCollapsed,
  terminalCollapsed,
  onAutoFixRunError,
  paneCount = 1,
  onChangePaneCount,
}: TopbarProps) {
  const topbarChrome = useWiseTopbarChromeVisibility();
  const [selectedOpenAppId, setSelectedOpenAppId] = useState<string>(() => {
    return getOpenAppPreferenceSync() || DEFAULT_OPEN_APP_ID;
  });
  const [runPopoverOpen, setRunPopoverOpen] = useState(false);
  const [rightPanelDefaultPopoverOpen, setRightPanelDefaultPopoverOpen] = useState(false);
  const [rightPanelDefaultDraftCollapsed, setRightPanelDefaultDraftCollapsed] = useState(
    rightPanelDefaultCollapsed ?? RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
  );

  const topbarContext = useMemo(
    () =>
      resolveChatTopbarContext({
        activeRepository,
        activeProject,
        activeWorkspaceFocus,
        repositories,
        sessionRepositoryPath: activeSessionRepositoryPath,
      }),
    [
      activeRepository,
      activeProject,
      activeWorkspaceFocus,
      repositories,
      activeSessionRepositoryPath,
    ],
  );
  const { contextRepository, openPath: topbarOpenPath } = topbarContext;
  const topbarToolsReady = topbarOpenPath.length > 0;

  const repositoryRunCommand = useRepositoryRunCommand({
    repository: contextRepository,
    runCwd: topbarOpenPath,
    onAutoFixRunError,
    onRequestOpenPanel: () => setRunPopoverOpen(true),
    onRunStarted: () => setRunPopoverOpen(false),
  });

  useEffect(() => {
    void (async () => {
      await hydrateOpenAppPreference();
      setSelectedOpenAppId(getOpenAppPreferenceSync() || DEFAULT_OPEN_APP_ID);
    })();
  }, []);

  const topbarShowsProject = activeWorkspaceFocus === "project" && activeProject != null;
  const topbarLabel = topbarShowsProject ? activeProject.name : activeRepository?.name;
  const topbarPath = topbarShowsProject
    ? (activeProject.rootPath?.trim() || activeRepository?.path?.trim() || "")
    : (activeRepository?.path?.trim() || "");

  return (
    <div className="app-chat-topbar">
      <div className="app-chat-topbar-drag-region" data-tauri-drag-region>
        <div className={`app-chat-topbar-left ${collapsed ? "app-chat-topbar-left--collapsed" : ""}`}>
          {onToggleSidebar && (
            <TopbarBtn
              icon={<IconCollapseSidebar collapsed={collapsed ?? false} />}
              label={collapsed ? "展开侧边栏" : "收起侧边栏"}
              onClick={onToggleSidebar}
            />
          )}
          {topbarLabel ? (
            <>
              <div className="app-topbar-divider" />
              <Tooltip title="点击复制绝对路径" mouseEnterDelay={0.3}>
                <button
                  type="button"
                  className="app-topbar-repository-trigger"
                  onClick={() => {
                    const path = topbarPath;
                    if (!path) {
                      message.warning(topbarShowsProject ? "暂无 Workspace 路径" : "暂无仓库路径");
                      return;
                    }
                    void navigator.clipboard.writeText(path).then(
                      () => {
                        message.success("已复制绝对路径");
                      },
                      () => {
                        message.error("复制失败");
                      },
                    );
                  }}
                >
                  <span className="app-topbar-repository-trigger-label">{topbarLabel}</span>
                </button>
              </Tooltip>
              <DingTalkStreamGatewayTopbarSwitch />
            </>
          ) : null}
        </div>
      </div>
      <div className="app-chat-topbar-right">
        {topbarToolsReady ? (
          <OpenAppMenu
            path={topbarOpenPath}
            selectedOpenAppId={selectedOpenAppId}
            onSelectOpenAppId={setSelectedOpenAppId}
          />
        ) : null}
        {topbarToolsReady && topbarChrome.showFccTopbar ? <FccTopbarTrigger /> : null}
        {topbarToolsReady && topbarChrome.showFccTrafficTopbar ? (
          <FccTrafficTopbarTrigger />
        ) : null}
        {topbarToolsReady && topbarChrome.showLlmProxyTopbar ? (
          <LlmProxyTopbarTrigger repositoryPath={topbarOpenPath} />
        ) : null}
        {topbarToolsReady && topbarChrome.showSessionDataLinkTopbar ? (
          <SessionDataLinkTopbarTrigger
            mainSession={mainSessionForDataLink}
            onRequestAiAnalysis={onSessionInsightsAiAnalysis}
          />
        ) : null}
        {onSearch && (
          <TopbarBtn icon={<IconSearch />} label="搜索文件 (Cmd+K)" onClick={onSearch} />
        )}
        <Popover
          trigger={[]}
          placement="bottomRight"
          open={runPopoverOpen}
          onOpenChange={setRunPopoverOpen}
          classNames={{ root: "app-run-command-popover" }}
          content={
            <Suspense fallback={<Spin size="small" />}>
              <RunCommandPanelLazy
                {...repositoryRunCommand}
                onClose={() => setRunPopoverOpen(false)}
              />
            </Suspense>
          }
        >
          <Tooltip
            title={
              !topbarOpenPath
                ? "当前会话未绑定仓库路径，无法运行"
                : repositoryRunCommand.runStatus === "running" ||
                    repositoryRunCommand.runStatus === "stopping"
                  ? "点击停止（右键配置指令）"
                  : "点击运行（右键配置指令）"
            }
            mouseEnterDelay={0.3}
          >
            <span className="app-topbar-run-trigger-wrap">
              <button
                type="button"
                className={`app-topbar-btn app-topbar-btn--run ${repositoryRunCommand.runStatus === "running" || repositoryRunCommand.runStatus === "stopping" ? "active" : ""}`}
                onClick={repositoryRunCommand.handleRunButtonClick}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setRunPopoverOpen(true);
                }}
                disabled={!topbarOpenPath}
                aria-label={
                  repositoryRunCommand.runStatus === "running" ||
                  repositoryRunCommand.runStatus === "stopping"
                    ? "停止命令"
                    : "运行命令"
                }
              >
                {repositoryRunCommand.runStatus === "running" ||
                repositoryRunCommand.runStatus === "stopping" ? (
                  <IconStop />
                ) : (
                  <IconPlay />
                )}
              </button>
            </span>
          </Tooltip>
        </Popover>
        {onChangePaneCount && (
          <Dropdown
            menu={{
              selectedKeys: [String(paneCount)],
              items: PANE_COUNT_OPTIONS.map((count) => ({
                key: String(count),
                label: count === 1 ? "1屏（关闭多屏）" : `${count}屏`,
              })),
              onClick: ({ key }) => {
                const count = Number(key);
                if (!isPaneCount(count)) return;
                onChangePaneCount(count);
              },
            }}
            trigger={["click"]}
          >
            <button
              className={`app-topbar-btn ${paneCount > 1 ? "active" : ""}`}
              type="button"
              title={
                paneCount > 1
                  ? `${paneCount}屏模式（⌥K 切换）`
                  : "多屏：打开多个隔离并行窗格（快捷键 ⌥K）"
              }
            >
              <IconDualPane />
            </button>
          </Dropdown>
        )}
        {onToggleTerminal && (
          <TopbarBtn icon={<IconTerminal />} label="终端" active={!terminalCollapsed} onClick={onToggleTerminal} />
        )}
        <div className="app-topbar-divider" />
        {topbarToolsReady ? (
          <ClaudeChatSessionTopbarOverflow
            repositoryPath={topbarOpenPath}
            mainSessionForDataLink={mainSessionForDataLink}
            onSessionInsightsAiAnalysis={onSessionInsightsAiAnalysis}
          />
        ) : null}
        {onToggleRightPanel && (
          <Popover
            trigger={[]}
            open={rightPanelDefaultPopoverOpen}
            onOpenChange={(open) => {
              setRightPanelDefaultPopoverOpen(open);
              if (open) {
                setRightPanelDefaultDraftCollapsed(rightPanelDefaultCollapsed);
              }
            }}
            placement="bottomRight"
            classNames={{ root: "app-topbar-right-panel-default-popover" }}
            content={
              onSetRightPanelDefaultCollapsed ? (
                <div
                  className="app-topbar-right-panel-default-popover__content"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="app-topbar-right-panel-default-popover__row">
                    <span className="app-topbar-right-panel-default-popover__label">启动默认收起</span>
                    <Switch
                      size="small"
                      checked={rightPanelDefaultDraftCollapsed}
                      onChange={setRightPanelDefaultDraftCollapsed}
                    />
                  </div>
                  <footer className="app-topbar-right-panel-default-popover__footer">
                    <button
                      type="button"
                      className="app-topbar-right-panel-default-popover__btn app-topbar-right-panel-default-popover__btn--ghost"
                      onClick={() => setRightPanelDefaultPopoverOpen(false)}
                    >
                      关闭
                    </button>
                    <button
                      type="button"
                      className="app-topbar-right-panel-default-popover__btn app-topbar-right-panel-default-popover__btn--primary"
                      onClick={() => {
                        onSetRightPanelDefaultCollapsed(rightPanelDefaultDraftCollapsed);
                        setRightPanelDefaultPopoverOpen(false);
                      }}
                    >
                      确认
                    </button>
                  </footer>
                </div>
              ) : null
            }
          >
            <span className="app-topbar-right-panel-trigger-wrap">
              <TopbarBtn
                icon={<IconRightPanel collapsed={rightCollapsed ?? false} />}
                label={
                  rightCollapsed
                    ? "展开右侧面板（右键设默认）"
                    : "收起右侧面板（右键设默认）"
                }
                onClick={onToggleRightPanel}
                onContextMenu={
                  onSetRightPanelDefaultCollapsed
                    ? (event) => {
                        event.preventDefault();
                        setRightPanelDefaultDraftCollapsed(rightPanelDefaultCollapsed);
                        setRightPanelDefaultPopoverOpen(true);
                      }
                    : undefined
                }
                tooltipPlacement="bottomRight"
              />
            </span>
          </Popover>
        )}
      </div>
    </div>
  );
}
