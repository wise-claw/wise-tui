import { useCallback, useEffect, useRef, useState } from "react";
import { Input, Spin, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { openRepositoryFileWithStoredPreference } from "../../services/openWorkspaceWithPreference";
import { searchRepositoryFiles } from "../../services/repositoryFiles";
import "./index.css";

interface Props {
  open: boolean;
  onClose: () => void;
  repositoryPath: string | undefined;
  /** Enter / 单击：在 Wise 内打开仓库文件 */
  onOpenInApp: (relativePath: string) => void;
}

interface FileResult {
  path: string;
  display: string;
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

export function CommandPalette({ open, onClose, repositoryPath, onOpenInApp }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [results, setResults] = useState<FileResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const openSearchResultInApp = useCallback(
    (relativePath: string) => {
      if (!repositoryPath) return;
      onClose();
      onOpenInApp(relativePath);
    },
    [repositoryPath, onClose, onOpenInApp],
  );

  const openSearchResultExternal = useCallback(
    (relativePath: string) => {
      if (!repositoryPath) return;
      onClose();
      void openRepositoryFileWithStoredPreference(repositoryPath, relativePath).catch((e) => {
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
  }, [open]);

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
    setLoading(true);

    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        const paths = await searchRepositoryFiles(repositoryPath, q);
        if (cancelled) return;
        setResults(
          paths.map((rel) => ({
            path: rel,
            display: rel,
          })),
        );
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 50);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, repositoryPath]);

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
            openSearchResultExternal(item.path);
          } else {
            openSearchResultInApp(item.path);
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

  if (!open) return null;

  return (
    <div className="app-command-palette-backdrop" onClick={onClose}>
      <div
        className="app-command-palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="文件搜索"
      >
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
            placeholder="输入文件名"
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
                key={item.path}
                className={`app-command-palette-item ${index === activeIndex ? "app-command-palette-item--active" : ""}`}
                onClick={() => {
                  openSearchResultInApp(item.path);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="app-command-palette-item-label">{item.display}</span>
              </div>
            ))}
          </div>
        ) : query ? (
          <div className="app-command-palette-empty">没有找到文件</div>
        ) : (
          <div className="app-command-palette-empty">输入文件名搜索</div>
        )}
      </div>
    </div>
  );
}
