import React, { useState, useEffect, useCallback } from "react";
import { Spin } from "antd";
import { listClaudePluginCacheSkills, listClaudeProjectSkills } from "../../services/claude";
import { searchRepositoryFiles } from "../../services/repositoryFiles";
import type { ClaudeProjectSkill } from "../../types";
import type { RoleTagOption, RepositoryMentionOption } from "../../utils/projectRoleTagOptions";
import type { TriggerInfo } from "./slash-trigger";
import {
  ensureSpaceAfterAtInsert,
  insertPlainAt,
  removeAtTriggerFromPlain,
  replaceSlashCommandLine,
} from "./composer-plain-utils";

export interface SlashOption {
  type: "agent" | "team" | "file" | "command" | "roleTag" | "repository";
  label: string;
  description?: string;
  path?: string;
  name?: string;
  workflowId?: string;
  group?: "omc" | "claude" | "skill";
  /** roleTag 类型携带的覆盖仓库数；UI 行尾展示。 */
  repoCount?: number;
  /** roleTag 类型携带的覆盖仓库列表；供 title / 后续扩展使用。 */
  repoNames?: string[];
}

/** 与 Semi AIChatInput 搭配：用纯文本 + 光标操作 @ / 补全，不再依赖 contentEditable DOM。 */
export interface ComposerPlainSurface {
  anchorEl: () => HTMLElement | null;
  getPlain: () => string;
  getCursor: () => number;
  setPlainAndCursor: (plain: string, cursor: number) => void;
  focus: () => void;
}

interface SlashPopoverProps {
  surfaceRef: React.MutableRefObject<ComposerPlainSurface | null>;
  trigger: TriggerInfo;
  onDismiss: () => void;
  onSelect: (option: SlashOption) => void;
  repositoryPath?: string;
  employeeOptions?: Array<{ id: string; name: string }>;
  teamOptions?: Array<{ id: string; name: string }>;
  /** wise_trellis 项目下注入的角色标签选项；其他项目省略。 */
  projectRoleTagOptions?: ReadonlyArray<RoleTagOption>;
  /** wise_trellis 项目下可 @ 的仓库列表。 */
  projectRepositoryMentionOptions?: ReadonlyArray<RepositoryMentionOption>;
  /** 当 wise_trellis 项目隐藏员工 UI 时，把 @-mode 的员工行一并去除。 */
  hideEmployeesInAtMode?: boolean;
}

const CLAUDE_BUILTIN_COMMANDS: SlashOption[] = [
  { type: "command", group: "claude", label: "clear", description: "清空当前对话" },
  { type: "command", group: "claude", label: "compact", description: "压缩上下文释放 tokens" },
  { type: "command", group: "claude", label: "model", description: "切换模型" },
  { type: "command", group: "claude", label: "status", description: "查看会话状态" },
  { type: "command", group: "claude", label: "cost", description: "查看当前会话 token 花费" },
  { type: "command", group: "claude", label: "resume", description: "恢复之前的会话" },
  { type: "command", group: "claude", label: "memory", description: "管理 CLAUDE.md 和自动记忆" },
  { type: "command", group: "claude", label: "init", description: "初始化 CLAUDE.md" },
  { type: "command", group: "claude", label: "help", description: "显示帮助和快捷键" },
  { type: "command", group: "claude", label: "exit", description: "退出 Claude Code" },
  { type: "command", group: "claude", label: "todos", description: "查看/管理可执行任务" },
  { type: "command", group: "claude", label: "history", description: "查看对话历史" },
  { type: "command", group: "claude", label: "stats", description: "查看使用统计" },
  { type: "command", group: "claude", label: "undo", description: "撤销上一步操作" },
  { type: "command", group: "claude", label: "rewind", description: "回退到对话中的某一点" },
  { type: "command", group: "claude", label: "loop", description: "启动自动循环（Claude Code loop）" },
  { type: "command", group: "claude", label: "agents", description: "管理配置的 agent" },
  { type: "command", group: "claude", label: "skills", description: "浏览可用 Skills" },
  { type: "command", group: "claude", label: "hooks", description: "查看/管理 hooks" },
  { type: "command", group: "claude", label: "worktree", description: "Git worktree 管理" },
  { type: "command", group: "claude", label: "branch", description: "创建/切换 git 分支" },
  { type: "command", group: "claude", label: "search", description: "搜索代码库" },
  { type: "command", group: "claude", label: "doctor", description: "检查健康状态并自动修复" },
  { type: "command", group: "claude", label: "copy", description: "复制对话内容" },
  { type: "command", group: "claude", label: "theme", description: "切换颜色主题" },
  { type: "command", group: "claude", label: "effort", description: "调节速度 vs 智能程度" },
  { type: "command", group: "claude", label: "config", description: "打开配置设置" },
  { type: "command", group: "claude", label: "add-dir", description: "添加额外工作目录" },
  { type: "command", group: "claude", label: "rename", description: "重命名当前会话" },
];

