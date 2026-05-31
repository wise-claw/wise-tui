/** 将 Cursor SDK stream 事件映射为 Wise 可消费的 Claude stream-json 行。 */

export type ClaudeStreamLine = Record<string, unknown>;

type SdkStreamEvent = {
  type: string;
  message?: {
    role?: string;
    content?: unknown[];
  };
  call_id?: string;
  name?: string;
  status?: string;
  args?: unknown;
  result?: unknown;
  text?: string;
};

function serializeToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result == null) return "";
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

export function sdkMessageToClaudeStreamLines(event: SdkStreamEvent): ClaudeStreamLine[] {
  if (event.type === "assistant" && Array.isArray(event.message?.content)) {
    const blocks = event.message.content.filter(Boolean);
    if (blocks.length === 0) return [];
    return [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: blocks,
        },
      },
    ];
  }

  if (event.type === "tool_call") {
    const callId = typeof event.call_id === "string" ? event.call_id.trim() : "";
    const name = typeof event.name === "string" ? event.name.trim() : "unknown";
    if (!callId) return [];

    if (event.status === "running") {
      return [
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: callId,
                name,
                input: event.args ?? {},
              },
            ],
          },
        },
      ];
    }

    if (event.status === "completed" || event.status === "error") {
      return [
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: callId,
                content: serializeToolResult(event.result),
                is_error: event.status === "error",
              },
            ],
          },
        },
      ];
    }
  }

  if (event.type === "thinking" && typeof event.text === "string" && event.text.trim()) {
    return [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: event.text }],
        },
      },
    ];
  }

  return [];
}
