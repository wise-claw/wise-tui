import { joinAssistantTextPartBodies } from "../src/utils/assistantTextParts";
import { extractLatestTodoWriteFromMessages } from "../src/notifications/todoIngest";
import { applyToolResultPartsToMessages, foldToolResultUserMessagesIntoAssistant } from "../src/services/claudeStreamAssembler";
import type { ClaudeMessage, ToolUsePart } from "../src/types";

// Run with: bun scripts/benchmark-stream-processing.ts
// Synthetic CPU workloads; these do not measure model or network latency.
const fragments = Array.from({ length: 2_000 }, (_, i) => `片段 ${i} 内容。`);
const messages: ClaudeMessage[] = Array.from({ length: 1_500 }, (_, i) => ({
  id: i,
  role: "assistant",
  content: "",
  timestamp: i,
  parts: [{
    type: "tool_use",
    id: `todo-${i}`,
    name: "TodoWrite",
    status: "completed",
    input: { todos: [{ id: "task", content: `任务 ${i}`, status: "pending" }] },
  }],
}));
const toolUpdates: ToolUsePart[] = messages.map((message, i) => ({
  ...(message.parts[0] as ToolUsePart),
  output: `工具结果 ${i}`,
}));
const transcript = messages.flatMap((message, i): ClaudeMessage[] => [message, {
  id: `result-${i}`, role: "user", content: "", timestamp: i,
  parts: [toolUpdates[i]!],
}]);

function measure(name: string, iterations: number, run: () => unknown): void {
  for (let i = 0; i < 5; i += 1) run();
  const samples: number[] = [];
  for (let sample = 0; sample < 7; sample += 1) {
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) run();
    samples.push((performance.now() - start) / iterations);
  }
  samples.sort((a, b) => a - b);
  console.log(`${name}: median ${samples[3]!.toFixed(4)} ms/op`);
}

measure("Join 2,000 text fragments", 10, () => joinAssistantTextPartBodies(fragments));
measure("Find latest TodoWrite in 1,500 messages", 100, () => extractLatestTodoWriteFromMessages(messages));
measure("Fold 1,500 tool results in 3,000 transcript messages", 5, () => foldToolResultUserMessagesIntoAssistant(transcript));
measure("Apply a batch of 1,500 tool results", 10, () => applyToolResultPartsToMessages(messages, toolUpdates));