const OMC_COMMANDS: SlashOption[] = [
  { type: "command", group: "omc", label: "ask", description: "OMC 多模型咨询路由" },
  { type: "command", group: "omc", label: "autopilot", description: "OMC 自动执行闭环" },
  { type: "command", group: "omc", label: "autoresearch", description: "OMC 持续研究迭代" },
  { type: "command", group: "omc", label: "cancel", description: "取消当前 OMC 模式" },
  { type: "command", group: "omc", label: "ccg", description: "Claude/Codex/Gemini 编排" },
  { type: "command", group: "omc", label: "debug", description: "OMC 会话诊断" },
  { type: "command", group: "omc", label: "deep-dive", description: "链路深挖与访谈" },
  { type: "command", group: "omc", label: "deep-interview", description: "需求深访谈" },
  { type: "command", group: "omc", label: "deepinit", description: "深度初始化项目上下文" },
  { type: "command", group: "omc", label: "doctor", description: "OMC 安装/状态自检" },
  { type: "command", group: "omc", label: "hud", description: "配置 HUD 展示" },
  { type: "command", group: "omc", label: "mcp-setup", description: "配置 MCP 服务" },
  { type: "command", group: "omc", label: "plan", description: "OMC 规划模式" },
  { type: "command", group: "omc", label: "ralph", description: "自循环执行直到完成" },
  { type: "command", group: "omc", label: "ralplan", description: "Ralph 共识规划入口" },
  { type: "command", group: "omc", label: "release", description: "发布流程助手" },
  { type: "command", group: "omc", label: "remember", description: "沉淀可复用知识" },
  { type: "command", group: "omc", label: "team", description: "多 Agent 协作执行" },
  { type: "command", group: "omc", label: "trace", description: "证据驱动追踪分析" },
  { type: "command", group: "omc", label: "ultraqa", description: "高强度 QA 循环" },
  { type: "command", group: "omc", label: "ultrawork", description: "高吞吐并行执行" },
  { type: "command", group: "omc", label: "verify", description: "结果核验与验收" },
  { type: "command", group: "omc", label: "review", description: "代码审查工作流" },
  { type: "command", group: "omc", label: "security-review", description: "安全审查工作流" },
  { type: "command", group: "omc", label: "simplify", description: "代码简化与整洁" },
  { type: "command", group: "omc", label: "update-config", description: "更新 OMC/Claude 配置" },
];

