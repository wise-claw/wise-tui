import type { editor, IRange } from "monaco-editor";
import type { languages } from "monaco-editor";
import { resolveMonacoRepositoryRelativeImportCandidates } from "../services/monacoTypeScriptEnvironment";
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
        const links = findImportLinks(model.getValue()).map((item) => ({
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

    const links = findImportLinks(model.getValue());
    const hit = hitTest(links, range.startLineNumber, range.startColumn);
    if (!hit) return;

    event.event.preventDefault();
    event.event.stopPropagation();

    const candidates = resolveMonacoRepositoryRelativeImportCandidates(
      fromRelativePath,
      hit.specifier,
    );

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
