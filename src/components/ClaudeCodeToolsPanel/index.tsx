import {
  CloseOutlined,
  DeploymentUnitOutlined,
  FolderOpenOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Empty, Input, Space, Tabs, message } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeMcpConfigPanelHandle } from "../ClaudeMcpConfigPanel";
import type { ProjectSkillsPanelHandle } from "./ProjectSkillsPanel";
import type { ClaudeHooksConfigPanelHandle } from "../ClaudeHooksConfigPanel";
import type { SubagentsPanelHandle } from "./SubagentsPanel";
import type { ClaudePluginsPanelHandle } from "./ClaudePluginsPanel";
import { openExternalUrl } from "../../services/openExternal";
import { openClaudeUserSettingsJsonInIde } from "../../services/claudeConfigDir";
import { OPEN_WORKSPACE_ERROR } from "../../services/openWorkspaceWithPreference";
import {
  getClaudeHooksStatus,
  getClaudeMcpStatus,
  listClaudeProjectSkills,
  listClaudeSubagents,
  listClaudeUserSkills,
} from "../../services/claude";
import { claudePluginListInstalled } from "../../services/claudePluginMarket";
import {
  countHooksInScope,
  filterOmcFromMcpStatus,
  isOmcSubagentItem,
} from "../../utils/omcPluginDetect";
import { claudeCodeToolsTabToAuthorPane } from "../../utils/claudeCodeToolsAuthorPane";
import type { AuthorPane } from "../../types/viewMode";
import "./index.css";

const ClaudeMcpConfigPanel = lazy(() =>
  import("../ClaudeMcpConfigPanel").then((module) => ({ default: module.ClaudeMcpConfigPanel })),
);
const ProjectSkillsPanel = lazy(() =>
  import("./ProjectSkillsPanel").then((module) => ({ default: module.ProjectSkillsPanel })),
);
const ClaudeHooksConfigPanel = lazy(() =>
  import("../ClaudeHooksConfigPanel").then((module) => ({ default: module.ClaudeHooksConfigPanel })),
);
const SubagentsPanel = lazy(() => import("./SubagentsPanel").then((module) => ({ default: module.SubagentsPanel })));
const ClaudePluginsPanel = lazy(() =>
  import("./ClaudePluginsPanel").then((module) => ({ default: module.ClaudePluginsPanel })),
);

// ── Main ──

interface Props {
  repositoryPath?: string;
  /** 收起后仅保留标题栏，Git 区域占满右栏剩余高度（仅 inspector 嵌入） */
  sectionCollapsed?: boolean;
  onSectionCollapsedChange?: (collapsed: boolean) => void;
  /** `popover`：顶栏弹层；`inspector`：右栏嵌入（已弃用，保留兼容） */
  variant?: "inspector" | "popover";
  /** 弹层关闭时为 false，避免后台刷新 MCP/技能等 */
  surfaceActive?: boolean;
  /** 跳转到工作台配置中与本 Tab 对应的页面 */
  onOpenAuthorConfig?: (pane: AuthorPane) => void;
  /** 弹层模式下的关闭回调 */
  onClose?: () => void;
}

