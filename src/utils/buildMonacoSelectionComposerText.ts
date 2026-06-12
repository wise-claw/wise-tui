export interface MonacoSelectionComposerTextInput {
  relativePath: string;
  language: string | null | undefined;
  selectedText: string;
  startLine: number;
  endLine: number;
}

/** 将 Monaco 选区格式化为填入 Composer 的 Markdown 片段（含文件行号与围栏代码块）。 */
export function buildMonacoSelectionComposerText(input: MonacoSelectionComposerTextInput): string {
  const relativePath = input.relativePath.trim();
  const selectedText = input.selectedText.replace(/\r\n/g, "\n");
  if (!relativePath || !selectedText.trim()) return "";

  const startLine = Math.max(1, Math.floor(input.startLine));
  const endLine = Math.max(startLine, Math.floor(input.endLine));
  const lineRef =
    startLine === endLine ? `${relativePath}:${startLine}` : `${relativePath}:${startLine}-${endLine}`;

  const lang = normalizeFenceLanguage(input.language);
  const fenceOpen = lang ? `\`\`\`${lang}\n` : "```\n";
  return `@${lineRef}\n${fenceOpen}${selectedText}\n\`\`\``;
}

function normalizeFenceLanguage(language: string | null | undefined): string {
  const raw = (language ?? "").trim().toLowerCase();
  if (!raw || raw === "plaintext" || raw === "text") return "";
  return raw;
}