function buildSlashCommandOptions(): SlashOption[] {
  const seen = new Set<string>();
  const merged = [...CLAUDE_BUILTIN_COMMANDS, ...OMC_COMMANDS];
  const result: SlashOption[] = [];
  for (const item of merged) {
    const key = item.label.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

const BUILTIN_COMMANDS = buildSlashCommandOptions();

/** 与 `replaceSlashCommandLine` 中单 token 一致，避免插入非法 `/…` 片段 */
const SLASH_SKILL_NAME_RE = /^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/;

function isSlashableSkillName(name: string): boolean {
  const t = name.trim();
  return t.length > 0 && t.length <= 96 && SLASH_SKILL_NAME_RE.test(t);
}

/** 具备 SKILL.md 或已有文件时，更可能作为 Claude Code 可执行 skill 命令 */
function skillIsInvocableAsSlashCommand(skill: ClaudeProjectSkill): boolean {
  if (!isSlashableSkillName(skill.name)) return false;
  if (skill.hasSkillMd) return true;
  return (skill.fileCount ?? 0) > 0;
}

/** 项目技能优先于插件缓存同名项；与内置 / 指令去重（按 label 不区分大小写） */
function buildSkillSlashOptionsFromLists(
  project: ClaudeProjectSkill[],
  cache: ClaudeProjectSkill[],
): SlashOption[] {
  const reserved = new Set(BUILTIN_COMMANDS.map((c) => c.label.trim().toLowerCase()));
  const byKey = new Map<string, SlashOption>();

  const push = (skill: ClaudeProjectSkill, defaultDescription: string) => {
    if (!skillIsInvocableAsSlashCommand(skill)) return;
    const label = skill.name.trim();
    const k = label.toLowerCase();
    if (reserved.has(k)) return;
    if (byKey.has(k)) return;
    const desc = skill.description?.trim();
    byKey.set(k, {
      type: "command",
      group: "skill",
      label,
      description: desc && desc.length > 0 ? desc : defaultDescription,
    });
  };

  for (const s of project) {
    push(s, "项目技能");
  }
  for (const s of cache) {
    push(s, "插件缓存技能");
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

function MentionKindEmployeeIcon() {
  return (
    <svg
      className="app-claude-slash-popover__kind-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="员工"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function MentionKindTeamIcon() {
  return (
    <svg
      className="app-claude-slash-popover__kind-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="团队"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function SlashPopover({
  surfaceRef,
  trigger,
  onDismiss,
  onSelect,
  repositoryPath,
  employeeOptions = [],
  teamOptions = [],
  projectRoleTagOptions = [],
  projectRepositoryMentionOptions = [],
  hideEmployeesInAtMode = false,
}: SlashPopoverProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileResults, setFileResults] = useState<SlashOption[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [skillSlashOptions, setSkillSlashOptions] = useState<SlashOption[]>([]);

  const mode = trigger.mode;
  const query = trigger.query;

  useEffect(() => {
    if (mode !== "slash" || !repositoryPath?.trim()) {
      setSkillSlashOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [proj, cache] = await Promise.all([
          listClaudeProjectSkills(repositoryPath.trim()),
          listClaudePluginCacheSkills(),
        ]);
        if (cancelled) return;
        setSkillSlashOptions(buildSkillSlashOptionsFromLists(proj, cache));
      } catch {
        if (!cancelled) setSkillSlashOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, repositoryPath]);

  useEffect(() => {
    if (mode !== "at" || !repositoryPath) {
      setFileResults([]);
      return;
    }

    let cancelled = false;
    setFileLoading(true);

    const token = query;
    const delayMs = token.length === 0 ? 0 : 50;

    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        const paths = await searchRepositoryFiles(repositoryPath, token);
        if (cancelled) return;
        setFileResults(
          paths.map((relPath) => ({
            type: "file" as const,
            label: relPath.split("/").pop() || relPath,
            description: relPath,
            path: relPath,
          })),
        );
      } catch {
        if (!cancelled) setFileResults([]);
      } finally {
        if (!cancelled) setFileLoading(false);
      }
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, query, repositoryPath]);

  const options = getFilteredOptions(
    mode,
    query,
    fileResults,
    employeeOptions,
    teamOptions,
    skillSlashOptions,
    projectRoleTagOptions,
    projectRepositoryMentionOptions,
    hideEmployeesInAtMode,
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, mode]);

  const handleSelect = useCallback(
    (option: SlashOption) => {
      const surface = surfaceRef.current;
      if (!surface || !mode) return;
      surface.focus();

      let plain = surface.getPlain();
      let cursor = surface.getCursor();

      if (mode === "at") {
        ({ plain, cursor } = removeAtTriggerFromPlain(plain, cursor, query));
        if (option.type === "file" && option.path) {
          ({ plain, cursor } = insertPlainAt(plain, cursor, `@${option.path}`));
        } else if (option.type === "agent" && option.name) {
          ({ plain, cursor } = insertPlainAt(plain, cursor, `@${option.name}`));
        } else if (option.type === "team" && option.name) {
          ({ plain, cursor } = insertPlainAt(plain, cursor, `@${option.name}`));
        } else if (option.type === "roleTag" && option.name) {
          ({ plain, cursor } = insertPlainAt(plain, cursor, `@${option.name}`));
        } else if (option.type === "repository" && option.name) {
          ({ plain, cursor } = insertPlainAt(plain, cursor, `@${option.name}`));
        }
        ({ plain, cursor } = ensureSpaceAfterAtInsert(plain, cursor));
      } else if (mode === "slash") {
        ({ plain, cursor } = replaceSlashCommandLine(plain, cursor, option.label));
      }

      surface.setPlainAndCursor(plain, cursor);
      onDismiss();
      onSelect(option);
    },
    [mode, query, surfaceRef, onDismiss, onSelect],
  );

  useEffect(() => {
    if (!mode || options.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.min(i + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && !e.shiftKey && options.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        handleSelect(options[selectedIndex]);
      }
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [mode, options, selectedIndex, handleSelect, onDismiss]);

  if (!mode) return null;

  const anchorRect = surfaceRef.current?.anchorEl()?.getBoundingClientRect();
  if (mode === "at" && fileLoading && options.length === 0) {
    if (!anchorRect) return null;
    return (
      <div
        className="app-claude-slash-popover"
        style={{
          position: "fixed",
          bottom: `${window.innerHeight - anchorRect.top + 4}px`,
          left: `${anchorRect.left + 12}px`,
          zIndex: 1000,
          width: "480px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "12px",
        }}
      >
        <Spin size="small" />
      </div>
    );
  }
  if (options.length === 0) return null;

  const left = anchorRect ? anchorRect.left + 12 : 0;

  const groupedCommandOptions =
    mode === "slash"
      ? {
          omc: options.filter((opt) => opt.type === "command" && opt.group === "omc"),
          claude: options.filter((opt) => opt.type === "command" && opt.group === "claude"),
        }
      : null;

  return (
    <div
      className="app-claude-slash-popover"
      style={{
        position: "fixed",
        bottom: anchorRect ? `${window.innerHeight - anchorRect.top + 4}px` : "auto",
        left: `${left}px`,
        zIndex: 1000,
        width: "480px",
        maxHeight: "400px",
        overflowY: "auto",
        background: "var(--ant-color-bg-elevated)",
        border: "1px solid var(--ant-color-border-secondary)",
        borderRadius: "8px",
        boxShadow: "var(--ant-box-shadow-secondary)",
        padding: "4px",
      }}
    >
      {mode === "slash" ? (
        <>
          {groupedCommandOptions?.omc.length ? (
            <div className="app-claude-slash-popover-group-title">oh-my-claudecode</div>
          ) : null}
          {options.map((opt, i) => {
            const showClaudeTitle =
              opt.type === "command" &&
              opt.group === "claude" &&
              i > 0 &&
              options[i - 1]?.type === "command" &&
              options[i - 1]?.group === "omc";
            const showSkillTitle =
              opt.type === "command" &&
              opt.group === "skill" &&
              (i === 0 || options[i - 1]?.group !== "skill");
            return (
              <div key={`${opt.type}-${opt.group ?? ""}-${opt.label}-${opt.path ?? ""}-${opt.workflowId ?? ""}`}>
                {showClaudeTitle ? (
                  <div className="app-claude-slash-popover-group-title">Claude 内置</div>
                ) : null}
                {showSkillTitle ? (
                  <div className="app-claude-slash-popover-group-title">Skills 技能</div>
                ) : null}
                <div
                  className={`app-claude-slash-popover-item ${i === selectedIndex ? "app-claude-slash-popover-item--active" : ""}`}
                  onClick={() => handleSelect(opt)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  style={{ gap: 0, padding: "3px 4px" }}
                >
                  {renderOptionContent(opt)}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        options.map((opt, i) => (
          <div
            key={`${opt.type}-${opt.group ?? ""}-${opt.label}-${opt.path ?? ""}-${opt.workflowId ?? ""}`}
            className={`app-claude-slash-popover-item ${i === selectedIndex ? "app-claude-slash-popover-item--active" : ""}`}
            onClick={() => handleSelect(opt)}
            onMouseEnter={() => setSelectedIndex(i)}
            style={{ gap: 0, padding: "3px 4px" }}
          >
            {renderOptionContent(opt)}
          </div>
        ))
      )}
    </div>
  );
}

function MentionKindRepositoryIcon() {
  return (
    <svg
      className="app-claude-slash-popover__kind-svg"
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="仓库"
    >
      <path d="M3.5 4.5h13v11h-13z" />
      <path d="M3.5 8h13" />
      <path d="M7 4.5V16" />
    </svg>
  );
}

function renderOptionContent(opt: SlashOption) {
  return (
    <>
      {opt.type !== "file" && (
        <span style={{ fontSize: "14px", flexShrink: 0, marginRight: "8px", display: "flex", alignItems: "center" }}>
          {opt.type === "agent" ? (
            // Robot SVG icon
            <svg
              className="app-claude-slash-popover__kind-svg"
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: "block" }}
            >
              <rect x="3.5" y="7" width="13" height="9" rx="3" fill="none" />
              <circle cx="7.5" cy="11.5" r="1" fill="currentColor" />
              <circle cx="12.5" cy="11.5" r="1" fill="currentColor" />
              <path d="M10 3.5v2.5" />
              <circle cx="10" cy="3" r="1.2" fill="none" />
              <path d="M5.5 4 4 7" />
              <path d="M14.5 4l1.5 3" />
            </svg>
          ) : opt.type === "team" ? (
            // Team (People) SVG icon
            <svg
              className="app-claude-slash-popover__kind-svg"
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: "block" }}
            >
              <circle cx="7" cy="8" r="3" />
              <circle cx="13" cy="10" r="3" />
              <path d="M2.5 17c0-2 2.5-3.5 4.5-3.5s4.5 1.5 4.5 3.5" />
              <path d="M16.5 17c0-1.5-1.27-2.73-3-3" />
            </svg>
          ) : opt.type === "roleTag" ? (
            <span
              className="app-claude-slash-popover__roletag-glyph"
              aria-hidden
              style={{
                fontSize: "13px",
                fontWeight: 600,
                lineHeight: 1,
                color: "var(--ant-color-primary)",
                display: "inline-flex",
                width: "16px",
                justifyContent: "center",
              }}
            >
              #
            </span>
          ) : opt.type === "repository" ? (
            <MentionKindRepositoryIcon />
          ) : (
            // Lightning bolt SVG fallback
            <svg
              className="app-claude-slash-popover__kind-svg"
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: "block" }}
            >
              <polyline points="11 1 3 10 10 10 9 19 17 9 10 9 11 1" />
            </svg>
          )}
        </span>
      )}
      {opt.type === "file" && (
        <span
          style={{
            flexShrink: 0,
            marginRight: "8px",
            color: "var(--ant-color-text-tertiary)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </span>
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontWeight: 500,
            fontSize: "13px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: 0,
            maxWidth: "min(220px, 46%)",
          }}
        >
          {opt.label}
        </span>
        {opt.type === "file" && opt.path && opt.path !== "__pick__" && (
          <span
            style={{
              color: "var(--ant-color-text-tertiary)",
              fontSize: "12px",
              marginLeft: "12px",
              flexShrink: 0,
              maxWidth: "300px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {opt.description ?? opt.path}
          </span>
        )}
        {opt.type === "command" && opt.description && (
          <span
            style={{
              color: "var(--ant-color-text-tertiary)",
              fontSize: "12px",
              flex: "1 1 0%",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {opt.description}
          </span>
        )}
        {opt.type === "agent" && (
          <span className="app-claude-slash-popover__kind" title="员工">
            <MentionKindEmployeeIcon />
          </span>
        )}
        {opt.type === "team" && (
          <span className="app-claude-slash-popover__kind" title="团队">
            <MentionKindTeamIcon />
          </span>
        )}
        {opt.type === "roleTag" && (
          <>
            <span
              style={{
                color: "var(--ant-color-text-tertiary)",
                fontSize: "12px",
                marginLeft: "12px",
                flex: "1 1 0%",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {opt.description}
            </span>
            <span
              className="app-claude-slash-popover__kind"
              title={
                opt.repoNames && opt.repoNames.length > 0
                  ? `角色标签：覆盖 ${opt.repoCount ?? 0} 个仓库\n${opt.repoNames.join(", ")}`
                  : `角色标签：覆盖 ${opt.repoCount ?? 0} 个仓库`
              }
              style={{ fontSize: "11px", color: "var(--ant-color-text-tertiary)" }}
            >
              {`· ${opt.repoCount ?? 0} ${opt.repoCount === 1 ? "repo" : "repos"}`}
            </span>
          </>
        )}
        {opt.type === "repository" && opt.description && (
          <span
            style={{
              color: "var(--ant-color-text-tertiary)",
              fontSize: "12px",
              marginLeft: "12px",
              flex: "1 1 0%",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {opt.description}
          </span>
        )}
      </span>
    </>
  );
}

function getFilteredOptions(
  mode: "at" | "slash" | null,
  query: string,
  fileResults: SlashOption[],
  employeeOptions: Array<{ id: string; name: string }>,
  teamOptions: Array<{ id: string; name: string }>,
  skillSlashOptions: SlashOption[],
  projectRoleTagOptions: ReadonlyArray<RoleTagOption> = [],
  projectRepositoryMentionOptions: ReadonlyArray<RepositoryMentionOption> = [],
  hideEmployeesInAtMode = false,
): SlashOption[] {
  if (!mode) return [];

  if (mode === "slash") {
    const q = query.trim().toLowerCase();
    const builtinsFiltered = !q
      ? BUILTIN_COMMANDS
      : BUILTIN_COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
    const skillsFiltered = !q
      ? skillSlashOptions
      : skillSlashOptions.filter(
          (c) =>
            c.label.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q),
        );
    return [...builtinsFiltered, ...skillsFiltered];
  }

  const repositoryRows: SlashOption[] = projectRepositoryMentionOptions.map((repo) => ({
    type: "repository" as const,
    label: repo.label,
    name: repo.mention,
    description: repo.description,
  }));

  const roleTagRows: SlashOption[] = projectRoleTagOptions.map((tag) => ({
    type: "roleTag" as const,
    label: tag.label,
    name: tag.tag,
    description: tag.description,
    repoCount: tag.repoCount,
    repoNames: tag.repoNames,
  }));

  const teams: SlashOption[] = teamOptions.map((team) => ({
    type: "team" as const,
    label: team.name,
    name: team.name,
    workflowId: team.id,
  }));

  const agents: SlashOption[] = hideEmployeesInAtMode
    ? []
    : employeeOptions.map((employee) => ({
        type: "agent" as const,
        label: employee.name,
        name: employee.name,
      }));

  const q = query.toLowerCase();
  const filtered = [
    ...repositoryRows.filter((r) => !q || r.label.toLowerCase().includes(q)),
    ...roleTagRows.filter((r) => !q || r.label.toLowerCase().includes(q)),
    ...agents.filter((a) => !q || a.label.toLowerCase().includes(q)),
    ...teams.filter((t) => !q || t.label.toLowerCase().includes(q)),
    ...fileResults.filter((f) => !q || f.label.toLowerCase().includes(q) || (f.description ?? "").toLowerCase().includes(q)),
  ];

  return filtered.slice(0, 20);
}
