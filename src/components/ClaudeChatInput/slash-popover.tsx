import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Spin } from "antd";
import { listClaudeProjectSkills } from "../../services/claude";
import { searchRepositoryFiles } from "../../services/repositoryFiles";
import type { ClaudeProjectSkill } from "../../types";
import type { RepositoryMentionOption } from "../../utils/projectRoleTagOptions";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import type { AtMentionDefaultTarget } from "../../constants/atMentionDefault";
import {
  atMentionDefaultTargetFromSlashOption,
  DEFAULT_AT_MENTION_DEFAULT_TARGET,
  encodeAtMentionDefaultSelectValue,
  isSlashOptionAtMentionDefault,
} from "../../constants/atMentionDefault";
import { listExecutionEnvironmentEngineMentionOptions } from "../../utils/executionEnvironmentDispatch";
import { resolveAtMentionSelectedIndex } from "../../utils/atMentionDefaultSelection";
import type { TriggerInfo } from "./slash-trigger";
import { CLAUDE_BUILTIN_SLASH_COMMANDS } from "../../constants/claudeCodeSlashCommands";
import {
  ensureSpaceAfterAtInsert,
  insertPlainAt,
  removeAtTriggerFromPlain,
  replaceSlashCommandLine,
} from "./composer-plain-utils";
import { computeSlashPopoverPlacement } from "./composer-trigger-anchor";
import { ExplorerTreeFileIcon } from "../GitPanel/explorerTreeChrome";

export interface SlashOption {
  type: "agent" | "team" | "file" | "command" | "execution_engine";
  label: string;
  description?: string;
  path?: string;
  name?: string;
  workflowId?: string;
  group?: "omc" | "claude" | "skill";
  executionEngine?: SessionExecutionEngine;
  executionEngineAvailable?: boolean;
}

/** 与 Semi AIChatInput 搭配：用纯文本 + 光标操作 @ / 补全，不再依赖 contentEditable DOM。 */
export interface ComposerPlainSurface {
  anchorEl: () => HTMLElement | null;
  /** 渲染弹出框时刷新 @ / 触发字符的视口锚点 */
  resolveTriggerAnchorRect?: () => DOMRect | null;
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
  /** wise_trellis 项目下注入的角色标签选项；当前 @ 面板暂不展示。 */
  projectRoleTagOptions?: ReadonlyArray<unknown>;
  /** wise_trellis 项目下可 @ 的仓库列表（暂不在 @ 面板展示）。 */
  projectRepositoryMentionOptions?: ReadonlyArray<RepositoryMentionOption>;
  /** 当 wise_trellis 项目隐藏员工 UI 时，把 @-mode 的员工行一并去除。 */
  hideEmployeesInAtMode?: boolean;
  codexAvailable?: boolean;
  cursorAvailable?: boolean;
  /** @ 空查询打开时默认高亮项（配置中心可改）。 */
  atMentionDefaultTarget?: AtMentionDefaultTarget;
  /** 在菜单内将执行环境 / 终端设为 @ 默认。 */
  onAtMentionDefaultTargetChange?: (target: AtMentionDefaultTarget) => void | Promise<void>;
}

const CLAUDE_BUILTIN_COMMANDS: SlashOption[] = CLAUDE_BUILTIN_SLASH_COMMANDS.map((cmd) => ({
  type: "command",
  group: "claude",
  label: cmd.label,
  description: cmd.description,
}));

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

