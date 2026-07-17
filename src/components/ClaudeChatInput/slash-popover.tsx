import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Spin } from "antd";
import { searchRepositoryFiles } from "../../services/repositoryFiles";
import { loadSlashCatalog } from "../../services/slashCatalogCache";
import type { RepositoryMentionOption } from "../../utils/projectRoleTagOptions";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import type { AtMentionDefaultTarget } from "../../constants/atMentionDefault";
import {
  atMentionDefaultTargetFromSlashOption,
  DEFAULT_AT_MENTION_DEFAULT_TARGET,
  encodeAtMentionDefaultSelectValue,
  isSlashOptionAtMentionDefault,
} from "../../constants/atMentionDefault";
import { resolveAtMentionSelectedIndex } from "../../utils/atMentionDefaultSelection";
import type { TriggerInfo } from "./slash-trigger";
import { CLAUDE_BUILTIN_SLASH_COMMANDS } from "../../constants/claudeCodeSlashCommands";
import {
  buildSlashOptionSections,
  getFilteredAtOptions,
  getFilteredSlashOptions,
  mapSlashCatalogToOptions,
  OMC_COMMANDS,
  type SlashOption,
} from "../../utils/slashPopoverOptions";
import {
  ensureSpaceAfterAtInsert,
  insertPlainAt,
  removeAtTriggerFromPlain,
  replaceSlashCommandLine,
} from "./composer-plain-utils";
import {
  hasExecutionEnvironmentMention,
  stripExecutionEnvironmentMention,
} from "../../utils/executionEnvironmentDispatch";
import {
  computeSlashPopoverPlacement,
  resolveSlashPopoverOpaqueBackground,
  resolveSlashPopoverPortalRoot,
} from "./composer-trigger-anchor";
import { ExplorerTreeFileIcon, ExplorerTreeFolderIcon } from "../GitPanel/explorerTreeChrome";

export type { SlashOption };

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
  geminiAvailable?: boolean;
  opencodeAvailable?: boolean;
  qoderAvailable?: boolean;
  /** @ 空查询打开时默认高亮项（配置中心可改）。 */
  atMentionDefaultTarget?: AtMentionDefaultTarget;
  /** 在菜单内将执行环境 / 终端设为 @ 默认。 */
  onAtMentionDefaultTargetChange?: (target: AtMentionDefaultTarget) => void | Promise<void>;
}

const CLAUDE_RESERVED_LABELS = new Set(
  CLAUDE_BUILTIN_SLASH_COMMANDS.map((cmd) => cmd.label.trim().toLowerCase()),
);

