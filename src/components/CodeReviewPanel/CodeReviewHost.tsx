import { useEffect, useState } from "react";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import {
  WISE_UI_EVENT_OPEN_CODE_REVIEW,
  type CodeReviewFocusFinding,
  type OpenCodeReviewDetail,
} from "../../constants/workflowUiEvents";
import { publishCodeReviewFindings } from "../../stores/codeReviewFindingsStore";
import type { CodeReviewRun, CodeReviewScope } from "../../types/codeReview";
import type { GitPanelOpenFileOptions } from "../GitPanel/types";
import { CodeReviewDrawer } from "./CodeReviewDrawer";

export interface CodeReviewHostProps {
  /** Fallback repo when event omits path (rare). */
  defaultRepositoryPath?: string | null;
  defaultRepositoryName?: string | null;
  defaultExecutionEngine?: SessionExecutionEngine | null;
  onOpenFile?: (
    path: string,
    options?: GitPanelOpenFileOptions & { repositoryPath?: string },
  ) => void;
}

/**
 * App-level host for the Code Review drawer so Git / Automation / pre-push can open it.
 */
export function CodeReviewHost({
  defaultRepositoryPath = null,
  defaultRepositoryName = null,
  defaultExecutionEngine = null,
  onOpenFile,
}: CodeReviewHostProps) {
  const [open, setOpen] = useState(false);
  const [repositoryPath, setRepositoryPath] = useState(defaultRepositoryPath?.trim() ?? "");
  const [repositoryName, setRepositoryName] = useState(defaultRepositoryName?.trim() ?? "");
  const [executionEngine, setExecutionEngine] = useState<SessionExecutionEngine | undefined>(
    defaultExecutionEngine ?? undefined,
  );
  const [autoStart, setAutoStart] = useState(false);
  const [initialScope, setInitialScope] = useState<CodeReviewScope>("uncommitted");
  const [seededRun, setSeededRun] = useState<CodeReviewRun | null>(null);
  const [focusFinding, setFocusFinding] = useState<CodeReviewFocusFinding | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenCodeReviewDetail>).detail;
      const path = detail?.repositoryPath?.trim() || defaultRepositoryPath?.trim() || "";
      if (!path) return;
      setRepositoryPath(path);
      setRepositoryName(detail?.repositoryName?.trim() || defaultRepositoryName?.trim() || "");
      setExecutionEngine(
        detail?.executionEngine
          ? normalizeSessionExecutionEngine(detail.executionEngine)
          : defaultExecutionEngine ?? undefined,
      );
      setAutoStart(Boolean(detail?.autoStart) && !detail?.seededRun);
      setInitialScope(detail?.initialScope === "branch" ? "branch" : "uncommitted");
      setSeededRun(detail?.seededRun ?? null);
      if (detail?.seededRun) {
        publishCodeReviewFindings(detail.seededRun);
      }
      const nextFocus = detail?.focusFinding?.path?.trim()
        ? {
            path: detail.focusFinding.path.trim(),
            line: detail.focusFinding.line ?? null,
          }
        : null;
      setFocusFinding(nextFocus);
      if (nextFocus) {
        setFocusNonce((value) => value + 1);
      }
      setOpen(true);
    };
    window.addEventListener(WISE_UI_EVENT_OPEN_CODE_REVIEW, onOpen as EventListener);
    return () => {
      window.removeEventListener(WISE_UI_EVENT_OPEN_CODE_REVIEW, onOpen as EventListener);
    };
  }, [defaultExecutionEngine, defaultRepositoryName, defaultRepositoryPath]);

  return (
    <CodeReviewDrawer
      open={open}
      onClose={() => {
        setOpen(false);
        setAutoStart(false);
        setSeededRun(null);
        setFocusFinding(null);
      }}
      repositoryPath={repositoryPath}
      repositoryName={repositoryName || undefined}
      executionEngine={executionEngine}
      onOpenFile={
        onOpenFile
          ? (path, options) =>
              onOpenFile(path, {
                ...options,
                repositoryPath,
                fileRootPath: repositoryPath,
              })
          : undefined
      }
      autoStart={autoStart}
      initialScope={initialScope}
      seededRun={seededRun}
      focusFinding={focusFinding}
      focusNonce={focusNonce}
      onRunCompleted={(run) => {
        publishCodeReviewFindings(run);
      }}
    />
  );
}
