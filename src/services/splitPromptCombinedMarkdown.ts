import type { SplitPromptTemplateLayers } from "../types/splitPromptLayers";

/** 提示词面板单一 Milkdown 正文中的章节标题（与持久化的三层字段对应）。 */
export const SPLIT_PROMPT_COMBINED_HEADINGS = {
  system: "# 系统与角色",
  strategy: "# 仓库策略",
  user: "# 用户模板",
} as const;

/**
 * 将分层稿展开为一段 Markdown，供单一编辑器展示/编辑。
 * 仅输出非空层，便于与旧数据（只填了某一层的）互操作。
 * 正文不做 trim/trimEnd，避免尾随空格经父状态回灌后与 Milkdown 不一致触发整编辑器重挂载。
 */
export function splitPromptLayersToCombinedMarkdown(layers: SplitPromptTemplateLayers): string {
  const parts: string[] = [];
  const sNorm = layers.systemBody.replace(/\r\n/g, "\n");
  const rNorm = layers.repoStrategyBody.replace(/\r\n/g, "\n");
  const uNorm = layers.userBody.replace(/\r\n/g, "\n");
  const sNonEmpty = layers.systemBody.trim().length > 0;
  const rNonEmpty = layers.repoStrategyBody.trim().length > 0;
  const uNonEmpty = layers.userBody.trim().length > 0;
  if (sNonEmpty) parts.push(`${SPLIT_PROMPT_COMBINED_HEADINGS.system}\n\n${sNorm}`);
  if (rNonEmpty) parts.push(`${SPLIT_PROMPT_COMBINED_HEADINGS.strategy}\n\n${rNorm}`);
  if (uNonEmpty) {
    if (!sNonEmpty && !rNonEmpty) {
      return uNorm;
    }
    parts.push(`${SPLIT_PROMPT_COMBINED_HEADINGS.user}\n\n${uNorm}`);
  }
  return parts.join("\n\n");
}

export type SplitPromptBodiesOnly = Pick<
  SplitPromptTemplateLayers,
  "systemBody" | "repoStrategyBody" | "userBody"
>;

/**
 * 从单一 Markdown 解析回三层正文。若正文中未出现任一标准章节标题，则整段写入 `userBody`（兼容旧稿与纯用户层）。
 */
export function combinedMarkdownToSplitPromptBodies(markdown: string): SplitPromptBodiesOnly {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const { system: Hs, strategy: Hr, user: Hu } = SPLIT_PROMPT_COMBINED_HEADINGS;

  type Kind = "none" | "system" | "strategy" | "user";
  let kind: Kind = "none";
  let hits = 0;
  const orphan: string[] = [];
  const buf = { system: [] as string[], strategy: [] as string[], user: [] as string[] };

  function lineIsHeading(trimmed: string): boolean {
    return trimmed === Hs || trimmed === Hr || trimmed === Hu;
  }

  for (const line of lines) {
    const t = line.trim();
    if (t === Hs) {
      if (orphan.length) {
        buf.system.push(orphan.join("\n"));
        orphan.length = 0;
      }
      kind = "system";
      hits += 1;
      continue;
    }
    if (t === Hr) {
      if (orphan.length) {
        buf.strategy.push(orphan.join("\n"));
        orphan.length = 0;
      }
      kind = "strategy";
      hits += 1;
      continue;
    }
    if (t === Hu) {
      if (orphan.length) {
        buf.user.push(orphan.join("\n"));
        orphan.length = 0;
      }
      kind = "user";
      hits += 1;
      continue;
    }
    if (kind === "none") {
      if (!lineIsHeading(t)) orphan.push(line);
      continue;
    }
    if (kind === "system") buf.system.push(line);
    else if (kind === "strategy") buf.strategy.push(line);
    else buf.user.push(line);
  }

  if (hits === 0) {
    return {
      systemBody: "",
      repoStrategyBody: "",
      userBody: normalized,
    };
  }

  if (orphan.length) {
    buf.user.push(orphan.join("\n"));
  }

  return {
    systemBody: buf.system.join("\n"),
    repoStrategyBody: buf.strategy.join("\n"),
    userBody: buf.user.join("\n"),
  };
}
