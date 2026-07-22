/**
 * Monaco import/路径/类型名点击：规则解析失败后的搜索 + AI 兜底（纯函数 + prompt）。
 *
 * 流程约定（由 service 编排）：仓库文件搜索 →（可选）单命中直跳 → 多候选时 LLM 择一。
 */

export type ImportNavigationResolveKind = "import" | "loose" | "symbol";

export interface ImportNavigationAiPromptInput {
  fromRelativePath: string;
  specifier: string;
  kind: ImportNavigationResolveKind;
  lineContext: string;
  candidates: readonly string[];
}

/** 常见源码后缀：用于文件名主干比对（含 Java/Kotlin 等）。 */
const SOURCE_BASENAME_EXT_RE =
  /\.(?:d\.)?(?:tsx?|jsx?|mts|cts|mjs|cjs|java|kt|kts|cs|go|rs|py|rb|php|scala|groovy|swift)$/i;

/** 明显不应作为「类型跳转」的关键字（小写比对）。 */
const NON_NAVIGABLE_KEYWORDS = new Set([
  "abstract",
  "assert",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "final",
  "finally",
  "float",
  "for",
  "function",
  "goto",
  "if",
  "implements",
  "import",
  "instanceof",
  "int",
  "interface",
  "long",
  "native",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "static",
  "strictfp",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "volatile",
  "while",
  "with",
  "yield",
  "let",
  "await",
  "async",
  "from",
  "type",
  "namespace",
  "module",
  "declare",
  "readonly",
  "override",
  "record",
  "sealed",
  "permits",
  "when",
]);

/**
 * 是否把标识符当作可 Cmd/Ctrl+Click 的类型名。
 * 默认要求 PascalCase（如 PayAppService），避免普通变量/关键字误触。
 */
export function isNavigableTypeIdentifier(word: string): boolean {
  const token = word.trim();
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(token)) return false;
  if (token.length < 2) return false;
  if (NON_NAVIGABLE_KEYWORDS.has(token.toLowerCase())) return false;
  return true;
}

/**
 * 从一行文本与 1-based column 取出光标处标识符（Monaco 列语义）。
 */
export function extractIdentifierAtColumn(
  lineContent: string,
  column: number,
): { word: string; startColumn: number; endColumn: number } | null {
  if (!lineContent || column < 1) return null;
  const index = Math.min(Math.max(column - 1, 0), lineContent.length);
  const isIdentChar = (ch: string | undefined) =>
    Boolean(ch && /[A-Za-z0-9_$]/.test(ch));

  if (!isIdentChar(lineContent[index]) && !isIdentChar(lineContent[index - 1])) {
    return null;
  }

  let start = index;
  if (!isIdentChar(lineContent[start]) && start > 0) start -= 1;
  while (start > 0 && isIdentChar(lineContent[start - 1])) start -= 1;

  let end = start;
  while (end < lineContent.length && isIdentChar(lineContent[end])) end += 1;

  const word = lineContent.slice(start, end);
  if (!word) return null;
  return {
    word,
    startColumn: start + 1,
    endColumn: end + 1,
  };
}

/**
 * 扫描文本中的 PascalCase 类型名，供 LinkProvider 显示 Cmd/Ctrl 悬停下划线。
 */
export function findNavigableTypeIdentifierLinks(
  text: string,
): Array<{
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  word: string;
}> {
  const result: Array<{
    range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
    word: string;
  }> = [];
  const re = /\b([A-Z][A-Za-z0-9_]*)\b/g;
  let match: RegExpExecArray | null;
  let line = 1;
  let lineStart = 0;
  let cursor = 0;
  while ((match = re.exec(text)) !== null) {
    const word = match[1]!;
    if (!isNavigableTypeIdentifier(word)) continue;
    while (cursor < match.index) {
      if (text[cursor] === "\n") {
        line += 1;
        lineStart = cursor + 1;
      }
      cursor += 1;
    }
    const startColumn = match.index - lineStart + 1;
    const endColumn = startColumn + word.length;
    result.push({
      word,
      range: {
        startLineNumber: line,
        startColumn,
        endLineNumber: line,
        endColumn,
      },
    });
  }
  return result;
}

