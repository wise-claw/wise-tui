/**
 * 钉钉单聊 Markdown 正文：去掉 Claude Code 流里常见的扩展思考标记、Hook/CLI 诊断行等，
 * 避免把 stop hook error、SubagentStop hook 等噪音发给钉钉。
 */
export function stripAssistantStreamNoiseForDingTalkExport(text: string): string {
  let s = text.trim();
  if (!s) return "";
  // Claude extended thinking 等流式标记（可能出现在 raw preview / 缓冲合并结果中）
  s = s.replace(/<\|(?:begin|end)_of_[^\|]+\|>/gi, "");
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  s = s.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  s = s.replace(/<antThinking>[\s\S]*?<\/antThinking>/gi, "");
  s = stripDingTalkTrailingHookSuffix(s);
  s = stripDingTalkHookAndCliDiagnosticLines(s);
  s = dropDingTalkHookOnlyParagraphs(s);
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

/** 行尾直接拼接的 Hook 诊断（无换行）常见于流式缓冲尾部 */
function stripDingTalkTrailingHookSuffix(s: string): string {
  let t = s;
  for (let i = 0; i < 4; i += 1) {
    const next = t
      .replace(/\s*(?:SubagentStop|subagentstop)\s+hook[\s\S]*$/i, "")
      .replace(/\s*(?:Stop|stop)\s+hook[\s\S]*$/i, "")
      .replace(/\s*(?:Hook|hook)\s+error\s+occurred[\s\S]*$/i, "")
      .replace(/\s*(?:Stop|stop)\s+hook\s+error[\s\S]*$/i, "")
      .trim();
    if (next === t) break;
    t = next;
  }
  return t.trim();
}

function isDingTalkHookOrCliNoiseLine(trimmed: string): boolean {
  const t = trimmed;
  if (!t) return false;
  const low = t.toLowerCase();
  if (/^(?:stop|subagentstop)\s+hook\b/.test(low)) return true;
  if (/^pretooluse\s+hook\b/.test(low)) return true;
  if (/^posttooluse\s+hook\b/.test(low)) return true;
  if (/\bhook\s+error\s+occurred\b/i.test(t) && t.length < 400) return true;
  if (/\bstop\s+hook\s+error\b/i.test(t) && t.length < 400) return true;
  if (/^claude\s+hook\s+错误[:：]/i.test(t)) return true;
  if (/^claude\s+系统错误[:：]/i.test(t)) return true;
  if (/^hook\s+response\s+error\b/i.test(low)) return true;
  if (/^…\[已省略/.test(t) || /已省略较早前\s*\d+\s*字/.test(t)) return true;
  return false;
}

/** 按行剔除 Hook / 子进程 stop 等 CLI 噪音 */
function stripDingTalkHookAndCliDiagnosticLines(s: string): string {
  const lines = s.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (isDingTalkHookOrCliNoiseLine(line.trim())) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

/** 剔除「整段每行都是 hook 噪音」的段落（双换行分段） */
function dropDingTalkHookOnlyParagraphs(s: string): string {
  const paras = s.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
  const kept = paras.filter((p) => {
    const lines = p.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (lines.length === 0) return false;
    return !lines.every((ln) => isDingTalkHookOrCliNoiseLine(ln));
  });
  return kept.join("\n\n").trim();
}
