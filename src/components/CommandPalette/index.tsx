import { useCallback, useEffect, useRef, useState, memo } from "react";
import { Input, Spin, message } from "antd";
import { FileOutlined, SearchOutlined } from "@ant-design/icons";
import { openRepositoryFileWithStoredPreference } from "../../services/openWorkspaceWithPreference";
import {
  searchRepositoryFileContents,
  searchRepositoryFiles,
  type RepositoryFileContentMatch,
} from "../../services/repositoryFiles";
import { commandPalettePropsEqual } from "./commandPalettePropsEqual";
import "./index.css";

export type CommandPaletteSearchMode = "filename" | "content";

interface Props {
  open: boolean;
  onClose: () => void;
  repositoryPath: string | undefined;
  searchMode: CommandPaletteSearchMode;
  onSearchModeChange: (mode: CommandPaletteSearchMode) => void;
  /** Enter / 单击：在 Wise 内打开仓库文件 */
  onOpenInApp: (relativePath: string, options?: { line?: number | null }) => void;
}

interface FilenameResult {
  kind: "filename";
  path: string;
  display: string;
}

interface ContentResult {
  kind: "content";
  path: string;
  line: number;
  preview: string;
  display: string;
}

type SearchResult = FilenameResult | ContentResult;

const SEARCH_MODE_TABS: { mode: CommandPaletteSearchMode; label: string }[] = [
  { mode: "filename", label: "文件名" },
  { mode: "content", label: "文件内容" },
];

function CommandPaletteModeTabs({
  searchMode,
  onSearchModeChange,
}: {
  searchMode: CommandPaletteSearchMode;
  onSearchModeChange: (mode: CommandPaletteSearchMode) => void;
}) {
  return (
    <div className="app-command-palette-tabs" role="tablist" aria-label="搜索范围">
      {SEARCH_MODE_TABS.map(({ mode, label }) => {
        const active = searchMode === mode;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={active}
            className={`app-command-palette-tab${active ? " app-command-palette-tab--active" : ""}`}
            onClick={() => onSearchModeChange(mode)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function CommandPaletteShortcutHints() {
  return (
    <div className="app-command-palette-shortcuts" aria-label="打开快捷键">
      <span className="app-command-palette-shortcut" title="在 Wise 内打开文件">
        <kbd className="app-command-palette-shortcut__keys">Enter</kbd>
        <span className="app-command-palette-shortcut__label">应用内</span>
      </span>
      <span className="app-command-palette-shortcut" title="按顶栏打开方式偏好在外部打开">
        <kbd className="app-command-palette-shortcut__keys">⇧Enter</kbd>
        <span className="app-command-palette-shortcut__label">外部</span>
      </span>
    </div>
  );
}

function toContentResults(matches: RepositoryFileContentMatch[]): ContentResult[] {
  return matches.map((match) => ({
    kind: "content" as const,
    path: match.path,
    line: match.line,
    preview: match.preview,
    display: `${match.path}:${match.line}`,
  }));
}

export const CommandPalette = memo(function CommandPalette({
  open,
  onClose,
  repositoryPath,
  searchMode,
  onSearchModeChange,
  onOpenInApp,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRequestIdRef = useRef(0);

  const openSearchResultInApp = useCallback(
    (item: SearchResult) => {
      if (!repositoryPath) return;
      onClose();
      onOpenInApp(item.path, item.kind === "content" ? { line: item.line } : undefined);
    },
    [repositoryPath, onClose, onOpenInApp],
  );

  const openSearchResultExternal = useCallback(
    (item: SearchResult) => {
      if (!repositoryPath) return;
      onClose();
      void openRepositoryFileWithStoredPreference(
        repositoryPath,
        item.path,
        undefined,
        item.kind === "content" ? { line: item.line } : undefined,
      ).catch((e) => {
        message.error(e instanceof Error ? e.message : String(e));
      });
    },
    [repositoryPath, onClose],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setResults([]);
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [open, searchMode]);

  useEffect(() => {
    if (!open || !repositoryPath) {
      setResults([]);
      setLoading(false);
      return;
    }
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = ++searchRequestIdRef.current;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        if (searchMode === "filename") {
          const entries = await searchRepositoryFiles(repositoryPath, q);
          if (cancelled || requestId !== searchRequestIdRef.current) return;
          setResults(
            entries.map((entry) => ({
              kind: "filename" as const,
              path: entry.path,
              display: entry.path,
            })),
          );
        } else {
          const matches = await searchRepositoryFileContents(repositoryPath, q);
          if (cancelled || requestId !== searchRequestIdRef.current) return;
          setResults(toContentResults(matches));
        }
      } catch {
        if (!cancelled && requestId === searchRequestIdRef.current) setResults([]);
      } finally {
        if (!cancelled && requestId === searchRequestIdRef.current) setLoading(false);
      }
    }, searchMode === "content" ? 250 : 50);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, repositoryPath, searchMode]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const item = results[activeIndex];
        if (item && repositoryPath) {
          e.preventDefault();
          if (e.shiftKey) {
            openSearchResultExternal(item);
          } else {
            openSearchResultInApp(item);
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    open,
    results,
    activeIndex,
    onClose,
    repositoryPath,
    openSearchResultInApp,
    openSearchResultExternal,
  ]);

  const placeholder =
    searchMode === "filename" ? "输入文件名" : "搜索文件内容";
  const emptyHint =
    searchMode === "filename" ? "输入文件名搜索" : "输入关键词搜索文件内容";
  const dialogLabel = searchMode === "filename" ? "文件搜索" : "文件内容搜索";

  if (!open) return null;

  return (
    <div className="app-command-palette-backdrop" onClick={onClose}>
      <div
        className="app-command-palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={dialogLabel}
      >
        <div className="app-command-palette-header">
          <CommandPaletteModeTabs searchMode={searchMode} onSearchModeChange={onSearchModeChange} />
        </div>
        <div className="app-command-palette-input">
          <Input
            ref={inputRef as any}
            prefix={<SearchOutlined style={{ color: "var(--ant-color-text-tertiary)" }} />}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            variant="borderless"
            placeholder={placeholder}
            suffix={<CommandPaletteShortcutHints />}
            autoFocus
          />
        </div>
        {loading && query ? (
          <div className="app-command-palette-loading">
            <Spin size="small" />
          </div>
        ) : results.length > 0 ? (
          <div className="app-command-palette-list">
            {results.map((item, index) => (
              <div
                key={item.kind === "content" ? `${item.path}:${item.line}` : item.path}
                className={`app-command-palette-item ${index === activeIndex ? "app-command-palette-item--active" : ""}`}
                onClick={() => {
                  openSearchResultInApp(item);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {item.kind === "content" ? (
                  <div className="app-command-palette-item-content">
                    <div className="app-command-palette-item-head">
                      <FileOutlined className="app-command-palette-item-icon" />
                      <span className="app-command-palette-item-path">{item.display}</span>
                    </div>
                    {item.preview ? (
                      <div className="app-command-palette-item-preview">{item.preview}</div>
                    ) : null}
                  </div>
                ) : (
                  <span className="app-command-palette-item-label">{item.display}</span>
                )}
              </div>
            ))}
          </div>
        ) : query ? (
          <div className="app-command-palette-empty">
            {searchMode === "filename" ? "没有找到文件" : "没有找到匹配内容"}
          </div>
        ) : (
          <div className="app-command-palette-empty">{emptyHint}</div>
        )}
      </div>
    </div>
  );
}, commandPalettePropsEqual);
