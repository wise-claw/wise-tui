import { memo, useMemo, useState } from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import type { MessagePart, TextPart, ToolUsePart, ReasoningPart } from "../../types";
import { isRenderableMessagePart } from "../../utils/claudeChatMessageDisplay";
import { looksLikeStructuredMarkdownSummary, cliToolOutputForExpandedBody } from "../../utils/assistantOrphanMarkdown";
import { isSkillToolPart, skillToolDisplayName } from "../../utils/skillToolPart";
import { LinkifiedPre } from "./LinkifiedPre";
import { Markdown, StreamingReplyHint, usePacedText } from "./Markdown";
import { WORKFLOW_UI_EVENT_FOCUS_TASK_TOOL } from "../../constants/workflowUiEvents";

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
  const isCompletionSummary = looksLikeStructuredMarkdownSummary(text);

  return (
    <div
      className={`app-message-part app-message-part--text${isCompletionSummary ? " app-message-part--completion-summary" : ""}`}
    >
      <Markdown text={text} streaming={streaming} showPendingHint={showPendingHint} />
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
  const text = usePacedText(part.text, streaming);

  return (
    <div className={`app-message-part app-message-part--reasoning${expanded ? " app-message-part--reasoning-expanded" : ""}`}>
      <button
        type="button"
        className="app-message-part-header"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="app-message-part-header__leading">
          <span className="app-message-part-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </span>
        </span>
        <span className="app-message-part-header__main">
          <span className="app-message-part-title">思考过程</span>
        </span>
        <span className="app-message-part-header__chevron" aria-hidden>
          <ChevronIcon expanded={expanded} />
        </span>
      </button>
      {!expanded && showPendingHint && <StreamingReplyHint />}
      {expanded && (
        <div className="app-message-part-content">
          <Markdown
            text={text}
            streaming={streaming}
            showPendingHint={showPendingHint}
            className="app-message-part--reasoning-content"
          />
        </div>
      )}
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
  return true;
}

export { shouldShowToolOutputBody, toolFailureTextsDuplicate };

function toolPartRenderFingerprint(part: ToolUsePart): string {
  if (part.status !== "running") {
    return `${part.status}|${part.name}|${part.output?.length ?? 0}|${part.error ?? ""}`;
  }
  const subtitle = getToolDisplayInfo(part).subtitle;
  const outBucket = Math.floor((part.output?.length ?? 0) / 512);
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
    return <LinkifiedPre text={cliOnlyOutput} streaming={streaming} className="app-tool-output" />;
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

const ToolUsePartDisplay = memo(function ToolUsePartDisplay({ part }: { part: ToolUsePart }) {
  const isSkill = isSkillToolPart(part);
  const info = useMemo(() => getToolDisplayInfo(part), [part]);
  const isToolResult = !part.name.trim() && Boolean(part.output?.trim() || part.error?.trim());
  const isErrorState = part.status === "error" || Boolean(part.error?.trim());
  const isBashOrExec = part.name.toLowerCase() === "bash" || part.name.toLowerCase() === "exec";
  const hasExpandableBody = Boolean(
    part.output?.trim() ||
      part.error?.trim() ||
      (isBashOrExec && info.subtitle?.trim())
  );
  const [expanded, setExpanded] = useState(
    isSkill ? false : part.status === "error" || Boolean(part.error?.trim()),
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
      className={`app-message-part app-message-part--tool${isSkill ? " app-message-part--skill" : ""}${isToolResult ? " app-message-part--tool-result" : ""}${isErrorState ? " app-message-part--tool-error" : ""}${expanded ? " app-message-part--expanded" : ""}`}
      data-task-id={taskId || undefined}
      data-tool-name={part.name.trim().toLowerCase() || "result"}
    >
      <div className="app-message-part-tool-head">
        <button
          type="button"
          className="app-message-part-header"
          disabled={!hasExpandableBody}
          aria-expanded={hasExpandableBody ? expanded : undefined}
          onClick={() => hasExpandableBody && setExpanded((v) => !v)}
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

function toolPartDisplayEqual(
  prev: Readonly<{ part: ToolUsePart }>,
  next: Readonly<{ part: ToolUsePart }>,
): boolean {
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
          const multiTools = group.parts.length > 1;
          return (
            <div
              key={`tool-group-${groupIdx}`}
              className={`app-message-parts__tool-group${multiTools ? " app-message-parts__tool-group--multi" : ""}`}
            >
              {multiTools ? (
                <div className="app-message-parts__tool-group-label" aria-hidden>
                  工具链 · {group.parts.length}
                </div>
              ) : null}
              {group.parts.map(({ part, originalIndex }) => {
                const key = `${part.type}-${originalIndex}`;
                return <ToolUsePartDisplay key={key} part={part} />;
              })}
            </div>
          );
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
