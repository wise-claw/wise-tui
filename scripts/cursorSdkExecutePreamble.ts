/** 注入到 Wise execute 用户 prompt 前，降低模型委派 Task 子代理、口头回复不落盘的概率。 */
export const WISE_CURSOR_SDK_EXECUTE_PREAMBLE = `[Wise Cursor SDK] 你在本地 Agent 模式运行，cwd 为当前仓库。请直接使用 read/write/edit/grep/shell 等工具修改文件；禁止调用 Task 子代理；不要声称「工具不可用」除非 init.tools 确实为空。

`;

export function withWiseCursorExecutePreamble(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  if (!trimmed) return WISE_CURSOR_SDK_EXECUTE_PREAMBLE.trim();
  if (trimmed.startsWith("[Wise Cursor SDK]")) return trimmed;
  return `${WISE_CURSOR_SDK_EXECUTE_PREAMBLE}${trimmed}`;
}
