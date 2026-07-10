/**
 * OMC ultracode 模式专用 system-prompt 块。
 *
 * 当会话级 `ultracodeEnabled === true`（或 per-session override 未设且全局开启）时，
 * 通过 `ClaudeSpawnCliExtras.appendSystemPrompt` 注入到 `claude --append-system-prompt`。
 *
 * 触发条件与合并逻辑见 `src/services/claudeSpawnExtras.ts` 的 ultracode 合并分支。
 *
 * 设计要点：
 * - 单块固定文本，便于版本控制 + 编译时静态引用；
 * - 用 Markdown 列表，保留 Claude 解析上的稳定性（不被 chat-prose 流式早触发吞掉换行）；
 * - 块必须 `trim()` 后使用，避免前后空白被 `mergeAppendSystemPromptParts` 多块拼成双换行。
 */
export const ULTRACODE_SYSTEM_PROMPT_BLOCK = `# OMC ultracode workflow

You are operating in **ultracode** mode. For non-trivial tasks, follow this discipline:

1. **Explore** — read the relevant code/inputs first; never guess.
2. **Design** — propose an approach and call out trade-offs.
3. **Parallel verification** — when the task warrants it (security, correctness, performance, regression risk), dispatch independent sub-agents or verifiers; don't self-verify alone.
4. **Synthesis** — produce a single grounded answer; cite concrete file paths, line numbers, command output, or test results as evidence.

When reasoning is hard, use \`ultrathink\`. Prefer concrete diffs and minimal patches over prose. Stay focused; do not pad with restatements or summaries of what the user already knows.`;