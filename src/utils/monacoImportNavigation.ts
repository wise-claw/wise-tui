import type { editor, IRange } from "monaco-editor";
import type { languages } from "monaco-editor";
import {
  isScopePackageSpecifier,
  resolveMonacoRepositoryRelativeImportCandidates,
  resolvePathClickCandidates,
  resolveScopePackageCandidates,
} from "../services/monacoTypeScriptEnvironment";
import { readProjectRelativeFile } from "../services/projectRelativeFiles";

interface ImportNavigationOptions {
  repositoryPath: string;
  /** 当前文件的仓库相对路径，用于解析相对 import/export。 */
  fromRelativePath: string;
  /** 导航到目标文件。 */
  onNavigate: (relativePath: string) => void;
}

/** Monaco 运行时实例的部分类型，用于注册 link provider 与事件。 */
interface MonacoRuntime {
  languages: {
    registerLinkProvider(
      languageSelector: readonly string[],
      provider: languages.LinkProvider,
    ): { dispose(): void };
  };
  editor: {
    MouseTargetType: { CONTENT_TEXT: number };
  };
}

interface ImportLink {
  range: IRange;
  specifier: string;
}

export interface LoosePathLink {
  range: IRange;
  specifier: string;
}

type ClickableLink = (ImportLink & { kind: "import" }) | (LoosePathLink & { kind: "loose" });

/**
 * 匹配 import/export from 以及 side-effect import 的 specifier 路径。
 * 分组：
 *   1: 引号字符（" 或 '）
 *   2: specifier 内容（不含引号）
 */
const IMPORT_SPECIFIER_RE =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?(["'])([^"']+?)\1/g;

/**
 * 从文本中 offset 计算出 Monaco 的 {line, column}。
 */
function offsetToPosition(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      line++;
      lastNewline = i + 1;
    }
  }
  return { line, column: offset - lastNewline + 1 };
}

/**
 * 扫描文本，找出所有 import/export 路径字符串的位置与内容。
 */
function findImportLinks(text: string): ImportLink[] {
  const result: ImportLink[] = [];
  let match: RegExpExecArray | null;
  while ((match = IMPORT_SPECIFIER_RE.exec(text)) !== null) {
    const quote = match[1]!;
    const specifier = match[2]!;
    const matchStr = match[0];
    // specifier 在 matchStr 中的起始位置
    const specInMatch = matchStr.indexOf(quote + specifier + quote);
    const specOffset = match.index + specInMatch + quote.length;
    const specEnd = specOffset + specifier.length;

    result.push({
      range: {
        startLineNumber: offsetToPosition(text, specOffset).line,
        startColumn: offsetToPosition(text, specOffset).column,
        endLineNumber: offsetToPosition(text, specEnd).line,
        endColumn: offsetToPosition(text, specEnd).column,
      },
      specifier,
    });
  }
  return result;
}

/**
 * 检查点击位置是否落在某个 ImportLink 的 range 内。
 */
function hitTest(links: ImportLink[], line: number, column: number): ImportLink | undefined {
  return links.find(
    (l) =>
      line >= l.range.startLineNumber &&
      line <= l.range.endLineNumber &&
      (line !== l.range.startLineNumber || column >= l.range.startColumn) &&
      (line !== l.range.endLineNumber || column <= l.range.endColumn),
  );
}

/**
 * 识别文本中的「裸路径」与「裸 @ 路径」作为可点击跳转候选。
 *
 * 触发形态：
 *   - `@<token>` ：仓库相对 `@` mention 写法（无引号）；
 *   - `./foo`、`../foo`：相对裸路径；
 *   - `foo/bar`、`foo/bar/baz.ts`：含斜杠的绝对裸路径（强制至少一段斜杠，避免误命中普通单词）。
 *
 * 边界规则：
 *   - 左侧不能紧贴 `\w`、`.`、`/`、`@`；
 *   - 右侧不能紧贴 `\w`、`.`、`/`（避免命中 `foo.tsx` 中的 `tsx` 之类）；
 *   - 右侧遇到 `(`、`{`、`[`、`` ` ``、`"`、`'`、`:` 立即终止；
 *   - 跳过 http://、https://、file://、monaco:// 等 URL 协议。
 *   - 不跨行。
 */
const LOOSE_PATH_RE =
  /(?<![\w./@])(?:@[A-Za-z0-9_./-]+|\.{0,2}\/[A-Za-z0-9_./-]+|[A-Za-z0-9_][\w-]*\/[A-Za-z0-9_./-]+)(?![\w./])/g;