export function ClaudeCodeToolsPanel({
  repositoryPath,
  sectionCollapsed = false,
  onSectionCollapsedChange,
  variant = "inspector",
  surfaceActive = true,
  onOpenAuthorConfig,
  onClose,
}: Props) {
  const isPopover = variant === "popover";
  const panelActive = surfaceActive;
  const [tab, setTab] = useState("mcp");
  const [listSearch, setListSearch] = useState("");
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(() => new Set(["mcp"]));
  const [tabCounts, setTabCounts] = useState({
    mcp: 0,
    skill: 0,
    hooks: 0,
    subagents: 0,
    plugins: 0,
  });
  const mcpPanelRef = useRef<ClaudeMcpConfigPanelHandle>(null);
  const skillsPanelRef = useRef<ProjectSkillsPanelHandle>(null);
  const hooksPanelRef = useRef<ClaudeHooksConfigPanelHandle>(null);
  const subagentsPanelRef = useRef<SubagentsPanelHandle>(null);
  const pluginsPanelRef = useRef<ClaudePluginsPanelHandle>(null);
  const [pluginsRefreshing, setPluginsRefreshing] = useState(false);

  const handleSubagentsCountChange = useCallback((count: number) => {
    setTabCounts((prev) => (prev.subagents === count ? prev : { ...prev, subagents: count }));
  }, []);

  const handleSkillsCountChange = useCallback((count: number) => {
    setTabCounts((prev) => (prev.skill === count ? prev : { ...prev, skill: count }));
  }, []);

  const handleMcpCountChange = useCallback((count: number) => {
    setTabCounts((prev) => (prev.mcp === count ? prev : { ...prev, mcp: count }));
  }, []);

  const handleHooksCountChange = useCallback((count: number) => {
    setTabCounts((prev) => (prev.hooks === count ? prev : { ...prev, hooks: count }));
  }, []);

  const handlePluginsCountChange = useCallback((count: number) => {
    setTabCounts((prev) => (prev.plugins === count ? prev : { ...prev, plugins: count }));
  }, []);

  const handlePluginsRefresh = useCallback(async () => {
    if (pluginsRefreshing) return;
    if (pluginsPanelRef.current) {
      setPluginsRefreshing(true);
      try {
        await pluginsPanelRef.current.refresh();
      } finally {
        setPluginsRefreshing(false);
      }
      return;
    }
    setPluginsRefreshing(true);
    try {
      const rows = await claudePluginListInstalled(repositoryPath);
      handlePluginsCountChange(rows.length);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPluginsRefreshing(false);
    }
  }, [handlePluginsCountChange, pluginsRefreshing, repositoryPath]);

  useEffect(() => {
    if (!panelActive) return;
    let cancelled = false;
    async function preloadTabCounts() {
      const [mcpRes, hooksRes, subagentsRes, skillsRes, userSkillsRes, pluginsRes] =
        await Promise.allSettled([
        getClaudeMcpStatus(repositoryPath ?? null),
        getClaudeHooksStatus(repositoryPath ?? null),
        listClaudeSubagents(repositoryPath ?? null),
        repositoryPath ? listClaudeProjectSkills(repositoryPath) : Promise.resolve([]),
        listClaudeUserSkills(),
        claudePluginListInstalled(repositoryPath),
      ]);
      if (cancelled) return;
      setTabCounts((prev) => {
        const next = { ...prev };
        if (mcpRes.status === "fulfilled") {
          const mcp = filterOmcFromMcpStatus(mcpRes.value);
          next.mcp =
            mcp.user.length +
            mcp.local.length +
            mcp.projectShared.length +
            mcp.legacyUserSettings.length +
            mcp.legacyProjectSettings.length +
            mcp.pluginMcp.length;
        }
        if (hooksRes.status === "fulfilled") {
          next.hooks =
            countHooksInScope(hooksRes.value.user.hooks) +
            countHooksInScope(hooksRes.value.project.hooks) +
            countHooksInScope(hooksRes.value.local.hooks);
        }
        if (subagentsRes.status === "fulfilled") {
          next.subagents = subagentsRes.value.filter((item) => !isOmcSubagentItem(item)).length;
        }
        if (skillsRes.status === "fulfilled" || userSkillsRes.status === "fulfilled") {
          const projectList = skillsRes.status === "fulfilled" ? skillsRes.value : [];
          const userList = userSkillsRes.status === "fulfilled" ? userSkillsRes.value : [];
          const seen = new Set(projectList.map((s) => s.name.toLowerCase()));
          const userOnly = userList.filter((s) => !seen.has(s.name.toLowerCase()));
          next.skill = projectList.length + userOnly.length;
        }
        if (pluginsRes.status === "fulfilled") {
          next.plugins = pluginsRes.value.length;
        }
        return next;
      });
    }
    void preloadTabCounts();
    return () => {
      cancelled = true;
    };
  }, [repositoryPath, panelActive]);

  function withCountLabel(label: string, count: number): string {
    return `${label}·${count}`;
  }
  const tabOptions = [
    { key: "mcp", label: withCountLabel("MCP", tabCounts.mcp) },
    { key: "skill", label: withCountLabel("技能", tabCounts.skill) },
    { key: "hooks", label: withCountLabel("Hooks", tabCounts.hooks) },
    { key: "subagents", label: withCountLabel("子代理", tabCounts.subagents) },
    { key: "plugins", label: withCountLabel("插件", tabCounts.plugins) },
  ] as const;
  const actions =
    tab === "subagents" ? (
      <Space size={4}>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<PlusOutlined />}
          onClick={() => subagentsPanelRef.current?.openCreateModal()}
        >
          新建
        </Button>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<ReloadOutlined />}
          onClick={() => void subagentsPanelRef.current?.refresh()}
        >
          刷新
        </Button>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<FolderOpenOutlined />}
          onClick={() => void subagentsPanelRef.current?.openAgentsRoot()}
        >
          打开目录
        </Button>
      </Space>
    ) : tab === "mcp" ? (
      <Space size={4}>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<ReloadOutlined />}
          onClick={() => void mcpPanelRef.current?.refreshMcp()}
        >
          刷新
        </Button>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<PlusOutlined />}
          onClick={() => mcpPanelRef.current?.openAddModal()}
        >
          添加
        </Button>
      </Space>
    ) : tab === "skill" ? (
      <Space size={4}>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<PlusOutlined />}
          onClick={() => skillsPanelRef.current?.openCreateModal()}
        >
          新建
        </Button>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<ReloadOutlined />}
          onClick={() => void skillsPanelRef.current?.refresh()}
        >
          刷新
        </Button>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<FolderOpenOutlined />}
          onClick={() => void skillsPanelRef.current?.openSkillsRoot()}
        >
          打开目录
        </Button>
      </Space>
    ) : tab === "hooks" ? (
      <Space size={4}>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<ReloadOutlined />}
          onClick={() => void hooksPanelRef.current?.refresh()}
        >
          刷新
        </Button>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<PlusOutlined />}
          onClick={() => hooksPanelRef.current?.openCreateModal()}
        >
          新增
        </Button>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<DeploymentUnitOutlined />}
          onClick={() => {
            window.dispatchEvent(new CustomEvent("wise:open-hooks-flow"));
          }}
        >
          Hooks 流程
        </Button>
      </Space>
    ) : tab === "plugins" ? (
      <Space size={4}>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<ReloadOutlined />}
          loading={pluginsRefreshing}
          onClick={() => void handlePluginsRefresh()}
        >
          刷新
        </Button>
        <Button
          type="text"
          size="small"
          className="app-tab-extra-mcp-btn"
          icon={<PlusOutlined />}
          onClick={() => pluginsPanelRef.current?.openAddModal()}
        >
          添加
        </Button>
      </Space>
    ) : null;
  const guideUrl =
    tab === "subagents"
      ? "https://code.claude.com/docs/zh-CN/sub-agents"
      : tab === "skill"
      ? "https://code.claude.com/docs/zh-CN/skills"
      : tab === "hooks"
        ? "https://code.claude.com/docs/zh-CN/hooks"
        : tab === "plugins"
          ? "https://code.claude.com/docs/zh-CN/plugins"
          : "https://code.claude.com/docs/zh-CN/mcp";
  const activateTab = useCallback((nextTab: string) => {
    setTab(nextTab);
    setListSearch("");
    setLoadedTabs((prev) => {
      if (prev.has(nextTab)) return prev;
      const next = new Set(prev);
      next.add(nextTab);
      return next;
    });
  }, []);

  const handleOpenGlobalConfig = useCallback(() => {
    void openClaudeUserSettingsJsonInIde().catch((err: unknown) => {
      const code = err instanceof Error ? err.message : "";
      if (code === OPEN_WORKSPACE_ERROR.NOT_CONFIGURED) {
        message.warning("未配置可用的编辑器或命令，请在中栏顶部「打开方式」中选择");
      } else if (code === OPEN_WORKSPACE_ERROR.NO_TARGET) {
        message.warning("未找到可用的打开方式");
      } else {
        message.error(typeof err === "string" ? err : "打开全局配置失败");
        console.error(err);
      }
    });
  }, []);

  if (!isPopover && sectionCollapsed) {
    return (
      <div className="app-claude-code-tools app-claude-code-tools--collapsed-single-btn">
        <HoverHint
          title={
            onSectionCollapsedChange
              ? "展开 Claude Code 工具（MCP、技能、Hooks、子代理）"
              : undefined
          }
        >
          <Button
            type="default"
            size="small"
            block
            disabled={!onSectionCollapsedChange}
            className="app-claude-code-tools-expand-btn"
            icon={<MenuUnfoldOutlined />}
            onClick={() => onSectionCollapsedChange?.(false)}
          >
            Claude Code
          </Button>
        </HoverHint>
      </div>
    );
  }

  return (
    <div
      className={
        "app-claude-code-tools" + (isPopover ? " app-claude-code-tools--popover" : "")
      }
    >
      <div className="app-claude-code-tools-head">
        <div className="app-claude-code-tools-head-left">
          {onSectionCollapsedChange ? (
            <HoverHint title={sectionCollapsed ? "点击展开" : "点击收起"}>
              <button
                type="button"
                className="app-claude-code-tools-title-trigger"
                aria-expanded={!sectionCollapsed}
                onClick={() => onSectionCollapsedChange(!sectionCollapsed)}
              >
                <span className="app-claude-code-tools-title">Claude Code</span>
              </button>
            </HoverHint>
          ) : (
            <span className="app-claude-code-tools-title">Claude Code</span>
          )}
          <HoverHint title="在默认 IDE 中打开全局配置（~/.claude/settings.json）">
            <Button
              type="text"
              size="small"
              className="app-claude-code-tools-global-config-btn"
              icon={<SettingOutlined />}
              aria-label="打开全局配置"
              onClick={handleOpenGlobalConfig}
            />
          </HoverHint>
        </div>
        <div className="app-claude-code-tools-head-right">
          <Space size={0} className="app-claude-code-tools-tab-switch">
            {tabOptions.map((option) => (
              <Button
                key={option.key}
                type={tab === option.key ? "primary" : "text"}
                size="small"
                className="app-claude-code-tools-tab-btn"
                onClick={() => activateTab(option.key)}
              >
                {option.label}
              </Button>
            ))}
          </Space>
          {isPopover && onClose ? (
            <HoverHint title="关闭">
              <Button
                type="text"
                size="small"
                className="app-claude-code-tools-close-btn"
                icon={<CloseOutlined />}
                aria-label="关闭"
                onClick={onClose}
              />
            </HoverHint>
          ) : null}
        </div>
      </div>

      <div className="app-claude-code-tools-toolbar">
        <div className="app-claude-code-tools-toolbar-left">
          {onOpenAuthorConfig && claudeCodeToolsTabToAuthorPane(tab) ? (
            <Button
              type="link"
              size="small"
              className="app-claude-code-tools-config-btn"
              onClick={() => {
                const pane = claudeCodeToolsTabToAuthorPane(tab);
                if (pane) onOpenAuthorConfig(pane);
              }}
            >
              配置
            </Button>
          ) : null}
          <Button
            type="link"
            size="small"
            className="app-claude-code-tools-guide-btn"
            onClick={() => {
              void openExternalUrl(guideUrl);
            }}
          >
            使用指南
          </Button>
          <div className="app-claude-code-tools-list-search-wrap">
            <Input
              size="small"
              placeholder="筛选…"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="app-claude-code-tools-toolbar-actions">{actions}</div>
      </div>
      <Tabs
        size="small"
        activeKey={tab}
        onChange={activateTab}
        className="app-claude-code-tools-tabs"
        renderTabBar={() => <></>}
        items={[
          {
            key: "subagents",
            label: "Subagents",
            children: (
              <div className="app-claude-code-tools-scroll">
                {loadedTabs.has("subagents") ? (
                  <Suspense fallback={<Empty description="加载中..." image={Empty.PRESENTED_IMAGE_SIMPLE} />}>
                    <SubagentsPanel
                      repositoryPath={repositoryPath}
                      active={panelActive && tab === "subagents"}
                      listSearch={listSearch}
                      onCountChange={handleSubagentsCountChange}
                      onBindActions={(actions) => {
                        subagentsPanelRef.current = actions;
                      }}
                    />
                  </Suspense>
                ) : null}
              </div>
            ),
          },
          {
            key: "skill",
            label: "技能",
            children: (
              <div className="app-claude-code-tools-scroll">
                {loadedTabs.has("skill") ? (
                  <Suspense fallback={<Empty description="加载中..." image={Empty.PRESENTED_IMAGE_SIMPLE} />}>
                    <ProjectSkillsPanel
                      repositoryPath={repositoryPath}
                      active={panelActive && tab === "skill"}
                      listSearch={listSearch}
                      onCountChange={handleSkillsCountChange}
                      onBindActions={(actions) => {
                        skillsPanelRef.current = actions;
                      }}
                    />
                  </Suspense>
                ) : null}
              </div>
            ),
          },
          {
            key: "mcp",
            label: "MCP",
            children: (
              <div className="app-claude-code-tools-scroll">
                {loadedTabs.has("mcp") ? (
                  <Suspense fallback={<Empty description="加载中..." image={Empty.PRESENTED_IMAGE_SIMPLE} />}>
                    <ClaudeMcpConfigPanel
                      ref={mcpPanelRef}
                      repositoryPath={repositoryPath}
                      active={panelActive && tab === "mcp"}
                      hideToolbar
                      listSearch={listSearch}
                      onCountChange={handleMcpCountChange}
                    />
                  </Suspense>
                ) : null}
              </div>
            ),
          },
          {
            key: "hooks",
            label: "Hooks",
            children: (
              loadedTabs.has("hooks") ? (
                <Suspense fallback={<Empty description="加载中..." image={Empty.PRESENTED_IMAGE_SIMPLE} />}>
                  <ClaudeHooksConfigPanel
                    repositoryPath={repositoryPath}
                    active={panelActive && tab === "hooks"}
                    listSearch={listSearch}
                    onCountChange={handleHooksCountChange}
                    onBindActions={(actions) => {
                      hooksPanelRef.current = actions;
                    }}
                  />
                </Suspense>
              ) : null
            ),
          },
          {
            key: "plugins",
            label: "插件",
            children: (
              <div className="app-claude-code-tools-scroll">
                {loadedTabs.has("plugins") ? (
                  <Suspense fallback={<Empty description="加载中..." image={Empty.PRESENTED_IMAGE_SIMPLE} />}>
                    <ClaudePluginsPanel
                      ref={pluginsPanelRef}
                      repositoryPath={repositoryPath}
                      active={panelActive && tab === "plugins"}
                      listSearch={listSearch}
                      onCountChange={handlePluginsCountChange}
                    />
                  </Suspense>
                ) : null}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
