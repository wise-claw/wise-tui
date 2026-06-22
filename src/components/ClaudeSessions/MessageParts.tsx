import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import type { MessagePart, TextPart, ToolUsePart, ReasoningPart } from "../../types";
import { isRenderableMessagePart } from "../../utils/claudeChatMessageDisplay";
import {
  chatAssistantTextPartClassNames,
  looksLikeStructuredMarkdownSummary,
  cliToolOutputForExpandedBody,
} from "../../utils/assistantOrphanMarkdown";
import { reasoningPreviewOverflows } from "../../utils/reasoningPreviewOverflows";
import { isSkillToolPart, skillToolDisplayName } from "../../utils/skillToolPart";
import { LinkifiedPre } from "./LinkifiedPre";
import { Markdown, StreamingReplyHint, usePacedText } from "./Markdown";
import { ToolFileEditCard } from "./ToolFileEditCard";
import { WORKFLOW_UI_EVENT_FOCUS_TASK_TOOL } from "../../constants/workflowUiEvents";
import {
  extractToolFileEditPreview,
  isFileEditToolName,
  isToolEditNoiseOutput,
} from "../../utils/toolFileEditPreview";

// ── SVG Icons ──

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

/** 有文本选区时，第一次点击只用于取消选中，不触发展开/收起。 */
function useClickAfterSelectionGuard() {
  const hadTextSelectionRef = useRef(false);
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hadTextSelectionRef.current = false;
      return;
    }
    const container = event.currentTarget;
    const range = selection.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer;
    hadTextSelectionRef.current = container.contains(commonAncestor);
  }, []);
  const consumeHadTextSelection = useCallback(() => {
    if (!hadTextSelectionRef.current) return false;
    hadTextSelectionRef.current = false;
    return true;
  }, []);
  const resetPointerGuard = useCallback(() => {
    hadTextSelectionRef.current = false;
  }, []);
  return { onPointerDown, consumeHadTextSelection, resetPointerGuard };
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M6.25 6.25V2.92h10.83v10.83h-3.33M13.75 6.25v10.83H2.92V6.25h10.83z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 10.5 8 13.5 15 6.5" />
    </svg>
  );
}

// ── Text Part ──

const TextPartDisplay = memo(function TextPartDisplay({
  part,
  streaming,
  showPendingHint,
}: {
  part: TextPart;
  streaming: boolean;
  showPendingHint: boolean;
}) {
  const text = usePacedText(part.text, streaming);
  const { partClassName, markdownClassName } = chatAssistantTextPartClassNames(text);

  return (
    <div className={partClassName}>
      <Markdown
        text={text}
        streaming={streaming}
        showPendingHint={showPendingHint}
        className={markdownClassName}
      />
    </div>
  );
}, textPartDisplayEqual);

function textPartDisplayEqual(
  prev: Readonly<{ part: TextPart; streaming: boolean; showPendingHint: boolean }>,
  next: Readonly<{ part: TextPart; streaming: boolean; showPendingHint: boolean }>,
): boolean {
  return (
    prev.streaming === next.streaming &&
    prev.showPendingHint === next.showPendingHint &&
    (prev.part === next.part || prev.part.text === next.part.text)
  );
}

// ── Reasoning Part ──

