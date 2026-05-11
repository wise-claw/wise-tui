import type { ContextItem } from "../../types";
import { usePrompt } from "./prompt-context";

interface ContextItemsProps {
  items: ContextItem[];
}

export function ContextItems({ items }: ContextItemsProps) {
  const { contextRemove } = usePrompt();

  if (items.length === 0) return null;

  return (
    <div className="app-claude-context-items">
      {items.map((item) => (
        <ContextItemChip key={item.key} item={item} onRemove={() => contextRemove(item.key)} />
      ))}
    </div>
  );
}

function ContextItemChip({ item, onRemove }: { item: ContextItem; onRemove: () => void }) {
  const filename = item.path.split("/").pop() ?? item.path;
  const directory = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";

  return (
    <div className="app-claude-context-item">
      <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px" }}>
        <span style={{ fontSize: "12px", color: "var(--ant-color-text-tertiary)" }}>📄</span>
        <span style={{ color: "var(--ant-color-text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {filename}
        </span>
        {item.selection && (
          <span style={{ color: "var(--ant-color-text-tertiary)" }}>
            :{item.selection.startLine}{item.selection.endLine !== item.selection.startLine ? `-${item.selection.endLine}` : ""}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            marginLeft: "auto",
            border: "none",
            background: "transparent",
            color: "var(--ant-color-text-tertiary)",
            cursor: "pointer",
            padding: "0 2px",
            fontSize: "12px",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      {directory && (
        <div style={{ fontSize: "10px", color: "var(--ant-color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {directory}
        </div>
      )}
      {item.comment && (
        <div style={{ fontSize: "11px", color: "var(--ant-color-text-secondary)", marginTop: "2px", paddingLeft: "16px" }}>
          {item.comment}
        </div>
      )}
    </div>
  );
}
