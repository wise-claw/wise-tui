import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useWorkspaceMemoEditor } from "../hooks/useWorkspaceMemoEditor";
import { useWorkspaceMemos } from "../hooks/useWorkspaceMemos";
import {
  createWorkspaceMemoId,
  deriveMemoTitleFromBody,
  type WorkspaceMemoDisplayItem,
  type WorkspaceMemoItem,
  type WorkspaceMemoScope,
  type WorkspaceMemoSelection,
  workspaceMemoTabKey,
} from "../types/workspaceMemos";

export interface WorkspaceMemosContextValue {
  loading: boolean;
  hasScope: boolean;
  displayItems: WorkspaceMemoDisplayItem[];
  selectedMemo: WorkspaceMemoDisplayItem | null;
  selection: WorkspaceMemoSelection | null;
  selectMemo: (next: WorkspaceMemoSelection | null) => void;
  editorVisible: boolean;
  openTabs: WorkspaceMemoSelection[];
  activeSelection: WorkspaceMemoSelection | null;
  openMemoInCenter: (selection: WorkspaceMemoSelection) => void;
  closeMemoTab: (selection: WorkspaceMemoSelection) => void;
  closeMemoEditorPanel: () => void;
  setActiveMemoTab: (selection: WorkspaceMemoSelection) => void;
  createMemo: (scope: WorkspaceMemoScope) => WorkspaceMemoSelection | null;
  deleteMemo: (item: WorkspaceMemoDisplayItem) => Promise<void>;
  upsertMemo: (
    scope: WorkspaceMemoScope,
    memoId: string,
    patch: Partial<{ title: string; bodyMarkdown: string }>,
  ) => Promise<void>;
  getMemoBySelection: (selection: WorkspaceMemoSelection) => WorkspaceMemoDisplayItem | null;
}

const WorkspaceMemosContext = createContext<WorkspaceMemosContextValue | null>(null);
export const WorkspaceMemoEditorVisibilityContext = createContext(false);

export function useWorkspaceMemosContext(): WorkspaceMemosContextValue {
  const value = useContext(WorkspaceMemosContext);
  if (!value) {
    throw new Error("useWorkspaceMemosContext must be used within WorkspaceMemosProvider");
  }
  return value;
}

export function useWorkspaceMemosContextOptional(): WorkspaceMemosContextValue | null {
  return useContext(WorkspaceMemosContext);
}

export interface WorkspaceMemosProviderProps {
  projectId: string | null;
  repositoryId: number | null;
  /** 从 Cockpit 等入口打开备忘录时，先切到 Chat 主区。 */
  onEnsureChatMode?: () => void;
  children: ReactNode;
}

