import {
  DeploymentUnitOutlined,
  FolderOpenOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Empty, Input, Space, Tabs } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeMcpConfigPanelHandle } from "../ClaudeMcpConfigPanel";
import type { ProjectSkillsPanelHandle } from "./ProjectSkillsPanel";
import type { ClaudeHooksConfigPanelHandle } from "../ClaudeHooksConfigPanel";
import type { SubagentsPanelHandle } from "./SubagentsPanel";
import { openExternalUrl } from "../../services/openExternal";
import {
  getClaudeHooksStatus,
  getClaudeMcpStatus,
  isOmcPluginInstalled,
  listClaudePluginCacheSkills,
  listClaudeProjectSkills,
  listClaudeSubagents,
  listClaudeUserSkills,
} from "../../services/claude";
import { useOmcPluginInstalled } from "../../hooks/useOmcPluginInstalled";
import {
  countHooksInScope,
  filterOmcFromMcpStatus,
  isOmcPluginCacheSkill,
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
}

export function ClaudeCodeToolsPanel({
  repositoryPath,
  sectionCollapsed = false,
  onSectionCollapsedChange,
  variant = "inspector",
  surfaceActive = true,
  onOpenAuthorConfig,
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
  });
  const mcpPanelRef = useRef<ClaudeMcpConfigPanelHandle>(null);
  const skillsPanelRef = useRef<ProjectSkillsPanelHandle>(null);
  const hooksPanelRef = useRef<ClaudeHooksConfigPanelHandle>(null);
  const subagentsPanelRef = useRef<SubagentsPanelHandle>(null);
  const { omcInstalled } = useOmcPluginInstalled(true);

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

  useEffect(() => {
    if (!panelActive) return;
    let cancelled = false;
    async function preloadTabCounts() {
      const [omcRes, mcpRes, hooksRes, subagentsRes, skillsRes, userSkillsRes, cacheSkillsRes] =
        await Promise.allSettled([
        isOmcPluginInstalled(),
        getClaudeMcpStatus(repositoryPath ?? null),
        getClaudeHooksStatus(repositoryPath ?? null),
        listClaudeSubagents(repositoryPath ?? null),
        repositoryPath ? listClaudeProjectSkills(repositoryPath) : Promise.resolve([]),
        listClaudeUserSkills(),
        listClaudePluginCacheSkills(),
      ]);
      if (cancelled) return;
      const showOmc = omcRes.status === "fulfilled" && omcRes.value;
      setTabCounts((prev) => {
        const next = { ...prev };
        if (mcpRes.status === "fulfilled") {
          const mcp = showOmc ? mcpRes.value : filterOmcFromMcpStatus(mcpRes.value);
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
            countHooksInScope(hooksRes.value.local.hooks) +
            (showOmc ? countHooksInScope(hooksRes.value.omc.hooks) : 0);
        }
        if (subagentsRes.status === "fulfilled") {
          next.subagents = showOmc
            ? subagentsRes.value.length
            : subagentsRes.value.filter((item) => !isOmcSubagentItem(item)).length;
        }
        if (
          skillsRes.status === "fulfilled" ||
          userSkillsRes.status === "fulfilled" ||
          cacheSkillsRes.status === "fulfilled"
        ) {
          const projectList = skillsRes.status === "fulfilled" ? skillsRes.value : [];
          const userList = userSkillsRes.status === "fulfilled" ? userSkillsRes.value : [];
          const seen = new Set(projectList.map((s) => s.name.toLowerCase()));
          const userOnly = userList.filter((s) => !seen.has(s.name.toLowerCase()));
          const cacheList = cacheSkillsRes.status === "fulfilled" ? cacheSkillsRes.value : [];
          const nCache = showOmc ? cacheList.length : cacheList.filter((s) => !isOmcPluginCacheSkill(s)).length;
          next.skill = projectList.length + userOnly.length + nCache;
        }
        return next;
      });
    }
    void preloadTabCounts();
    return () => {
      cancelled = true;
    };
  }, [repositoryPath, omcInstalled, panelActive]);

  function withCountLabel(label: string, count: number): string {
    return `${label}·${count}`;
  }
  const tabOptions = [
    { key: "mcp", label: withCountLabel("MCP", tabCounts.mcp) },
    { key: "skill", label: withCountLabel("技能", tabCounts.skill) },
    { key: "hooks", label: withCountLabel("Hooks", tabCounts.hooks) },
    { key: "subagents", label: withCountLabel("子代理", tabCounts.subagents) },
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
    ) : null;
  const guideUrl =
    tab === "subagents"
      ? "https://code.claude.com/docs/zh-CN/sub-agents"
      : tab === "skill"
      ? "https://code.claude.com/docs/zh-CN/skills"
      : tab === "hooks"
        ? "https://code.claude.com/docs/zh-CN/hooks"
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
                      omcInstalled={omcInstalled ?? false}
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
                {repositoryPath ? (
                  loadedTabs.has("skill") ? (
                    <Suspense fallback={<Empty description="加载中..." image={Empty.PRESENTED_IMAGE_SIMPLE} />}>
                      <ProjectSkillsPanel
                        repositoryPath={repositoryPath}
                        active={panelActive && tab === "skill"}
                        omcInstalled={omcInstalled ?? false}
                        listSearch={listSearch}
                        onCountChange={handleSkillsCountChange}
                        onBindActions={(actions) => {
                          skillsPanelRef.current = actions;
                        }}
                      />
                    </Suspense>
                  ) : null
                ) : (
                  <Empty description="请选择仓库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
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
                      omcInstalled={omcInstalled ?? false}
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
                    omcInstalled={omcInstalled ?? false}
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
        ]}
      />
    </div>
  );
}
