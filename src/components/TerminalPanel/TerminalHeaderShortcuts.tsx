import { TERMINAL_HEADER_SHORTCUTS } from "./terminalShortcuts";
import { HoverHint } from "../shared/HoverHint";
import "./index.css";

type TerminalHeaderShortcutsProps = {
  commandSuggestion: string | null;
  commandSuggestionSuffix: string;
  showCommandHint: boolean;
};

export function TerminalHeaderShortcuts({
  commandSuggestion,
  commandSuggestionSuffix,
  showCommandHint,
}: TerminalHeaderShortcutsProps) {
  return (
    <div className="terminal-header-center" role="toolbar" aria-label="终端快捷操作">
      <div className="terminal-header-shortcuts">
        {TERMINAL_HEADER_SHORTCUTS.map((item) => (
          <HoverHint key={item.keys} title={item.title}>
            <span className="terminal-header-shortcut">
              <kbd className="terminal-header-shortcut__keys">{item.keys}</kbd>
            </span>
          </HoverHint>
        ))}
      </div>
      {showCommandHint && commandSuggestion && (
        <div className="terminal-header-suggest" aria-live="polite">
          <span className="terminal-header-suggest__label">提示</span>
          <code className="terminal-header-suggest__command">{commandSuggestion}</code>
          {commandSuggestionSuffix.length > 0 && (
            <span className="terminal-header-suggest__tab">Tab +{commandSuggestionSuffix}</span>
          )}
        </div>
      )}
    </div>
  );
}
