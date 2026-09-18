export function isCanvasDocumentPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export interface ConversationCanvasArtifact {
  title: string;
  path: string;
  content: string;
}

/** Only complete, explicitly browser-native fences are executed. Prose remains a document. */
export function conversationCanvasArtifacts(source: string): ConversationCanvasArtifact[] {
  const artifacts: ConversationCanvasArtifact[] = [{ title: "方案全文", path: "方案.md", content: source }];
  const lines = source.split("\n");
  let fence: { marker: string; length: number; lang: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (!fence) {
      const open = /^ {0,3}(`{3,}|~{3,})\s*([\w-]*)[^\n]*$/.exec(line);
      if (open) fence = { marker: open[1][0], length: open[1].length, lang: open[2].toLowerCase(), lines: [] };
      continue;
    }
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (close && close[1][0] === fence.marker && close[1].length >= fence.length) {
      if (["html", "htm", "svg"].includes(fence.lang) && fence.lines.join("\n").trim() && artifacts.length <= 12) {
        const index = artifacts.length;
        artifacts.push({ title: `${fence.lang === "svg" ? "设计图" : "页面"} ${index}`, path: `画布-${index}.${fence.lang}`, content: fence.lines.join("\n") });
      }
      fence = null;
    } else fence.lines.push(line);
  }
  return artifacts;
}