const EMPTY_SLASH_OPTIONS = {
  detectedPluginSlashOptions: [] as SlashOption[],
  installedPluginSlashOptions: [] as SlashOption[],
  installPluginSlashOptions: [] as SlashOption[],
  skillSlashOptions: [] as SlashOption[],
};

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
  geminiAvailable = false,
  opencodeAvailable = false,
  qoderAvailable = false,
  atMentionDefaultTarget = DEFAULT_AT_MENTION_DEFAULT_TARGET,
  onAtMentionDefaultTargetChange,
}: SlashPopoverProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileResults, setFileResults] = useState<SlashOption[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [slashCatalogOptions, setSlashCatalogOptions] = useState(EMPTY_SLASH_OPTIONS);
  const [omcInstalled, setOmcInstalled] = useState(false);
  const [slashCatalogLoading, setSlashCatalogLoading] = useState(false);

  const mode = trigger.mode;
  const query = trigger.query;

  const detectedPluginLabelSet = useMemo(
    () =>
      new Set(slashCatalogOptions.detectedPluginSlashOptions.map((row) => row.label.trim().toLowerCase())),
    [slashCatalogOptions.detectedPluginSlashOptions],
  );

  useEffect(() => {
    if (mode !== "slash") {
      setSlashCatalogOptions(EMPTY_SLASH_OPTIONS);
      setOmcInstalled(false);
      setSlashCatalogLoading(false);
      return;
    }

    let cancelled = false;
    setSlashCatalogLoading(true);

    void (async () => {
      try {
        const snapshot = await loadSlashCatalog(repositoryPath?.trim() || null);
        if (cancelled) return;

        const detectedLabels = new Set(
          snapshot.detectedPluginCommands.map((row) => row.label.trim().toLowerCase()),
        );
        const reserved = new Set(CLAUDE_RESERVED_LABELS);
        for (const label of detectedLabels) reserved.add(label);
        if (snapshot.omcInstalled) {
          for (const cmd of OMC_COMMANDS) {
            if (!detectedLabels.has(cmd.label.trim().toLowerCase())) {
              reserved.add(cmd.label.trim().toLowerCase());
            }
          }
        }

        setOmcInstalled(snapshot.omcInstalled);
        setSlashCatalogOptions(
          mapSlashCatalogToOptions({
            detectedPluginCommands: snapshot.detectedPluginCommands,
            installedPluginCommands: snapshot.installedPluginCommands,
            installPluginCommands: snapshot.installPluginCommands,
            projectSkills: snapshot.projectSkills,
            userSkills: snapshot.userSkills,
            reservedSkillLabels: reserved,
          }),
        );
      } catch {
        if (!cancelled) {
          setOmcInstalled(false);
          setSlashCatalogOptions(EMPTY_SLASH_OPTIONS);
        }
      } finally {
        if (!cancelled) setSlashCatalogLoading(false);
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

    const token = query.replace(/^\/+/, "");
    const delayMs = token.length === 0 ? 0 : 50;

    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        const entries = await searchRepositoryFiles(repositoryPath, token);
        if (cancelled) return;
        setFileResults(
          entries.map((entry) => ({
            type: "file" as const,
            label: entry.path.split("/").pop() || entry.path,
            description: entry.path,
            path: entry.path,
            isDir: entry.isDir,
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
  const slashCatalogOptionsKey = useMemo(
    () =>
      [
        slashCatalogOptions.detectedPluginSlashOptions.map((s) => s.label).join("\n"),
        slashCatalogOptions.installedPluginSlashOptions.map((s) => s.label).join("\n"),
        slashCatalogOptions.installPluginSlashOptions.map((s) => s.label).join("\n"),
        slashCatalogOptions.skillSlashOptions.map((s) => s.label).join("\n"),
      ].join("|"),
    [slashCatalogOptions],
  );
  const atMentionDefaultTargetKey = encodeAtMentionDefaultSelectValue(atMentionDefaultTarget);

  const slashFiltered = useMemo(() => {
    if (mode !== "slash") {
      return { options: [] as SlashOption[], truncated: false };
    }
    return getFilteredSlashOptions(
      query,
      slashCatalogOptions.detectedPluginSlashOptions,
      slashCatalogOptions.installedPluginSlashOptions,
      slashCatalogOptions.installPluginSlashOptions,
      slashCatalogOptions.skillSlashOptions,
      omcInstalled,
      detectedPluginLabelSet,
    );
  }, [
    mode,
    query,
    slashCatalogOptions,
    slashCatalogOptionsKey,
    omcInstalled,
    detectedPluginLabelSet,
  ]);

  const options = useMemo(() => {
    if (mode === "slash") {
      return slashFiltered.options;
    }
    return getFilteredAtOptions(
      query,
      fileResults,
      employeeOptions,
      teamOptions,
      hideEmployeesInAtMode,
      codexAvailable,
      cursorAvailable,
      geminiAvailable,
      opencodeAvailable,
      qoderAvailable,
    );
  }, [
    mode,
    query,
    slashFiltered,
    fileResults,
    fileResultsKey,
    employeeOptions,
    employeeOptionsKey,
    teamOptions,
    teamOptionsKey,
    hideEmployeesInAtMode,
    codexAvailable,
    cursorAvailable,
    geminiAvailable,
    opencodeAvailable,
    qoderAvailable,
  ]);

  const slashOptionsTruncated = mode === "slash" && slashFiltered.truncated;

  const slashSections = useMemo(
    () => (mode === "slash" ? buildSlashOptionSections(options) : []),
    [mode, options],
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
          if (hasExecutionEnvironmentMention(plain)) {
            const { text: strippedText } = stripExecutionEnvironmentMention(plain);
            plain = strippedText;
            cursor = Math.min(cursor, plain.length);
          }
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
  if (typeof document === "undefined") return null;

  const positionRoot = surfaceRef.current?.anchorEl();
  const caretRect =
    surfaceRef.current?.resolveTriggerAnchorRect?.() ?? trigger.rect ?? null;
  const placement =
    positionRoot && caretRect
      ? computeSlashPopoverPlacement(positionRoot, caretRect)
      : null;
  if (!placement) return null;

  const portalRoot = resolveSlashPopoverPortalRoot(positionRoot ?? null);
  // 实色底：从仍在 Ant css-var 作用域内的 shell 解析后写入，避免 portal 丢变量后背景透明
  const opaqueBackground = resolveSlashPopoverOpaqueBackground(positionRoot ?? null);

  const popoverBaseStyle: React.CSSProperties = {
    position: "fixed",
    left: `${placement.left}px`,
    bottom: `${placement.bottom}px`,
    zIndex: 1200,
    width: "480px",
    background: opaqueBackground,
    backgroundColor: opaqueBackground,
    opacity: 1,
    border: "1px solid var(--ant-color-border-secondary)",
    borderRadius: "8px",
    boxShadow: "var(--ant-box-shadow-secondary)",
  };

  if (mode === "at" && fileLoading && options.length === 0) {
    return createPortal(
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
      </div>,
      portalRoot,
    );
  }

  if (mode === "slash" && slashCatalogLoading && options.length === 0) {
    return createPortal(
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
      </div>,
      portalRoot,
    );
  }

  if (options.length === 0) return null;

  return createPortal(
    <div
      className="app-claude-slash-popover"
      style={{
        ...popoverBaseStyle,
        maxHeight: "400px",
        overflowY: "auto",
        padding: "4px",
      }}
    >
      {mode === "slash" ? (
        <>
          {slashSections.map((section) => (
            <div key={section.group}>
              <div className="app-claude-slash-popover-group-title">{section.title}</div>
              {section.items.map(({ option, flatIndex }) => (
                <div
                  key={`${option.type}-${option.group ?? ""}-${option.label}-${option.path ?? ""}-${option.workflowId ?? ""}`}
                  className={`app-claude-slash-popover-item ${flatIndex === selectedIndex ? "app-claude-slash-popover-item--active" : ""}`}
                  onClick={() => handleSelect(option)}
                  onMouseEnter={() => setSelectedIndex(flatIndex)}
                  style={{ gap: 0, padding: "3px 4px" }}
                >
                  {renderOptionContent(option)}
                </div>
              ))}
            </div>
          ))}
          {slashOptionsTruncated ? (
            <div
              className="app-claude-slash-popover-group-title"
              style={{ color: "var(--ant-color-text-tertiary)", fontWeight: 400 }}
            >
              继续输入以筛选更多命令…
            </div>
          ) : null}
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
    </div>,
    portalRoot,
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
      {opt.type === "file" && opt.isDir ? (
        <ExplorerTreeFolderIcon
          name={opt.label || opt.path?.split("/").pop() || "folder"}
          expanded={false}
          className="app-claude-slash-popover__file-icon"
        />
      ) : null}
      {opt.type === "file" && !opt.isDir ? (
        <ExplorerTreeFileIcon
          fileName={opt.label || opt.path?.split("/").pop() || "file"}
          className="app-claude-slash-popover__file-icon"
        />
      ) : null}
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