const URL_PREFIX_RE = /^(?:https?:|file:|monaco:)/i;
// 排除「行内包含 URL」整段：扫描行内 `https?://`、`file://`、`monaco://` 起止范围，
// 在 findLoosePathLinks 内对匹配项做整段跳过。
const URL_INLINE_RE =
  /(?:https?:\/\/|file:\/\/|monaco:\/\/)[^\s"'<>)}\]]+/g;
// import/export/require 整句：从 `import`/`require` 关键字起，到下一行/下一个分号为止，
// 整段不再做 loose path 命中（该范围由 findImportLinks 接管）。
const IMPORT_STATEMENT_RE =
  /\b(?:import|require)\s[^;]*?["'][^"']+["'][^;]*;?/g;
// `from "x"` / `from 'x'`：上一句排除 loose path 的最稳判别。

/**
 * 从一行/全文中找出所有 loose path 链接。
 *
 * @param text  全文（不要求按行分割，offsetToPosition 内部按行处理）
 * @param startOffset 起始 offset（用于增量扫描；目前固定为 0）
 */
/**
 * 导出包装：仅供测试；保持生产路径用内部未导出函数。
 */
export function findLoosePathLinks(text: string): LoosePathLink[] {
  return findLoosePathLinksImpl(text, 0);
}

function findLoosePathLinksImpl(text: string, startOffset = 0): LoosePathLink[] {
  const result: LoosePathLink[] = [];

  // 1) 收集整段需要排除的 offset 范围（URL、import/export 整句）
  const excludedRanges: Array<{ from: number; to: number }> = [];
  URL_INLINE_RE.lastIndex = startOffset;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = URL_INLINE_RE.exec(text)) !== null) {
    excludedRanges.push({ from: urlMatch.index, to: urlMatch.index + urlMatch[0].length });
  }
  IMPORT_STATEMENT_RE.lastIndex = startOffset;
  let impMatch: RegExpExecArray | null;
  while ((impMatch = IMPORT_STATEMENT_RE.exec(text)) !== null) {
    excludedRanges.push({ from: impMatch.index, to: impMatch.index + impMatch[0].length });
  }
  const isExcluded = (offset: number) =>
    excludedRanges.some((range) => offset >= range.from && offset < range.to);

  // 2) 主扫描
  LOOSE_PATH_RE.lastIndex = startOffset;
  let match: RegExpExecArray | null;
  while ((match = LOOSE_PATH_RE.exec(text)) !== null) {
    const specifier = match[0];
    const specEnd = match.index + specifier.length;

    // URL 整段已排除：但 specifier 头部仍可能是 `//example.com/foo` 之类，正面挡一次
    if (URL_PREFIX_RE.test(specifier) || specifier.startsWith("//")) continue;
    if (isExcluded(match.index)) continue;

    result.push({
      range: {
        startLineNumber: offsetToPosition(text, match.index).line,
        startColumn: offsetToPosition(text, match.index).column,
        endLineNumber: offsetToPosition(text, specEnd).line,
        endColumn: offsetToPosition(text, specEnd).column,
      },
      specifier,
    });
  }
  return result;
}

/**
 * 合并 import link 与 loose link，import 优先。
 */
function hitTestAll(
  importLinks: ImportLink[],
  looseLinks: LoosePathLink[],
  line: number,
  column: number,
): ClickableLink | undefined {
  const importHit = hitTest(importLinks, line, column);
  if (importHit) return { ...importHit, kind: "import" };
  const looseHit = hitTest(looseLinks, line, column);
  if (looseHit) return { ...looseHit, kind: "loose" };
  return undefined;
}

/**
 * 在 Monaco 编辑器中注册 import/export 路径链接提供与导航。
 *
 * - 通过 `LinkProvider` 让 import/export from 的路径字符串在按住 Ctrl/Cmd
 *   时显示下划线与手型光标。
 * - 监听 `onMouseDown` 在 Ctrl/Cmd+Click 时解析 specifier 并打开目标文件。
 *
 * 返回一个 `IDisposable`，组件卸载时应调用 `dispose()` 清理。
 */
export function registerImportNavigation(
  monaco: MonacoRuntime,
  editor: editor.IStandaloneCodeEditor,
  options: ImportNavigationOptions,
): { dispose: () => void } {
  const disposables: { dispose: () => void }[] = [];
  const { repositoryPath, fromRelativePath, onNavigate } = options;

  // ── LinkProvider ──
  const linkProviderDisposable = monaco.languages.registerLinkProvider(
    ["typescript", "javascript"],
    {
      provideLinks: (model) => {
        const currentUri = editor.getModel()?.uri;
        if (!currentUri || model.uri.toString() !== currentUri.toString()) {
          return { links: [] };
        }
        const text = model.getValue();
        const importLinks = findImportLinks(text);
        const looseLinks = findLoosePathLinks(text);
        const links = [...importLinks, ...looseLinks].map((item) => ({
          range: item.range,
          // 不设 url —— 由 onMouseDown 处理导航
        }));
        return { links };
      },
    },
  );
  disposables.push(linkProviderDisposable);

  // ── Ctrl/Cmd+Click 导航 ──
  const mouseDownDisposable = editor.onMouseDown((event) => {
    // 只响应 Ctrl/Cmd+Click
    if (!event.event.ctrlKey && !event.event.metaKey) return;
    if (!repositoryPath) return;

    const target = event.target;
    if (target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return;

    const range = target.range;
    if (!range) return;

    const model = editor.getModel();
    if (!model) return;

    const text = model.getValue();
    const importLinks = findImportLinks(text);
    const looseLinks = findLoosePathLinks(text);
    const hit = hitTestAll(importLinks, looseLinks, range.startLineNumber, range.startColumn);
    if (!hit) return;

    event.event.preventDefault();
    event.event.stopPropagation();

    const candidates = (() => {
      if (hit.kind === "import") {
        const repoRelative = resolveMonacoRepositoryRelativeImportCandidates(
          fromRelativePath,
          hit.specifier,
        );
        // npm scope 包（`@scope/pkg[/subpath]`）：先尝试仓库内 npm 模块真实路径，
        // 失败后再退化到 fromDir 拼接的相对路径（兼容 monorepo alias 等罕见配置）。
        if (isScopePackageSpecifier(hit.specifier)) {
          return [
            ...resolveScopePackageCandidates(hit.specifier),
            ...repoRelative,
          ];
        }
        return repoRelative;
      }
      return resolvePathClickCandidates(fromRelativePath, hit.specifier);
    })();

    // 依次尝试候选路径，找到第一个存在的文件
    void (async () => {
      for (const candidate of candidates) {
        try {
          await readProjectRelativeFile(repositoryPath, candidate);
          onNavigate(candidate);
          return;
        } catch {
          continue;
        }
      }
    })();
  });
  disposables.push(mouseDownDisposable);

  return {
    dispose: () => {
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          // 安全清理
        }
      }
    },
  };
}
