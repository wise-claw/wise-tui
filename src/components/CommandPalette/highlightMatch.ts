/**
 * 文件内容搜索结果预览的匹配高亮工具。
 *
 * 后端 `search_repository_file_contents` 在 `RepositoryFileContentMatch` 上返回
 * `matchStart`/`matchEnd`（preview 内的 char 偏移，与 Rust `chars()` 计数一致）。
 * 本模块把 preview 拆成 `before / match / after` 三段，供 React 渲染 `<mark>` 高亮，
 * 由 React 自动转义字符串子节点，避免来自文件内容的不可信 preview 触发 XSS。
 */

export interface HighlightedSegments {
  before: string;
  match: string;
  after: string;
}

/**
 * 把 `preview` 按匹配区间拆成三段。
 *
 * 优先使用后端返回的 char 偏移（`matchStart`/`matchEnd`）；缺失或越界时回退到
 * 前端按 `query` 大小写不敏感查找。始终按 code point（`Array.from`）切分，
 * 与 Rust `chars()` 对齐，避免 emoji 等 astral 字符偏移错位。
 *
 * 返回 `null` 表示无可高亮匹配，调用方应原样渲染 `preview`。
 */
export function highlightMatchSegments(
  preview: string,
  matchStart: number | null | undefined,
  matchEnd: number | null | undefined,
  query: string,
): HighlightedSegments | null {
  if (!preview) return null;
  const chars = Array.from(preview);
  const len = chars.length;

  let start: number | null = null;
  let end: number | null = null;
  if (
    typeof matchStart === "number" &&
    typeof matchEnd === "number" &&
    Number.isFinite(matchStart) &&
    Number.isFinite(matchEnd) &&
    matchStart >= 0 &&
    matchEnd > matchStart &&
    matchEnd <= len
  ) {
    start = matchStart;
    end = matchEnd;
  }

  // 后端偏移不可用时，回退到前端按 query 大小写不敏感查找（code point 偏移）。
  if (start === null) {
    const q = (query ?? "").trim();
    if (!q) return null;
    const lowerPreview = preview.toLowerCase();
    const idx = lowerPreview.indexOf(q.toLowerCase());
    if (idx < 0) return null;
    // `idx` 是 UTF-16 code unit 偏移，转成 code point 偏移以与后端对齐。
    start = Array.from(preview.substring(0, idx)).length;
    end = Math.min(len, start + Array.from(q).length);
    if (end <= start) return null;
  }

  if (start === null || end === null) return null;
  return {
    before: chars.slice(0, start).join(""),
    match: chars.slice(start, end).join(""),
    after: chars.slice(end).join(""),
  };
}