const ReasoningPartDisplay = memo(function ReasoningPartDisplay({
  part,
  streaming,
  showPendingHint,
}: {
  part: ReasoningPart;
  streaming: boolean;
  showPendingHint: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const text = usePacedText(part.text, streaming);

  useLayoutEffect(() => {
    if (expanded) {
      setOverflows((prev) => (prev ? false : prev));
      return;
    }
    const el = bodyRef.current;
    if (!el) return;

    let rafId = 0;
    const measure = () => {
      const nextOverflows = reasoningPreviewOverflows(el, text);
      setOverflows((prev) => (prev === nextOverflows ? prev : nextOverflows));
    };
    const scheduleMeasure = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const row = el.querySelector<HTMLElement>(".app-message-part-reasoning-inline-row");
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    observer?.observe(el);
    if (row) observer?.observe(row);
    const host = el.querySelector<HTMLElement>(".app-message-part-reasoning-inline-row .app-markdown-host");
    if (host) observer?.observe(host);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [expanded, text]);

  const canToggle = overflows || expanded;
  const { onPointerDown, consumeHadTextSelection, resetPointerGuard } = useClickAfterSelectionGuard();
  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);
  const handleToggleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!canToggle) return;
      if (consumeHadTextSelection()) return;
      event.stopPropagation();
      handleToggle();
    },
    [canToggle, consumeHadTextSelection, handleToggle],
  );
  const handleRowClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!canToggle) return;
      if (consumeHadTextSelection()) return;
      const target = event.target;
      if (target instanceof Element && target.closest("a, button")) return;
      handleToggle();
    },
    [canToggle, consumeHadTextSelection, handleToggle],
  );

  return (
    <div
      className={`app-message-part app-message-part--reasoning${
        expanded ? " app-message-part--reasoning-expanded" : ""
      }`}
    >
      <div
        className="app-message-part-reasoning-shell"
      >
        <div
          className={`app-message-part-reasoning-collapsible${
            expanded ? " app-message-part-reasoning-collapsible--expanded" : ""
          }`}
        >
          <div
            className={`app-message-part-reasoning-collapsible__row${
              canToggle ? " app-message-part-reasoning-collapsible__row--clickable" : ""
            }`}
            onPointerDown={canToggle ? onPointerDown : undefined}
            onPointerLeave={canToggle ? resetPointerGuard : undefined}
            onPointerCancel={canToggle ? resetPointerGuard : undefined}
            onClick={canToggle ? handleRowClick : undefined}
          >
            <div
              ref={bodyRef}
              className="app-message-part-reasoning-collapsible__body"
            >
              <div className="app-message-part-reasoning-inline-row">
                <span className="app-message-part-reasoning-label">
                  <span className="app-message-part-reasoning-label__icon" aria-hidden>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.9.96 3.58 2.42 4.56L6 18h12l-.42-5.94A5.49 5.49 0 0 0 20 7.5 5.5 5.5 0 0 0 14.5 2h-5Z" />
                      <path d="M9 18v2M15 18v2" />
                    </svg>
                  </span>
                  <span className="app-message-part-reasoning-label__text">思考过程</span>
                </span>
                <Markdown
                  text={text}
                  streaming={streaming}
                  showPendingHint={false}
                  className="app-message-part--reasoning-content"
                />
              </div>
            </div>
            {canToggle ? (
              <button
                type="button"
                className="app-message-part-reasoning-collapsible__toggle"
                aria-label={expanded ? "收起" : "展开"}
                aria-expanded={expanded}
                onPointerDown={onPointerDown}
                onClick={handleToggleClick}
              >
                <ChevronIcon expanded={expanded} />
              </button>
            ) : null}
          </div>
        </div>
        {showPendingHint ? <StreamingReplyHint /> : null}
      </div>
    </div>
  );
}, reasoningPartDisplayEqual);

function reasoningPartDisplayEqual(
  prev: Readonly<{ part: ReasoningPart; streaming: boolean; showPendingHint: boolean }>,
  next: Readonly<{ part: ReasoningPart; streaming: boolean; showPendingHint: boolean }>,
): boolean {
  return (
    prev.streaming === next.streaming &&
    prev.showPendingHint === next.showPendingHint &&
    (prev.part === next.part || prev.part.text === next.part.text)
  );
}

// ── Tool Use Part ──

/** 从 tool input 里按候选键取第一段非空字符串（Claude / Claude Code 字段名略有差异） */
function pickInputString(input: Record<string, unknown>, keys: string[], maxLen = 160): string {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) {
      const t = v.trim();
      return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
    }
    if (Array.isArray(v) && v.length > 0) {
      const joined = v.filter((x): x is string => typeof x === "string").join(", ").trim();
      if (joined) {
        return joined.length > maxLen ? `${joined.slice(0, maxLen)}…` : joined;
      }
    }
  }
  return "";
}

function truncateToolPreview(text: string, maxLen = 72): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
}

