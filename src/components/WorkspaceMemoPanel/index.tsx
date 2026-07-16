import { Button, Spin, message } from "antd";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { MilkdownEditorHandle } from "../MilkdownViewer";
import { MilkdownSyntaxToolbar } from "../MilkdownViewer/MilkdownSyntaxToolbar";
import {
  getWorkspaceGlobalMemoDb,
  saveWorkspaceGlobalMemoDb,
} from "../../services/workspaceInspectorDb";
import { closeWorkspaceMemoPanel } from "../../stores/workspaceMemoPanelStore";
import { debounce } from "../../utils/debounce";
import "./index.css";

const MilkdownEditor = lazy(() =>
  import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })),
);

/** 停止输入后多久自动落库 */
const AUTO_SAVE_DELAY_MS = 800;

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

function MemoMilkdownEditor({
  editorRef,
  editorKey,
  initialBody,
  onChange,
}: {
  editorRef: RefObject<MilkdownEditorHandle | null>;
  editorKey: number;
  initialBody: string;
  onChange: (markdown: string) => void;
}) {
  return (
    <div className="app-workspace-memo-panel__editor-wrap">
      <MilkdownSyntaxToolbar editorRef={editorRef} />
      <MilkdownEditor
        ref={editorRef}
        key={editorKey}
        text={initialBody}
        onChange={onChange}
        floatingToolbar
        blockEdit={false}
      />
    </div>
  );
}

function saveStatusLabel(status: SaveStatus): string {
  switch (status) {
    case "dirty":
      return "有未保存更改";
    case "saving":
      return "自动保存中…";
    case "saved":
      return "已自动保存";
    case "error":
      return "自动保存失败";
    default:
      return "已与本地库同步";
  }
}

/**
 * 中栏备忘录面板：布局对齐 `RepositoryFileEditorPanel`（占 `panelBelowMessages`，与打开文件一致）。
 * 编辑后防抖自动落库；关闭/卸载时 flush 未落盘内容。
 */
export function WorkspaceMemoPanel() {
  const [loading, setLoading] = useState(true);
  const [initialBody, setInitialBody] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const draftRef = useRef("");
  const savedBodyRef = useRef("");
  const editorRef = useRef<MilkdownEditorHandle | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingAfterSaveRef = useRef(false);
  const mountedRef = useRef(true);

  const persist = useCallback(async (body: string, opts?: { silent?: boolean }) => {
    if (body === savedBodyRef.current) {
      if (mountedRef.current) setSaveStatus("idle");
      return;
    }
    if (saveInFlightRef.current) {
      pendingAfterSaveRef.current = true;
      return;
    }
    saveInFlightRef.current = true;
    if (mountedRef.current) setSaveStatus("saving");
    try {
      const saved = await saveWorkspaceGlobalMemoDb(body);
      savedBodyRef.current = saved.bodyMarkdown;
      if (draftRef.current === saved.bodyMarkdown || draftRef.current === body) {
        // 保存期间若用户又改了，下面会再排一次
      }
      if (mountedRef.current) {
        setSaveStatus(draftRef.current === savedBodyRef.current ? "saved" : "dirty");
      }
      if (!opts?.silent) {
        message.success("备忘录已保存");
      }
    } catch (err) {
      console.error("[WorkspaceMemo] save failed", err);
      if (mountedRef.current) setSaveStatus("error");
      if (!opts?.silent) {
        message.error(err instanceof Error ? err.message : "保存备忘录失败");
      } else {
        message.error("备忘录自动保存失败");
      }
    } finally {
      saveInFlightRef.current = false;
      if (pendingAfterSaveRef.current) {
        pendingAfterSaveRef.current = false;
        const next = draftRef.current;
        if (next !== savedBodyRef.current) {
          void persist(next, { silent: true });
        }
      }
    }
  }, []);

  const autoSaveRef = useRef(
    debounce((body: string) => {
      void persist(body, { silent: true });
    }, AUTO_SAVE_DELAY_MS),
  );

  useEffect(() => {
    mountedRef.current = true;
    const autoSave = autoSaveRef.current;
    return () => {
      // 先 flush 再标记卸载，确保末次内容能落盘（persist 不依赖 mounted）
      autoSave.flush();
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getWorkspaceGlobalMemoDb()
      .then((memo) => {
        if (cancelled) return;
        draftRef.current = memo.bodyMarkdown;
        savedBodyRef.current = memo.bodyMarkdown;
        setInitialBody(memo.bodyMarkdown);
        setSaveStatus("idle");
        setEditorKey((k) => k + 1);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[WorkspaceMemo] load failed", err);
        message.error("加载备忘录失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = useCallback((markdown: string) => {
    draftRef.current = markdown;
    if (markdown === savedBodyRef.current) {
      autoSaveRef.current.cancel();
      setSaveStatus("idle");
      return;
    }
    setSaveStatus("dirty");
    autoSaveRef.current(markdown);
  }, []);

  const handleSaveNow = useCallback(() => {
    autoSaveRef.current.cancel();
    void persist(draftRef.current, { silent: false });
  }, [persist]);

  const handleClose = useCallback(() => {
    // flush 会立刻触发防抖队列中的自动保存；随后卸载 cleanup 再兜底一次
    autoSaveRef.current.flush();
    closeWorkspaceMemoPanel();
  }, []);

  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleCloseShortcut(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey) return;
      if (event.key !== "w" && event.key !== "W" && event.code !== "KeyW") return;

      const panel = panelRef.current;
      const target = event.target;
      if (!panel || !(target instanceof Node) || !panel.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();
      handleClose();
    }
    window.addEventListener("keydown", handleCloseShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleCloseShortcut, { capture: true });
  }, [handleClose]);

  const dirty = saveStatus === "dirty" || saveStatus === "saving" || saveStatus === "error";
  const saving = saveStatus === "saving";

  return (
    <div
      ref={panelRef}
      className="app-file-editor-panel app-workspace-memo-panel"
      aria-label="备忘录"
    >
      <div className="app-file-editor-header">
        <div className="app-file-editor-tab-bar">
          <div className="app-file-editor-tabs-scroll" role="tablist" aria-label="备忘录">
            <div
              role="tab"
              aria-selected
              className="app-file-editor-tab app-file-editor-tab--active"
            >
              <span
                className={`app-file-editor-tab-label${
                  dirty && saveStatus !== "saved" ? " app-file-editor-tab-label--dirty" : ""
                }`}
              >
                备忘录
              </span>
            </div>
          </div>
          <div className="app-file-editor-tab-bar-actions">
            <span
              className={`app-workspace-memo-panel__save-status${
                saveStatus === "error" ? " app-workspace-memo-panel__save-status--error" : ""
              }`}
            >
              {saveStatusLabel(saveStatus)}
            </span>
            <Button
              type="primary"
              size="small"
              loading={saving}
              disabled={!dirty && !saving}
              onClick={handleSaveNow}
            >
              保存
            </Button>
            <Button type="text" size="small" onClick={handleClose}>
              关闭
            </Button>
          </div>
        </div>
      </div>
      <div className="app-file-editor-body app-workspace-memo-panel__body">
        {loading ? (
          <div className="app-file-editor-loading">
            <Spin size="small" />
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="app-file-editor-loading">
                <Spin size="small" />
              </div>
            }
          >
            <MemoMilkdownEditor
              editorRef={editorRef}
              editorKey={editorKey}
              initialBody={initialBody}
              onChange={handleChange}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

/** 稳定节点：写入 `panelBelowMessages` 时 identity 不随 layout 重渲变化。 */
export const WORKSPACE_MEMO_PANEL_NODE = <WorkspaceMemoPanel />;
