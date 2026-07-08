import type { ClaudeSession, ProjectItem, Repository } from "../../types";
import { HoverHint } from "../shared/HoverHint";
import { Dropdown, message, Popover, Segmented, Spin } from "antd";
import { lazy, Suspense, memo, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useWiseTopbarChromeVisibility } from "../../hooks/useWiseTopbarChromeVisibility";
import { RemoteEntryTopbarStrip } from "../RemoteEntryTopbarStrip";
import { WorkspaceQuickActionsTopbarStrip } from "../WorkspaceQuickActionsTopbarStrip";
import { OpenAppMenu } from "../OpenAppMenu";
import {
  tryOpenWorkspaceInDefaultTerminal,
  tryOpenWorkspaceInDefaultTerminalWithCommand,
} from "../../services/openWorkspaceWithTerminalPreference";
import { openInFinder } from "../../services/repository";
import { FolderOpenOutlined } from "@ant-design/icons";
import { FccTopbarTrigger } from "./FccTopbarTrigger";
import { OpencodeGoProxyTopbarTrigger } from "./OpencodeGoProxyTopbarTrigger";
import { FccTrafficTopbarTrigger } from "./FccTrafficTopbarTrigger";
import { LlmProxyTopbarTrigger } from "./LlmProxyTopbarTrigger";
import { SessionDataLinkTopbarTrigger } from "./SessionDataLinkTopbarTrigger";
import { SessionFeedbackLoopTopbarTrigger } from "./SessionFeedbackLoopTopbarTrigger";
import { ClaudeChatSessionTopbarOverflow } from "./ClaudeChatSessionTopbarOverflow";
import { DEFAULT_OPEN_APP_ID } from "../OpenAppMenu/constants";
import { getOpenAppPreferenceSync, hydrateOpenAppPreference } from "../../services/openAppPreference";
import { useRepositoryRunCommand } from "../../hooks/useRepositoryRunCommand";
import { resolveChatTopbarContext } from "../../utils/workspaceSelectionState";
import type { WorkspaceFocus } from "../../utils/workspaceMode";
import { PANE_COUNT_OPTIONS, isPaneCount, type PaneCount } from "../../constants/mainLayoutWidths";
import { topbarPropsEqual } from "./topbarPropsEqual";
import type { CenterView } from "./ClaudeChat";

const RunCommandPanelLazy = lazy(() =>
  import("../RunCommand").then((module) => ({ default: module.RunCommandPanel })),
);
const ExternalTerminalCommandPopoverLazy = lazy(() =>
  import("./ExternalTerminalCommandPopover").then((module) => ({
    default: module.ExternalTerminalCommandPopover,
  })),
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

// ── Topbar Button ──

interface TopbarBtnProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
}