export function getToolDisplayInfo(part: ToolUsePart): { label: string; subtitle: string } {
  const input = part.input as Record<string, unknown>;
  const n = part.name.trim();
  if (!n && (part.output?.trim() || part.error?.trim())) {
    const err = part.error?.trim() ?? "";
    const out = part.output?.trim() ?? "";
    const preview = err ? truncateToolPreview(err, 80) : truncateToolPreview(out, 80);
    return {
      label: "工具结果",
      subtitle: preview || (part.id ? `…${part.id.slice(-10)}` : ""),
    };
  }
  const lower = n.toLowerCase();

  switch (lower) {
    case "bash":
    case "exec":
      return {
        label: lower === "exec" ? "Exec" : "Bash",
        subtitle: pickInputString(
          input,
          ["command", "cmd", "shell_command", "script", "line"],
          2000
        ),
      };
    case "read":
      return {
        label: "读取文件",
        subtitle: pickInputString(input, ["file_path", "path", "target_file"]).split("/").pop() || "",
      };
    case "edit":
      return {
        label: "编辑文件",
        subtitle: pickInputString(input, ["file_path", "path", "target_file"]).split("/").pop() || "",
      };
    case "write":
      return {
        label: "写入文件",
        subtitle: pickInputString(input, ["file_path", "path", "target_file"]).split("/").pop() || "",
      };
    case "glob":
      return {
        label: "Glob",
        subtitle: pickInputString(
          input,
          [
            "pattern",
            "glob_pattern",
            "glob",
            "path",
            "target_directory",
            "root",
            "root_path",
            "paths",
          ],
          1000
        ),
      };
    case "grep":
      return {
        label: "Grep",
        subtitle: pickInputString(input, ["pattern", "query", "path", "file_path", "glob"], 1000),
      };
    case "web_fetch":
      return {
        label: "获取网页",
        subtitle: pickInputString(input, ["url"], 120),
      };
    case "web_search":
      return {
        label: "网页搜索",
        subtitle: pickInputString(input, ["query"], 120),
      };
    case "apply_patch": {
      // Codex 文件编辑：路径已在 Rust 端解析到 file_path；副标题展示首个受影响的文件。
      const filePath = pickInputString(input, ["file_path", "path"]);
      const fileName = filePath ? filePath.split("/").pop() || filePath : "补丁";
      return {
        label: "应用补丁",
        subtitle: fileName,
      };
    }
    case "update_plan": {
      const plan = input.plan;
      const steps = Array.isArray(plan) ? plan.length : 0;
      const inProgress = Array.isArray(plan)
        ? (plan as Array<Record<string, unknown>>).findIndex(
            (s) => (s.status ?? "").toString() === "in_progress",
          )
        : -1;
      const headline = inProgress >= 0
        ? (plan as Array<Record<string, unknown>>)[inProgress]?.step
        : "";
      const summary = steps > 0 ? `共 ${steps} 步` : "";
      return {
        label: "更新计划",
        subtitle:
          [headline, summary].filter(Boolean).join(" · ") ||
          pickInputString(input, ["summary"], 140),
      };
    }
    case "view_image": {
      const imagePath = pickInputString(input, ["path"]);
      const fileName = imagePath ? imagePath.split("/").pop() || imagePath : "";
      return {
        label: "查看图片",
        subtitle: fileName,
      };
    }
    case "write_stdin":
      return {
        label: "写入 stdin",
        subtitle: pickInputString(input, ["session_id", "input", "command"], 140),
      };
    case "task": {
      const agentType = pickInputString(input, ["subagent_type", "agent_type"], 48);
      const headline = pickInputString(input, ["description", "title", "summary"], 140);
      const body = headline || pickInputString(input, ["prompt", "instructions"], 160);
      const modelHint = pickInputString(input, ["model"], 24);
      const bits = [agentType && `[${agentType}]`, body, modelHint && `模型: ${modelHint}`].filter(Boolean);
      return {
        label: "子 Agent（Task）",
        subtitle: bits.join(" · "),
      };
    }
    default:
      if (isSkillToolPart(part)) {
        return {
          label: "Skill",
          subtitle: skillToolDisplayName(part),
        };
      }
      return {
        label: n || part.name,
        subtitle: pickInputString(input, [
          "description",
          "prompt",
          "subagent_type",
          "title",
          "instructions",
          "command",
          "pattern",
          "path",
          "file_path",
          "query",
          "url",
          "glob_pattern",
          "target_directory",
        ]),
      };
  }
}

function getToolMetaTags(part: ToolUsePart): string[] {
  const input = part.input as Record<string, unknown>;
  const taskIdRaw = input.taskId ?? input.task_id;
  const stageRaw = input.stage ?? input.workflow_stage;
  const taskId = typeof taskIdRaw === "string" && taskIdRaw.trim() ? taskIdRaw.trim() : "";
  const stage = typeof stageRaw === "string" && stageRaw.trim() ? stageRaw.trim() : "";
  const tags: string[] = [];
  if (taskId) tags.push(`任务: ${taskId}`);
  if (stage) tags.push(`阶段: ${stage}`);
  return tags;
}