export function WorkspaceMemosProvider({
  projectId,
  repositoryId,
  onEnsureChatMode,
  children,
}: WorkspaceMemosProviderProps) {
  const memos = useWorkspaceMemos({ projectId, repositoryId });
  const editor = useWorkspaceMemoEditor();

  const getMemoBySelection = useCallback(
    (selection: WorkspaceMemoSelection) =>
      memos.displayItems.find((row) => row.scope === selection.scope && row.id === selection.id) ?? null,
    [memos.displayItems],
  );

  const upsertMemo = useCallback(
    async (
      scope: WorkspaceMemoScope,
      memoId: string,
      patch: Partial<{ title: string; bodyMarkdown: string }>,
    ) => {
      const source =
        scope === "project" ? memos.projectItemsRef.current : memos.repositoryItemsRef.current;
      const index = source.findIndex((row) => row.id === memoId);
      if (index < 0) return;
      const now = Date.now();
      const current = source[index];
      const nextItem: WorkspaceMemoItem = {
        ...current,
        ...patch,
        updatedAt: now,
      };
      if (
        patch.bodyMarkdown !== undefined &&
        patch.title === undefined &&
        (current.title === "无标题" || !current.title.trim())
      ) {
        nextItem.title = deriveMemoTitleFromBody(patch.bodyMarkdown, current.title);
      }
      const next = [...source];
      next[index] = nextItem;
      memos.setItemsForScope(scope, next, memoId);
      await memos.flushPersist(scope, next, memoId);
    },
    [memos],
  );

  const openMemoInCenter = useCallback(
    (selection: WorkspaceMemoSelection) => {
      onEnsureChatMode?.();
      memos.selectMemo(selection);
      editor.openMemo(selection);
    },
    [editor, memos, onEnsureChatMode],
  );

  const createMemo = useCallback(
    (scope: WorkspaceMemoScope): WorkspaceMemoSelection | null => {
      const now = Date.now();
      const id = createWorkspaceMemoId();
      const item: WorkspaceMemoItem = {
        id,
        title: "无标题",
        bodyMarkdown: "",
        createdAt: now,
        updatedAt: now,
      };
      const source =
        scope === "project" ? memos.projectItemsRef.current : memos.repositoryItemsRef.current;
      const next = [item, ...source];
      memos.setItemsForScope(scope, next, id);
      void memos.flushPersist(scope, next, id);
      const selection = { scope, id };
      openMemoInCenter(selection);
      return selection;
    },
    [memos, openMemoInCenter],
  );

  const deleteMemo = useCallback(
    async (item: WorkspaceMemoDisplayItem) => {
      const source =
        item.scope === "project"
          ? memos.projectItemsRef.current
          : memos.repositoryItemsRef.current;
      const next = source.filter((row) => row.id !== item.id);
      const nextSelected = next[0]?.id ?? null;
      memos.setItemsForScope(item.scope, next, nextSelected);
      await memos.flushPersist(item.scope, next, nextSelected);
      editor.closeMemoTab({ scope: item.scope, id: item.id });
      if (memos.selection?.scope === item.scope && memos.selection.id === item.id) {
        if (next[0]) {
          memos.selectMemo({ scope: item.scope, id: next[0].id });
        } else {
          memos.selectMemo(null);
        }
      }
    },
    [editor, memos],
  );

  const value = useMemo<WorkspaceMemosContextValue>(
    () => ({
      loading: memos.loading,
      hasScope: memos.hasScope,
      displayItems: memos.displayItems,
      selectedMemo: memos.selectedMemo,
      selection: memos.selection,
      selectMemo: memos.selectMemo,
      editorVisible: editor.editorVisible,
      openTabs: editor.openTabs,
      activeSelection: editor.activeSelection,
      openMemoInCenter,
      closeMemoTab: editor.closeMemoTab,
      closeMemoEditorPanel: editor.closeMemoEditorPanel,
      setActiveMemoTab: editor.setActiveMemo,
      createMemo,
      deleteMemo,
      upsertMemo,
      getMemoBySelection,
    }),
    [
      createMemo,
      deleteMemo,
      editor.activeSelection,
      editor.closeMemoEditorPanel,
      editor.closeMemoTab,
      editor.editorVisible,
      editor.openTabs,
      editor.setActiveMemo,
      getMemoBySelection,
      memos.displayItems,
      memos.hasScope,
      memos.loading,
      memos.selectedMemo,
      memos.selection,
      memos.selectMemo,
      openMemoInCenter,
      upsertMemo,
    ],
  );

  return (
    <WorkspaceMemosContext.Provider value={value}>
      <WorkspaceMemoEditorVisibilityContext.Provider value={editor.editorVisible}>
        {children}
      </WorkspaceMemoEditorVisibilityContext.Provider>
    </WorkspaceMemosContext.Provider>
  );
}

export function workspaceMemoTabLabel(
  memo: WorkspaceMemoDisplayItem | null,
  selection: WorkspaceMemoSelection,
): string {
  if (memo?.title?.trim()) return memo.title.trim();
  return selection.scope === "project" ? "工作区备忘录" : "仓库备忘录";
}

export { workspaceMemoTabKey };