function TopbarBtn({
  icon,
  label,
  onClick,
  onContextMenu,
  active,
}: TopbarBtnProps) {
  return (
    <button
      className={`app-topbar-btn ${active ? "active" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      type="button"
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
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
  /** 反馈神经网：派至独立 worker 会话（不在主会话执行/展示） */
  onDispatchSessionFeedbackLoop?: (input: {
    anchorSessionId: string;
    prompt: string;
    kind: import("../../utils/sessionFeedbackLoopDispatch").FeedbackLoopDispatchKind;
    cycleIndex?: number;
  }) => void | Promise<void>;
  getClaudeSessions?: () => readonly ClaudeSession[];
  onToggleSidebar?: () => void;
  onToggleTerminal?: () => void;
  onSearch?: () => void;
  collapsed?: boolean;
  /** 文件树侧栏展开时，顶栏已不在窗口左缘，无需再为交通灯预留左边距。 */
  fileTreeRailOpen?: boolean;
  terminalCollapsed?: boolean;
  terminalPanelMounted?: boolean;
  onAutoFixRunError?: (prompt: string) => void | Promise<void>;
  /** 多屏模式屏数 */
  paneCount?: PaneCount;
  /** 多屏切换进行中 */
  paneChangeInFlight?: boolean;
  onChangePaneCount?: (count: PaneCount) => void;
  /** 打开创作台「远程入口」配置页 */
  onOpenRemoteChannels?: () => void;
  /** 中栏「消息/文件」切换器当前视图（有编辑器时显示）。 */
  centerView?: CenterView;
  /** 切换器变化回调。 */
  onCenterViewChange?: (view: CenterView) => void;
  /** 是否显示中栏「消息/文件」切换器（有编辑器且消息列表未隐藏时）。 */
  centerSwitcherVisible?: boolean;
}

/**
 * 多屏下每个 pane 顶栏共享的字段：窗口级回调 + 会话级回调 + 全局状态 + per-pane 搜索入口。
 * per-pane 的 `activeRepository` / `activeSessionRepositoryPath` / `mainSessionForDataLink` /
 * `repositories` / `activeProject` / `activeWorkspaceFocus` 由各 pane 渲染处单独传入
 * （primary 用主会话仓库；extra 用 `resolvedRepo` 与 `paneSession`）。
 *
 * - primary pane：直接展开 shared 字段并补全 per-pane 字段。
 * - extra pane：展开后将窗口级回调（onToggleSidebar / onToggleTerminal / onChangePaneCount /
 *   onOpenRemoteChannels）显式置 undefined。
 */
export type PaneTopbarSharedProps = Omit<
  TopbarProps,
  | "activeRepository"
  | "activeSessionRepositoryPath"
  | "repositories"
  | "activeProject"
  | "activeWorkspaceFocus"
  | "mainSessionForDataLink"
  | "centerView"
  | "onCenterViewChange"
  | "centerSwitcherVisible"
> & {
  /** 按指定仓库路径打开搜索面板（per-pane 搜索按钮，作用于该 pane 仓库）。 */
  onSearchForRepository?: (repositoryPath: string) => void;
};

export const Topbar = memo(function Topbar({
  activeProject,
  activeWorkspaceFocus = "repository",
  activeRepository,
  repositories = [],
  activeSessionRepositoryPath,
  mainSessionForDataLink = null,
  onSessionInsightsAiAnalysis,
  onDispatchSessionFeedbackLoop,
  getClaudeSessions,
  onToggleSidebar,
  onToggleTerminal,
  onSearch,
  collapsed,
  fileTreeRailOpen = false,
  terminalCollapsed,
  terminalPanelMounted = false,
  onAutoFixRunError,
  paneCount = 1,
  paneChangeInFlight = false,
  onChangePaneCount,
  onOpenRemoteChannels,
  centerView = "messages",
  onCenterViewChange,
  centerSwitcherVisible = false,
}: TopbarProps) {
  const topbarChrome = useWiseTopbarChromeVisibility();
  const [selectedOpenAppId, setSelectedOpenAppId] = useState<string>(() => {
    return getOpenAppPreferenceSync() || DEFAULT_OPEN_APP_ID;
  });
  const [runPopoverOpen, setRunPopoverOpen] = useState(false);
  const [externalTerminalPopoverOpen, setExternalTerminalPopoverOpen] = useState(false);

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
  const showRepoTitle = Boolean(topbarLabel) && topbarChrome.showTopbarRepositoryName;
  const topbarLeftClassName = [
    "app-chat-topbar-left",
    collapsed ? "app-chat-topbar-left--collapsed" : "",
    collapsed && fileTreeRailOpen ? "app-chat-topbar-left--file-tree-rail" : "",
    showRepoTitle ? "" : "app-chat-topbar-left--no-repo-title",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="app-chat-topbar">
      <div
        className={`app-chat-topbar-leading${collapsed ? " app-chat-topbar-leading--collapsed" : ""}`}
      >
        <div className="app-chat-topbar-drag-underlay" data-tauri-drag-region aria-hidden />
        <div className={topbarLeftClassName}>
          <div className="app-chat-topbar-leading-cluster">
            {onToggleSidebar ? (
              <TopbarBtn
                icon={<IconCollapseSidebar collapsed={collapsed ?? false} />}
                label={collapsed ? "展开侧边栏" : "收起侧边栏"}
                onClick={onToggleSidebar}
              />
            ) : null}
            {centerSwitcherVisible && onCenterViewChange ? (
              <Segmented
                className="app-topbar-center-switcher"
                size="small"
                value={centerView}
                onChange={(value) => onCenterViewChange(value as CenterView)}
                options={[
                  { label: "消息", value: "messages" },
                  { label: "文件", value: "files" },
                ]}
              />
            ) : null}
            {showRepoTitle ? (
              <>
                <div className="app-topbar-divider" />
                <HoverHint title="点击复制绝对路径">
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
                </HoverHint>
              </>
            ) : null}
            {topbarLabel && topbarChrome.showRemoteEntryTopbar ? (
              <RemoteEntryTopbarStrip onOpenRemoteChannels={onOpenRemoteChannels} />
            ) : null}
            <WorkspaceQuickActionsTopbarStrip
              projectId={activeProject?.id ?? null}
              repositoryId={activeRepository?.id ?? null}
            />
          </div>
        </div>
      </div>
      <div className="app-chat-topbar-right">
        {topbarToolsReady && topbarChrome.showTopbarOpenDirectory ? (
          <HoverHint title="在 Finder 中打开目录">
            <button
              type="button"
              className="app-topbar-btn"
              aria-label="在 Finder 中打开目录"
              onClick={() => {
                if (topbarOpenPath) {
                  void openInFinder(topbarOpenPath).catch((err: unknown) => {
                    message.error(err instanceof Error ? err.message : "打开目录失败");
                  });
                }
              }}
            >
              <FolderOpenOutlined />
            </button>
          </HoverHint>
        ) : null}
        {topbarToolsReady && topbarChrome.showTopbarOpenInTerminal ? (
          <Popover
            trigger={[]}
            placement="bottomRight"
            open={externalTerminalPopoverOpen}
            onOpenChange={setExternalTerminalPopoverOpen}
            classNames={{ root: "app-run-command-popover" }}
            content={
              <Suspense fallback={<Spin size="small" />}>
                <ExternalTerminalCommandPopoverLazy
                  workspacePath={topbarOpenPath}
                  initialCommand={repositoryRunCommand.terminalRunCommand}
                  detectedCommand={repositoryRunCommand.detectedProfile?.runCommand ?? null}
                  onSave={(value) => {
                    // 外部终端运行指令独立存储（terminalRunKey），与「运行」按钮的
                    // runCommand 互不影响。直接写 localStorage + 同步 React 状态：
                    // 不调任何会弹 message 的 helper，避免与 popover 自己弹的
                    // 「已保存运行指令」双弹提示。
                    if (repositoryRunCommand.terminalRunKey) {
                      window.localStorage.setItem(repositoryRunCommand.terminalRunKey, value);
                    }
                    repositoryRunCommand.setTerminalRunCommand(value);
                  }}
                  onClear={() => {
                    repositoryRunCommand.setTerminalRunCommand("");
                    if (repositoryRunCommand.terminalRunKey) {
                      window.localStorage.removeItem(repositoryRunCommand.terminalRunKey);
                    }
                  }}
                  onClose={() => setExternalTerminalPopoverOpen(false)}
                />
              </Suspense>
            }
          >
            <HoverHint
              title={
                !topbarOpenPath
                  ? "当前会话未绑定仓库路径，无法打开外部终端"
                  : repositoryRunCommand.terminalRunCommand.trim()
                    ? `在外部终端打开并执行：${repositoryRunCommand.terminalRunCommand
                        .trim()
                        .slice(0, 40)}${repositoryRunCommand.terminalRunCommand.trim().length > 40 ? "…" : ""}（右键配置）`
                    : "在外部终端打开（右键配置运行指令）"
              }
              open={externalTerminalPopoverOpen ? false : undefined}
            >
              <button
                type="button"
                className="app-topbar-btn"
                aria-label="在外部终端打开"
                disabled={!topbarOpenPath}
                onClick={() => {
                  if (!topbarOpenPath) return;
                  const cmd = repositoryRunCommand.terminalRunCommand.trim();
                  const handler = cmd
                    ? tryOpenWorkspaceInDefaultTerminalWithCommand
                    : tryOpenWorkspaceInDefaultTerminal;
                  void handler(topbarOpenPath, cmd).then((result) => {
                    if (!result.ok) message.warning(result.message);
                  });
                }}
                onContextMenu={(event) => {
                  if (!topbarOpenPath) return;
                  event.preventDefault();
                  setExternalTerminalPopoverOpen(true);
                }}
              >
                <IconTerminal />
              </button>
            </HoverHint>
          </Popover>
        ) : null}
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
        {topbarToolsReady && topbarChrome.showOpencodeProxyTopbar ? (
          <OpencodeGoProxyTopbarTrigger />
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
        {topbarToolsReady && topbarChrome.showSessionFeedbackLoopTopbar ? (
          <SessionFeedbackLoopTopbarTrigger
            mainSession={mainSessionForDataLink}
            onDispatchSessionFeedbackLoop={onDispatchSessionFeedbackLoop}
            getClaudeSessions={getClaudeSessions}
          />
        ) : null}
        {onSearch && (
          <TopbarBtn
            icon={<IconSearch />}
            label="搜索：⌘F 文件名 · ⌘⇧F/⌘J 文件内容 · ⌘K 切换"
            onClick={onSearch}
          />
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
          <HoverHint
            title={
              !topbarOpenPath
                ? "当前会话未绑定仓库路径，无法运行"
                : repositoryRunCommand.runStatus === "running" ||
                    repositoryRunCommand.runStatus === "stopping"
                  ? "点击停止（右键配置指令）"
                  : "点击运行（右键配置指令）"
            }
            open={runPopoverOpen ? false : undefined}
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
          </HoverHint>
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
              disabled={paneChangeInFlight}
              title={
                paneChangeInFlight
                  ? "正在切换多屏布局…"
                  : paneCount > 1
                    ? `${paneCount}屏模式（⌥K 切换）`
                    : "多屏：打开多个隔离并行窗格（快捷键 ⌥K）"
              }
            >
              {paneChangeInFlight ? <Spin size="small" /> : <IconDualPane />}
            </button>
          </Dropdown>
        )}
        {onToggleTerminal && (
          <TopbarBtn
            icon={<IconTerminal />}
            label="内置终端 (⌃`)"
            active={terminalPanelMounted && !terminalCollapsed}
            onClick={onToggleTerminal}
          />
        )}
        <div className="app-topbar-divider" />
        {topbarToolsReady ? (
          <ClaudeChatSessionTopbarOverflow
            repositoryPath={topbarOpenPath}
            mainSessionForDataLink={mainSessionForDataLink}
            onSessionInsightsAiAnalysis={onSessionInsightsAiAnalysis}
            onDispatchSessionFeedbackLoop={onDispatchSessionFeedbackLoop}
            getClaudeSessions={getClaudeSessions}
          />
        ) : null}
      </div>
    </div>
  );
}, topbarPropsEqual);