export function shouldRenderOutputAsMarkdown(part: ToolUsePart): boolean {
  if (isSkillToolPart(part)) return true;

  const text = part.output || "";
  if (looksLikeStructuredMarkdownSummary(text)) return true;

  const name = part.name.trim().toLowerCase();
  // If the name is empty or it is a generic "工具结果" or a subagent/task tool
  if (
    !name ||
    name === "task" ||
    name === "subagent" ||
    name === "agent" ||
    name === "taskcreate" ||
    name === "taskupdate" ||
    name === "todowrite"
  ) {
    return true;
  }

  // If it's a code/CLI/filesystem tool, we should NOT render it as markdown to preserve monospace formatting
  const excludeList = [
    "bash",
    "exec",
    "run_command",
    "read",
    "read_file",
    "view_file",
    "edit",
    "edit_file",
    "write",
    "write_file",
    "grep",
    "grep_search",
    "glob",
    "list_dir",
  ];
  if (excludeList.includes(name)) {
    return false;
  }

  if (!text.trim()) return false;

  // Use robust regex with multiline flag 'm' to detect markdown structures
  const hasMarkdownCues =
    /^(?:#+\s|[-*+]\s|\d+\.\s)/m.test(text) ||  // headings, bullets, numbered lists at the start of any line
    /^(?:---|___|\*\*\*)$/m.test(text) ||       // horizontal lines
    /\*\*|__|_|`[^`]+`/.test(text) ||            // bold, italic, or inline code
    /\|.+\|.+\|/m.test(text);                   // tables

  return hasMarkdownCues;
}

function toolFailureTextsDuplicate(error: string, output: string): boolean {
  const e = error.trim();
  const o = output.trim();
  if (!e || !o) return false;
  return e === o;
}

function shouldShowToolOutputBody(part: ToolUsePart): boolean {
  const outputText = part.output?.trim() ?? "";
  const errorText = part.error?.trim() ?? "";
  if (!outputText) return false;
  if (errorText && toolFailureTextsDuplicate(errorText, outputText)) return false;
  const editPreview = extractToolFileEditPreview(part);
  if (editPreview && isToolEditNoiseOutput(outputText)) return false;
  return true;
}

export { shouldShowToolOutputBody, toolFailureTextsDuplicate };

function toolPartRenderFingerprint(part: ToolUsePart): string {
  if (part.status !== "running") {
    return `${part.status}|${part.name}|${part.output?.length ?? 0}|${part.error ?? ""}`;
  }
  const subtitle = getToolDisplayInfo(part).subtitle;
  const outputBucketSize = isFileEditToolName(part.name) ? 1024 : 512;
  const outBucket = Math.floor((part.output?.length ?? 0) / outputBucketSize);
  const subBucket = Math.floor(subtitle.length / 64);
  return `${part.status}|${part.name}|${outBucket}|${subBucket}|${part.error ?? ""}`;
}

function ToolUseOutputBody({ part, streaming }: { part: ToolUsePart; streaming: boolean }) {
  const lower = part.name.trim().toLowerCase();
  const isCliTool = lower === "bash" || lower === "exec" || lower === "run_command";
  const cliOnlyOutput = isCliTool ? cliToolOutputForExpandedBody(part) : (part.output?.trim() ?? "");
  const output = part.output?.trim() ?? "";
  if (!output) return null;

  if (isCliTool) {
    if (!cliOnlyOutput) return null;
    return (
      <div className="app-tool-output-wrap app-tool-output-wrap--cli">
        <LinkifiedPre text={cliOnlyOutput} streaming={streaming} className="app-tool-output app-tool-output--cli" />
      </div>
    );
  }

  if (shouldRenderOutputAsMarkdown(part)) {
    return <Markdown text={output} streaming={streaming} className="app-tool-output-markdown" />;
  }
  return <LinkifiedPre text={output} streaming={streaming} className="app-tool-output" />;
}

function messagePartContentEqual(a: MessagePart, b: MessagePart): boolean {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "text":
      return b.type === "text" && a.text === b.text;
    case "reasoning":
      return b.type === "reasoning" && a.text === b.text;
    case "tool_use":
      if (b.type !== "tool_use") return false;
      if (a.status === "running" || b.status === "running") {
        return toolPartRenderFingerprint(a) === toolPartRenderFingerprint(b);
      }
      return (
        a.name === b.name &&
        a.status === b.status &&
        a.output === b.output &&
        a.error === b.error
      );
    default:
      return false;
  }
}

const ToolUsePartDisplay = memo(function ToolUsePartDisplay({
  part,
  expanded: controlledExpanded,
  onExpandedChange,
}: {
  part: ToolUsePart;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const isSkill = isSkillToolPart(part);
  const info = useMemo(() => getToolDisplayInfo(part), [part]);
  const isToolResult = !part.name.trim() && Boolean(part.output?.trim() || part.error?.trim());
  const isErrorState = part.status === "error" || Boolean(part.error?.trim());
  const isBashOrExec = part.name.toLowerCase() === "bash" || part.name.toLowerCase() === "exec";
  const editPreview = useMemo(() => extractToolFileEditPreview(part), [part]);
  const hasExpandableBody = hasExpandableToolBody(part, info, editPreview);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const setExpanded = useCallback(
    (next: boolean) => {
      if (onExpandedChange) onExpandedChange(next);
      else setInternalExpanded(next);
    },
    [onExpandedChange],
  );
  const tags = useMemo(() => getToolMetaTags(part), [part]);
  const input = part.input as Record<string, unknown>;
  const taskId =
    typeof input.taskId === "string" && input.taskId.trim()
      ? input.taskId.trim()
      : typeof input.task_id === "string" && input.task_id.trim()
        ? input.task_id.trim()
        : "";
  const outputStreaming = part.status === "running";
  const showCompactEditCard = Boolean(editPreview && !hasExpandableBody && !isErrorState);
  const { onPointerDown: onTogglePointerDown, consumeHadTextSelection } = useClickAfterSelectionGuard();
  const { copied, copy } = useCopyToClipboard();
  const copyText =
    (part.output?.trim() ? part.output : part.error?.trim()) ||
    (isBashOrExec ? info.subtitle : "") ||
    "";
  const canCopy = Boolean(copyText.trim());

  function handleCopy(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    void copy(copyText);
  }

  function handleLinkTask(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (!taskId) return;
    window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_FOCUS_TASK_TOOL, { detail: { taskId } }));
  }

  const statusIcon =
    part.status === "running" ? (
      <span className="app-tool-status-dot app-tool-status-dot--running" />
    ) : part.status === "completed" ? (
      <span className="app-tool-status-dot app-tool-status-dot--completed" />
    ) : part.status === "error" ? (
      <span className="app-tool-status-dot app-tool-status-dot--error" />
    ) : (
      <span className="app-tool-status-dot" />
    );

  return (
    <div
      className={`app-message-part app-message-part--tool${isSkill ? " app-message-part--skill" : ""}${isToolResult ? " app-message-part--tool-result" : ""}${isErrorState ? " app-message-part--tool-error" : ""}${editPreview ? " app-message-part--tool-edit-preview" : ""}${expanded ? " app-message-part--expanded" : ""}`}
      data-task-id={taskId || undefined}
      data-tool-name={part.name.trim().toLowerCase() || "result"}
    >
      {showCompactEditCard ? null : (
      <div className="app-message-part-tool-head">
        <button
          type="button"
          className="app-message-part-header"
          disabled={!hasExpandableBody}
          aria-expanded={hasExpandableBody ? expanded : undefined}
          onPointerDown={hasExpandableBody ? onTogglePointerDown : undefined}
          onClick={() => {
            if (!hasExpandableBody) return;
            if (consumeHadTextSelection()) return;
            setExpanded(!expanded);
          }}
        >
          <span className="app-message-part-header__leading">{statusIcon}</span>
          <span className="app-message-part-header__main">
            <span className="app-message-part-title">{info.label}</span>
            {info.subtitle ? (
              <span className="app-message-part-subtitle" title={info.subtitle}>
                {info.subtitle}
              </span>
            ) : null}
            {tags.length > 0 ? (
              <span className="app-message-part-header__tags">
                {tags.map((tag) => (
                  <span key={tag} className="app-message-part-tag">
                    {tag}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
          {hasExpandableBody ? (
            <span className="app-message-part-header__chevron" aria-hidden>
              <ChevronIcon expanded={expanded} />
            </span>
          ) : null}
        </button>
        {taskId ? (
          <button type="button" className="app-message-part-link-task-btn" onClick={handleLinkTask}>
            关联任务
          </button>
        ) : null}
        {canCopy ? (
          <button
            type="button"
            className={`app-tool-copy-btn app-tool-copy-btn--head${copied ? " is-copied" : ""}`}
            onClick={handleCopy}
            title={copied ? "已复制" : "复制"}
            aria-label={copied ? "已复制" : "复制"}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        ) : null}
      </div>
      )}
      {editPreview ? <ToolFileEditCard preview={editPreview} streaming={outputStreaming} /> : null}
      {expanded && hasExpandableBody ? (
        <div className="app-message-part-content">
          {isBashOrExec && info.subtitle ? (
            <div className="app-tool-expanded-input">
              <span className="app-tool-expanded-input-label">完整命令：</span>
              <pre className="app-tool-expanded-input-code"><code>{info.subtitle}</code></pre>
            </div>
          ) : null}
          {part.error?.trim() ? <pre className="app-tool-error">{part.error.trim()}</pre> : null}
          {shouldShowToolOutputBody(part) ? (
            <ToolUseOutputBody part={part} streaming={outputStreaming} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}, toolPartDisplayEqual);

function toolPartStableKey(part: ToolUsePart, originalIndex: number): string {
  return `${originalIndex}:${part.id}`;
}

function hasExpandableToolBody(
  part: ToolUsePart,
  info: ReturnType<typeof getToolDisplayInfo> = getToolDisplayInfo(part),
  editPreview: ReturnType<typeof extractToolFileEditPreview> = extractToolFileEditPreview(part),
): boolean {
  const isBashOrExec = part.name.toLowerCase() === "bash" || part.name.toLowerCase() === "exec";
  const outputText = part.output?.trim() ?? "";
  const effectiveOutput =
    editPreview && outputText && isToolEditNoiseOutput(outputText) ? "" : outputText;
  return Boolean(
    effectiveOutput ||
      part.error?.trim() ||
      (isBashOrExec && info.subtitle?.trim()),
  );
}

function isCompactEditPreviewPart(part: ToolUsePart): boolean {
  const editPreview = extractToolFileEditPreview(part);
  if (!editPreview) return false;
  const isErrorState = part.status === "error" || Boolean(part.error?.trim());
  if (isErrorState) return false;
  return !hasExpandableToolBody(part, getToolDisplayInfo(part), editPreview);
}

const ToolGroupDisplay = memo(function ToolGroupDisplay({
  parts,
}: {
  parts: { part: ToolUsePart; originalIndex: number }[];
}) {
  const multiTools = parts.length > 1;
  const keys = useMemo(
    () => parts.map(({ part, originalIndex }) => toolPartStableKey(part, originalIndex)),
    [parts],
  );
  const expandableKeys = useMemo(
    () =>
      parts
        .filter(({ part }) => hasExpandableToolBody(part))
        .map(({ part, originalIndex }) => toolPartStableKey(part, originalIndex)),
    [parts],
  );
  const editCardsOnly = useMemo(
    () => parts.length > 0 && parts.every(({ part }) => isCompactEditPreviewPart(part)),
    [parts],
  );
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedMap((prev) => {
      const next: Record<string, boolean> = {};
      for (const key of keys) {
        next[key] = prev[key] ?? false;
      }
      return next;
    });
  }, [keys]);

  const errorCount = useMemo(
    () => parts.filter(({ part }) => part.status === "error" || Boolean(part.error?.trim())).length,
    [parts],
  );
  const anyExpanded = expandableKeys.some((key) => expandedMap[key]);
  const anyCollapsed = expandableKeys.some((key) => !expandedMap[key]);

  const expandAll = useCallback(() => {
    setExpandedMap((prev) => {
      const next = { ...prev };
      for (const key of expandableKeys) next[key] = true;
      return next;
    });
  }, [expandableKeys]);

  const collapseAll = useCallback(() => {
    setExpandedMap((prev) => {
      const next = { ...prev };
      for (const key of expandableKeys) next[key] = false;
      return next;
    });
  }, [expandableKeys]);

  return (
    <div
      className={`app-message-parts__tool-group${multiTools ? " app-message-parts__tool-group--multi" : ""}${editCardsOnly ? " app-message-parts__tool-group--edit-cards-only" : ""}`}
    >
      {multiTools ? (
        <div className="app-message-parts__tool-group-head">
          <span className="app-message-parts__tool-group-label">
            工具链 · {parts.length}
            {errorCount > 0 ? (
              <span className="app-message-parts__tool-group-error"> · {errorCount} 失败</span>
            ) : null}
          </span>
          {expandableKeys.length > 0 ? (
            <div className="app-message-parts__tool-group-actions">
              <button
                type="button"
                className="app-message-parts__tool-group-action"
                disabled={!anyCollapsed}
                onClick={expandAll}
              >
                全部展开
              </button>
              <button
                type="button"
                className="app-message-parts__tool-group-action"
                disabled={!anyExpanded}
                onClick={collapseAll}
              >
                全部收起
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {parts.map(({ part, originalIndex }) => {
        const key = toolPartStableKey(part, originalIndex);
        return (
          <ToolUsePartDisplay
            key={key}
            part={part}
            expanded={expandedMap[key] ?? false}
            onExpandedChange={(next) => setExpandedMap((prev) => ({ ...prev, [key]: next }))}
          />
        );
      })}
    </div>
  );
});

function toolPartDisplayEqual(
  prev: Readonly<{ part: ToolUsePart; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void }>,
  next: Readonly<{ part: ToolUsePart; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void }>,
): boolean {
  if (prev.expanded !== next.expanded) return false;
  if (prev.part === next.part) return true;
  return toolPartRenderFingerprint(prev.part) === toolPartRenderFingerprint(next.part);
}

// ── Message Parts ──

function messagePartsDisplayEqual(
  prev: Readonly<{ parts: MessagePart[]; streaming: boolean; inlinePendingHint?: boolean }>,
  next: Readonly<{ parts: MessagePart[]; streaming: boolean; inlinePendingHint?: boolean }>,
): boolean {
  if (prev.streaming !== next.streaming) return false;
  if (prev.inlinePendingHint !== next.inlinePendingHint) return false;
  if (prev.parts === next.parts) return true;
  if (prev.parts.length !== next.parts.length) return false;
  for (let i = 0; i < prev.parts.length; i += 1) {
    if (!messagePartContentEqual(prev.parts[i]!, next.parts[i]!)) return false;
  }
  return true;
}

export const MessagePartsDisplay = memo(function MessagePartsDisplay({
  parts,
  streaming,
  /** 为 false 时不在各 part 内展示「正在思考」（由消息列表底部统一展示） */
  inlinePendingHint = true,
}: {
  parts: MessagePart[];
  streaming: boolean;
  inlinePendingHint?: boolean;
}) {
  const visibleParts = parts.filter(isRenderableMessagePart);
  if (visibleParts.length === 0) return null;

  const lastIdx = visibleParts.length - 1;

  type RenderGroup =
    | { type: "single"; part: MessagePart; originalIndex: number }
    | { type: "tool_group"; parts: { part: ToolUsePart; originalIndex: number }[] };

  const groups: RenderGroup[] = [];
  visibleParts.forEach((part, i) => {
    if (part.type === "tool_use") {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.type === "tool_group") {
        lastGroup.parts.push({ part, originalIndex: i });
      } else {
        groups.push({ type: "tool_group", parts: [{ part, originalIndex: i }] });
      }
    } else {
      groups.push({ type: "single", part, originalIndex: i });
    }
  });

  return (
    <div className="app-message-parts">
      {groups.map((group, groupIdx) => {
        if (group.type === "tool_group") {
          return <ToolGroupDisplay key={`tool-group-${groupIdx}`} parts={group.parts} />;
        } else {
          const { part, originalIndex } = group;
          const key = `${part.type}-${originalIndex}`;
          const hintHere = streaming && inlinePendingHint && originalIndex === lastIdx;
          switch (part.type) {
            case "text":
              return <TextPartDisplay key={key} part={part} streaming={streaming} showPendingHint={hintHere} />;
            case "reasoning":
              return <ReasoningPartDisplay key={key} part={part} streaming={streaming} showPendingHint={hintHere} />;
            default:
              return null;
          }
        }
      })}
      {streaming && inlinePendingHint && visibleParts[lastIdx]?.type === "tool_use" && <StreamingReplyHint />}
    </div>
  );
}, messagePartsDisplayEqual);