/** 从点击到的 specifier 抽出适合 `searchRepositoryFiles` 的短查询（文件名主干）。 */
export function buildImportNavigationSearchQuery(specifier: string): string {
  let token = specifier.trim().replace(/^["']|["']$/g, "");
  if (!token) return "";
  token = token.replace(/^(\.\.?\/)+/, "");
  token = token.replace(/^@+/, "");
  const parts = token.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1]!;
  const withoutExt = last.replace(SOURCE_BASENAME_EXT_RE, "");
  return (withoutExt || last).trim();
}

function fileStem(fileName: string): string {
  return fileName.replace(SOURCE_BASENAME_EXT_RE, "");
}

/** 在搜索命中中挑「文件名主干完全一致」的唯一文件，可跳过 LLM。 */
export function pickExactBasenameSearchHit(
  query: string,
  hits: readonly { path: string; isDir: boolean }[],
): string | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const matches = hits
    .filter((hit) => !hit.isDir)
    .map((hit) => hit.path.replace(/\\/g, "/").replace(/^\/+/, ""))
    .filter((path) => {
      const base = path.split("/").pop() ?? "";
      const stem = fileStem(base);
      return stem.toLowerCase() === needle || base.toLowerCase() === needle;
    });
  const unique = Array.from(new Set(matches));
  return unique.length === 1 ? unique[0]! : null;
}

/** 截断并去重搜索命中，供 AI 选择。 */
export function takeImportNavigationSearchCandidates(
  hits: readonly { path: string; isDir: boolean }[],
  limit = 20,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hit of hits) {
    if (hit.isDir) continue;
    const path = hit.path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildImportNavigationAiPrompt(input: ImportNavigationAiPromptInput): string {
  const fromRelativePath = input.fromRelativePath.trim() || "(unknown)";
  const specifier = input.specifier.trim() || "(empty)";
  const lineContext = input.lineContext.replace(/\s+/g, " ").trim() || "(none)";
  const candidates = input.candidates.map((item) => item.trim()).filter(Boolean);
  const kindHint =
    input.kind === "symbol"
      ? "用户点击的是类型/类名标识符（非路径字符串），请优先选择同名源文件（如 Foo.java / Foo.ts）。"
      : "用户点击的是路径引用，请选出最可能的目标文件。";

  return [
    "你是代码仓库路径解析助手。用户 Cmd/Ctrl+点击了一个无法按常规规则直接打开的引用。",
    kindHint,
    "规则：",
    "1. 只输出一行：候选列表中的完整相对路径，或 NONE",
    "2. 不要 Markdown，不要解释，不要引号包裹",
    "3. 若无法判断则输出 NONE",
    "",
    `当前文件：${fromRelativePath}`,
    `点击引用：${specifier}`,
    `引用类型：${input.kind}`,
    `上下文行：${lineContext}`,
    "",
    "候选文件：",
    ...candidates.map((path, index) => `${index + 1}. ${path}`),
  ].join("\n");
}

/**
 * 解析 LLM 输出：必须落在 allowed 内（大小写敏感优先，其次大小写不敏感）。
 */
export function parseImportNavigationAiPath(
  raw: string,
  allowed: readonly string[],
): string | null {
  if (allowed.length === 0) return null;

  let text = raw.trim();
  if (!text) return null;
  text = text.replace(/^```[a-zA-Z]*\s*/g, "").replace(/```\s*$/g, "").trim();
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  if (!firstLine || /^none$/i.test(firstLine)) return null;

  let path = firstLine
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\d+[\.)]\s*/, "")
    .trim();
  path = path.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!path || /^none$/i.test(path)) return null;

  const exact = allowed.find((item) => item === path);
  if (exact) return exact;

  const lower = path.toLowerCase();
  const ci = allowed.find((item) => item.toLowerCase() === lower);
  if (ci) return ci;

  // 模型偶发带仓库名前缀或多余段：允许「候选以输出结尾」或「输出以候选结尾」
  const suffix = allowed.find(
    (item) => item.endsWith(`/${path}`) || path.endsWith(`/${item}`) || item.endsWith(path),
  );
  return suffix ?? null;
}
