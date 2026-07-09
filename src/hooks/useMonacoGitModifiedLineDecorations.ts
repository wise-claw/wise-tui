import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { gitShowRevision } from "../services/git";
import {
  classifyLineChanges,
  monacoLineChangeGutterClassName,
  monacoLineChangeOverviewColor,
} from "../utils/monacoGitModifiedLineDecorations";
import { shouldDeferNonCriticalUiWork } from "../utils/uiWorkDefer";

/**
 * `scheduleRefresh` 内 raf 回调每帧轮询：是否允许执行本次 gutter 装饰刷新。
 *
 * 设计上必须满足"不应静默丢弃"：当主线程拥塞或 composer 正在交互时，gutter 装饰
 * 的 diff 计算可推迟到下个空闲帧，但仍要排到队里，不能整段 return 不调度。
 * 唯一允许「现在执行」的硬条件是 `hasFocus || !shouldDefer`：
 *   - 失焦但非 defer → 立即跑（编辑区不在前台但用户可能仍在打字/改文档）
 *   - 失焦 + defer → 推迟，等状态恢复
 *   - 聚焦 + defer → 立即跑（用户当前正看着编辑器，装饰延迟会很明显）
 *
 * 抽出为纯函数便于单测覆盖（React 端到端测试需要 happy-dom + react-test-renderer + fake raf，
 * 成本高；纯函数断言能把"不在 defer 静默丢"这个不变量锁住）。
 */
export function shouldRunDecorationRefreshNow(
  shouldDefer: boolean,
  hasFocus: boolean,
): boolean {
  return hasFocus || !shouldDefer;
}

/**
 * `refreshFromEditor` 在 baseline vs current 比对后的下一步决策：
 * - `local`：当前内容 ≠ baseline（本地有未保存改动），用 baseline 对比画 modified/added。
 * - `clean`：当前内容 === baseline（本地干净），先清掉本地装饰，再异步读 HEAD 比对。
 * - `skip`：模型不存在（编辑器卸载中），不操作。
 */
export type DirtyDiffRefreshAction =
  | { kind: "skip" }
  | { kind: "local"; baseline: string; current: string }
  | { kind: "clean"; current: string };

export function pickDirtyDiffRefreshAction(
  args: { baseline: string; current: string | null },
): DirtyDiffRefreshAction {
  const { baseline, current } = args;
  if (current == null) return { kind: "skip" };
  if (current !== baseline) return { kind: "local", baseline, current };
  return { kind: "clean", current };
}

function applyLineChangeDecorations(
  editor: MonacoEditorNamespace.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  base: string,
  current: string,
  decorationRef: { current: MonacoEditorNamespace.IEditorDecorationsCollection | null },
): void {
  const changes = classifyLineChanges(base, current);
  decorationRef.current?.clear();
  if (changes.length === 0) {
    decorationRef.current = null;
    return;
  }
  decorationRef.current = editor.createDecorationsCollection(
    changes.map(({ lineNumber, kind }) => ({
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: monacoLineChangeGutterClassName(kind),
        overviewRuler: {
          color: monacoLineChangeOverviewColor(kind),
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    })),
  );
}

export function useMonacoGitModifiedLineDecorations(args: {
  editor: MonacoEditorNamespace.IStandaloneCodeEditor | null;
  monaco: typeof Monaco | null;
  repositoryPath: string | null | undefined;
  relativePath: string | null | undefined;
  /** 已保存/打开时的基准内容（通常是 tab.originalContent）。 */
  baselineContent: string | null | undefined;
  enabled: boolean;
  gitStatusRevision: number;
}): void {
  const decorationRef = useRef<MonacoEditorNamespace.IEditorDecorationsCollection | null>(null);
  const gitLoadGenerationRef = useRef(0);

  useEffect(() => {
    decorationRef.current?.clear();
    decorationRef.current = null;

    const { editor, monaco, repositoryPath, relativePath, baselineContent, enabled } = args;
    if (!enabled || !editor || !monaco || !relativePath?.trim() || baselineContent == null) {
      return;
    }

    const repoPath = repositoryPath?.trim() ?? "";
    const filePath = relativePath.trim();
    const baseline = baselineContent;
    let cancelled = false;
    let rafId = 0;

    const refreshFromEditor = () => {
      if (cancelled) return;
      const model = editor.getModel();
      const action = pickDirtyDiffRefreshAction({
        baseline,
        current: model ? model.getValue() : null,
      });
      if (action.kind === "skip") return;
      if (action.kind === "local") {
        applyLineChangeDecorations(editor, monaco, action.baseline, action.current, decorationRef);
        return;
      }
      decorationRef.current?.clear();
      decorationRef.current = null;
      void refreshGitDecorations();
    };

    const refreshGitDecorations = async () => {
      if (!repoPath) return;
      const loadGeneration = ++gitLoadGenerationRef.current;
      try {
        const headContent = await gitShowRevision(repoPath, `HEAD:${filePath}`);
        if (cancelled || loadGeneration !== gitLoadGenerationRef.current) return;
        const model = editor.getModel();
        if (!model) return;
        applyLineChangeDecorations(editor, monaco, headContent, model.getValue(), decorationRef);
      } catch {
        if (!cancelled) {
          decorationRef.current?.clear();
          decorationRef.current = null;
        }
      }
    };

    // 编辑器失焦 + 主线程拥塞/composer 交互中时，整段直接 return 会让 gutter 装饰
    // 在用户切回编辑器前完全不刷新，表现为「+/- 行数有时不自动更新」。
    // 这里的回调本身已经走 raf 节流 + 轻量 diff，无理由在 defer 期间静默丢弃：
    // 改成「raf 内若仍 defer 则再排一帧」，拥塞/composer 结束后自然消费掉积压的 last。
    // 决策收敛到 shouldRunDecorationRefreshNow 纯函数，便于单测断言"不静默丢"。
    const scheduleRefresh = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      const tick = () => {
        if (cancelled) {
          rafId = 0;
          return;
        }
        if (!shouldRunDecorationRefreshNow(shouldDeferNonCriticalUiWork(), editor.hasTextFocus())) {
          rafId = window.requestAnimationFrame(tick);
          return;
        }
        rafId = 0;
        refreshFromEditor();
      };
      rafId = window.requestAnimationFrame(tick);
    };

    const contentListener = editor.onDidChangeModelContent(scheduleRefresh);
    // 首次强制执行：onDidChangeModelContent 注册时 model 已有内容，
    // 不会有 content change 事件来触发，必须手动调用一次。
    refreshFromEditor();

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      contentListener.dispose();
      decorationRef.current?.clear();
      decorationRef.current = null;
    };
  }, [
    args.editor,
    args.monaco,
    args.repositoryPath,
    args.relativePath,
    args.baselineContent,
    args.enabled,
    args.gitStatusRevision,
  ]);
}
