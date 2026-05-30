import type { ClaudeMessage, MessagePart, TextPart, ToolUsePart } from "../types";

function parseTimestamp(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const d = Date.parse(v);
    return Number.isNaN(d) ? Date.now() : d;
  }
  return Date.now();
}

function blocksToParts(content: unknown, textMax = 12_000): MessagePart[] {
  if (!Array.isArray(content)) return [];
  const parts: MessagePart[] = [];
  for (const b of content) {
    if (typeof b !== "object" || b === null) continue;
    const block = b as Record<string, unknown>;
    const t = block.type;
    if (t === "text" && typeof block.text === "string") {
      const text = block.text.length > textMax ? block.text.slice(-textMax) : block.text;
      parts.push({ type: "text", text });
    } else if (t === "thinking" && typeof block.thinking === "string") {
      const text = block.thinking.length > textMax ? block.thinking.slice(-textMax) : block.thinking;
      parts.push({ type: "reasoning", text });
    } else if (t === "tool_use") {
      parts.push({
        type: "tool_use",
        id: typeof block.id === "string" ? block.id : `tool_${parts.length}`,
        name: typeof block.name === "string" ? block.name : "unknown",
        input:
          typeof block.input === "object" && block.input !== null && !Array.isArray(block.input)
            ? (block.input as Record<string, unknown>)
            : {},
        status: "completed",
      });
    }
  }
  return parts;
}

function toolResultToText(block: Record<string, unknown>): string {
  const inner = block.content;
  if (typeof inner === "string") return inner;
  if (!Array.isArray(inner)) return "";
  return inner
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .filter((c) => c.type === "text")
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .join("");
}

/**
 * Parses Claude Code session `*.jsonl` lines (SDK-shaped records) into UI messages.
 */
export function parseClaudeSessionJsonlLines(lines: string[]): ClaudeMessage[] {
  const messages: ClaudeMessage[] = [];
  let idCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const rowType = row.type;
    if (rowType === "user") {
      if (row.isMeta === true) continue;
      const msg = row.message as Record<string, unknown> | undefined;
      if (!msg || msg.role !== "user") continue;
      const rawContent = msg.content;

      if (Array.isArray(rawContent)) {
        const blocks = rawContent.filter(
          (c): c is Record<string, unknown> => typeof c === "object" && c !== null,
        ) as Record<string, unknown>[];
        if (blocks.some((c) => c.type === "tool_result")) {
          const toolParts: MessagePart[] = [];
          let trIdx = 0;
          for (const c of blocks.filter((x) => x.type === "tool_result")) {
            const raw = toolResultToText(c).trim();
            if (!raw) continue;
            const excerpt = raw.length > 4000 ? `${raw.slice(0, 4000)}…` : raw;
            const err = c.is_error === true;
            const idStr =
              typeof c.tool_use_id === "string" && c.tool_use_id.trim()
                ? c.tool_use_id.trim()
                : `tool_${idCounter}_${trIdx}`;
            trIdx += 1;
            const nameStr = typeof c.name === "string" ? c.name : "";
            const part: ToolUsePart = {
              type: "tool_use",
              id: idStr,
              name: nameStr,
              input: {},
              output: excerpt,
              status: err ? "error" : "completed",
              error: err ? excerpt : undefined,
            };
            toolParts.push(part);
          }
          if (toolParts.length > 0) {
            idCounter += 1;
            const contentJoin = toolParts
              .filter((p): p is ToolUsePart => p.type === "tool_use")
              .map((p) => p.output ?? "")
              .join("\n\n");
            messages.push({
              id: idCounter,
              role: "user",
              content: contentJoin,
              parts: toolParts,
              timestamp: parseTimestamp(row.timestamp),
            });
          }
          continue;
        }
        const text = blocks
          .filter((c) => c.type === "text")
          .map((c) => (typeof c.text === "string" ? c.text : ""))
          .join("");
        if (!text.trim()) continue;
        if (text.includes("<local-command-caveat>")) continue;
        if (text.trimStart().startsWith("<command-name>")) continue;
        idCounter += 1;
        messages.push({
          id: idCounter,
          role: "user",
          content: text,
          parts: [{ type: "text", text }],
          timestamp: parseTimestamp(row.timestamp),
        });
        continue;
      }

      if (typeof rawContent !== "string") continue;
      const text = rawContent;
      if (!text.trim()) continue;
      if (text.includes("<local-command-caveat>")) continue;
      if (text.trimStart().startsWith("<command-name>")) continue;
      idCounter += 1;
      messages.push({
        id: idCounter,
        role: "user",
        content: text,
        parts: [{ type: "text", text }],
        timestamp: parseTimestamp(row.timestamp),
      });
    } else if (rowType === "assistant") {
      const msg = row.message as Record<string, unknown> | undefined;
      if (!msg || msg.role !== "assistant") continue;
      const parts = blocksToParts(msg.content);
      if (parts.length === 0) continue;
      const textContent = parts
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("");
      idCounter += 1;
      messages.push({
        id: idCounter,
        role: "assistant",
        content: textContent,
        parts,
        timestamp: parseTimestamp(row.timestamp),
      });
    }
  }

  return messages;
}