/** 项目技能；与内置 / 指令去重（按 label 不区分大小写） */
function buildSkillSlashOptionsFromList(project: ClaudeProjectSkill[]): SlashOption[] {
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
      aria-label="终端"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function slashOptionsFingerprint(options: readonly SlashOption[]): string {
  return options
    .map((o) =>
      [o.type, o.label, o.path ?? "", o.name ?? "", o.executionEngine ?? "", o.workflowId ?? ""].join(
        ":",
      ),
    )
    .join("\n");
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
      aria-label="工作流"
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
  projectRoleTagOptions: _projectRoleTagOptions = [],
  projectRepositoryMentionOptions: _projectRepositoryMentionOptions = [],
  hideEmployeesInAtMode = false,
  codexAvailable = true,
  cursorAvailable = true,
  atMentionDefaultTarget = DEFAULT_AT_MENTION_DEFAULT_TARGET,
  onAtMentionDefaultTargetChange,
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
        const proj = await listClaudeProjectSkills(repositoryPath.trim());
        if (cancelled) return;
        setSkillSlashOptions(buildSkillSlashOptionsFromList(proj));
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

  const employeeOptionsKey = useMemo(
    () => employeeOptions.map((e) => `${e.id}:${e.name}`).join("\n"),
    [employeeOptions],
  );
  const teamOptionsKey = useMemo(
    () => teamOptions.map((t) => `${t.id}:${t.name}`).join("\n"),
    [teamOptions],
  );
  const fileResultsKey = useMemo(
    () => fileResults.map((f) => `${f.path ?? ""}:${f.label}`).join("\n"),
    [fileResults],
  );
  const skillSlashOptionsKey = useMemo(
    () => skillSlashOptions.map((s) => s.label).join("\n"),
    [skillSlashOptions],
  );
  const atMentionDefaultTargetKey = encodeAtMentionDefaultSelectValue(atMentionDefaultTarget);

  const options = useMemo(
    () =>
      getFilteredOptions(
        mode,
        query,
        fileResults,
        employeeOptions,
        teamOptions,
        skillSlashOptions,
        hideEmployeesInAtMode,
        codexAvailable,
        cursorAvailable,
      ),
    [
      mode,
      query,
      fileResults,
      fileResultsKey,
      employeeOptions,
      employeeOptionsKey,
      teamOptions,
      teamOptionsKey,
      skillSlashOptions,
      skillSlashOptionsKey,
      hideEmployeesInAtMode,
      codexAvailable,
      cursorAvailable,
    ],
  );
  const optionsFingerprint = useMemo(() => slashOptionsFingerprint(options), [options]);

  const targetSelectedIndex = useMemo(() => {
    if (mode === "at" && query.trim().length === 0) {
      return resolveAtMentionSelectedIndex(options, atMentionDefaultTarget);
    }
    return 0;
  }, [mode, query, options, atMentionDefaultTargetKey, atMentionDefaultTarget]);

  useEffect(() => {
    setSelectedIndex((prev) => (prev === targetSelectedIndex ? prev : targetSelectedIndex));
  }, [targetSelectedIndex]);

  const handleSelect = useCallback(
    (option: SlashOption) => {
      const surface = surfaceRef.current;
      if (!surface || !mode) return;

      let plain = surface.getPlain();
      let cursor = surface.getCursor();

      if (mode === "at") {
        if (option.type === "execution_engine" && option.executionEngineAvailable === false) {
          return;
        }
        ({ plain, cursor } = removeAtTriggerFromPlain(plain, cursor, query));
        if (option.type === "file" && option.path) {
          ({ plain, cursor } = insertPlainAt(plain, cursor, `@${option.path}`));
        } else if (option.type === "agent" && option.name) {
          ({ plain, cursor } = insertPlainAt(plain, cursor, `@${option.name}`));
        } else if (option.type === "team" && option.name) {
          ({ plain, cursor } = insertPlainAt(plain, cursor, `@${option.name}`));
        } else if (option.type === "execution_engine" && option.name) {
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

  const handleSetAtMentionDefault = useCallback(
    (option: SlashOption) => {
      const next = atMentionDefaultTargetFromSlashOption(option);
      if (!next || !onAtMentionDefaultTargetChange) return;
      if (isSlashOptionAtMentionDefault(option, atMentionDefaultTarget)) return;
      void onAtMentionDefaultTargetChange(next);
    },
    [atMentionDefaultTarget, onAtMentionDefaultTargetChange],
  );

  useEffect(() => {
    if (!mode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const root = surfaceRef.current?.anchorEl?.();
      const target = e.target as Node | null;
      if (!root || !target || !root.contains(target)) return;

      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (options.length > 0) {
          handleSelect(options[selectedIndex]);
        }
        return;
      }

      if (options.length === 0) return;

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
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        handleSelect(options[selectedIndex]);
      }
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [mode, options, optionsFingerprint, selectedIndex, handleSelect, onDismiss, surfaceRef]);

  if (!mode) return null;

  const positionRoot = surfaceRef.current?.anchorEl();
  const caretRect =
    surfaceRef.current?.resolveTriggerAnchorRect?.() ?? trigger.rect ?? null;
  const placement =
    positionRoot && caretRect
      ? computeSlashPopoverPlacement(positionRoot, caretRect)
      : null;
  if (!placement) return null;

  const popoverBaseStyle: React.CSSProperties = {
    position: "absolute",
    left: `${placement.left}px`,
    bottom: `${placement.bottom}px`,
    zIndex: 1000,
    width: "480px",
  };

  if (mode === "at" && fileLoading && options.length === 0) {
    return (
      <div
        className="app-claude-slash-popover"
        style={{
          ...popoverBaseStyle,
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
        ...popoverBaseStyle,
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
        options.map((opt, i) => {
          const showExecutionEngineTitle =
            opt.type === "execution_engine" &&
            (i === 0 || options[i - 1]?.type !== "execution_engine");
          const showEmployeeTitle =
            opt.type === "agent" &&
            (i === 0 || options[i - 1]?.type !== "execution_engine") &&
            options[i - 1]?.type !== "agent";
          return (
            <div key={`${opt.type}-${opt.group ?? ""}-${opt.label}-${opt.path ?? ""}-${opt.workflowId ?? ""}`}>
              {showExecutionEngineTitle ? (
                <div className="app-claude-slash-popover-group-title">执行环境</div>
              ) : null}
              {showEmployeeTitle ? (
                <div className="app-claude-slash-popover-group-title">终端</div>
              ) : null}
              <div
                className={`app-claude-slash-popover-item-wrap${
                  i === selectedIndex ? " app-claude-slash-popover-item-wrap--active" : ""
                }`}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div
                  className={`app-claude-slash-popover-item${
                    i === selectedIndex ? " app-claude-slash-popover-item--active" : ""
                  }${
                    opt.type === "execution_engine" && opt.executionEngineAvailable === false
                      ? " app-claude-slash-popover-item--disabled"
                      : ""
                  }`}
                  onClick={() => {
                    if (opt.type === "execution_engine" && opt.executionEngineAvailable === false) return;
                    handleSelect(opt);
                  }}
                  style={{ gap: 0, padding: "3px 4px" }}
                >
                  {renderOptionContent(
                    opt,
                    isSlashOptionAtMentionDefault(opt, atMentionDefaultTarget),
                  )}
                </div>
                {atMentionDefaultTargetFromSlashOption(opt) && onAtMentionDefaultTargetChange ? (
                  <button
                    type="button"
                    className={`app-claude-slash-popover-item__default-btn${
                      isSlashOptionAtMentionDefault(opt, atMentionDefaultTarget)
                        ? " app-claude-slash-popover-item__default-btn--current"
                        : ""
                    }`}
                    title={
                      isSlashOptionAtMentionDefault(opt, atMentionDefaultTarget)
                        ? "已是 @ 打开时的默认选中项"
                        : "设为 @ 打开时的默认选中项"
                    }
                    aria-label={
                      isSlashOptionAtMentionDefault(opt, atMentionDefaultTarget)
                        ? "已是默认"
                        : "设为默认"
                    }
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSetAtMentionDefault(opt);
                    }}
                  >
                    {isSlashOptionAtMentionDefault(opt, atMentionDefaultTarget) ? "默认" : "设为默认"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function renderOptionContent(opt: SlashOption, isAtMentionDefault = false) {
  return (
    <>
      {opt.type !== "file" && (
        <span style={{ fontSize: "14px", flexShrink: 0, marginRight: "8px", display: "flex", alignItems: "center" }}>
          {opt.type === "execution_engine" ? (
            <ExecutionEngineMentionIcon engine={opt.executionEngine ?? "claude"} />
          ) : opt.type === "agent" ? (
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
        <ExplorerTreeFileIcon
          fileName={opt.label || opt.path?.split("/").pop() || "file"}
          className="app-claude-slash-popover__file-icon"
        />
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
        {(opt.type === "command" || opt.type === "execution_engine") && opt.description && (
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
            {isAtMentionDefault ? " (默认)" : ""}
          </span>
        )}
        {opt.type === "agent" && isAtMentionDefault ? (
          <span className="app-claude-slash-popover-item__default-badge">默认</span>
        ) : null}
        {opt.type === "agent" && (
          <span className="app-claude-slash-popover__kind" title="终端">
            <MentionKindEmployeeIcon />
          </span>
        )}
        {opt.type === "team" && (
          <span className="app-claude-slash-popover__kind" title="工作流">
            <MentionKindTeamIcon />
          </span>
        )}
      </span>
    </>
  );
}

function ExecutionEngineMentionIcon({ engine }: { engine: SessionExecutionEngine }) {
  if (engine === "claude") {
    return (
      <svg
        className="app-claude-slash-popover__kind-svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: "block" }}
        aria-hidden
      >
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  if (engine === "codex") {
    return (
      <svg
        className="app-claude-slash-popover__kind-svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: "block" }}
        aria-hidden
      >
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    );
  }
  return (
    <svg
      className="app-claude-slash-popover__kind-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
      aria-hidden
    >
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12l8-4.5" />
      <path d="M12 12v9" />
      <path d="M12 12L4 7.5" />
    </svg>
  );
}

function getFilteredOptions(
  mode: "at" | "slash" | null,
  query: string,
  fileResults: SlashOption[],
  employeeOptions: Array<{ id: string; name: string }>,
  teamOptions: Array<{ id: string; name: string }>,
  skillSlashOptions: SlashOption[],
  hideEmployeesInAtMode = false,
  codexAvailable = true,
  cursorAvailable = true,
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

  const teams: SlashOption[] = teamOptions.map((team) => ({
    type: "team" as const,
    label: team.name,
    name: team.name,
    workflowId: team.id,
  }));

  const executionEngines: SlashOption[] = listExecutionEnvironmentEngineMentionOptions({
    codexAvailable,
    cursorAvailable,
  }).map((row) => ({
    type: "execution_engine" as const,
    label: row.title,
    name: row.mentionName,
    description: row.description,
    executionEngine: row.engine,
    executionEngineAvailable: row.available,
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
    ...executionEngines.filter(
      (row) =>
        !q ||
        row.label.toLowerCase().includes(q) ||
        (row.name ?? "").toLowerCase().includes(q) ||
        (row.description ?? "").toLowerCase().includes(q) ||
        "执行环境".includes(q) ||
        "派发".includes(q),
    ),
    ...agents.filter((a) => !q || a.label.toLowerCase().includes(q)),
    ...teams.filter((t) => !q || t.label.toLowerCase().includes(q)),
    ...fileResults.filter((f) => !q || f.label.toLowerCase().includes(q) || (f.description ?? "").toLowerCase().includes(q)),
  ];

  return filtered.slice(0, 20);
}
