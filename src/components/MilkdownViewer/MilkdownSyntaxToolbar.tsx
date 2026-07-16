import {
  BoldOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  ItalicOutlined,
  LinkOutlined,
  MinusOutlined,
  OrderedListOutlined,
  RedoOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Button, Input, Popover } from "antd";
import { useCallback, useState, type ReactNode, type RefObject } from "react";
import { HoverHint } from "../shared/HoverHint";
import type { MilkdownEditorHandle } from "./index";
import "./MilkdownSyntaxToolbar.css";

interface ToolbarButtonProps {
  title: string;
  ariaLabel: string;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarButton({ title, ariaLabel, onClick, children }: ToolbarButtonProps) {
  return (
    <HoverHint title={title}>
      <Button
        type="text"
        size="small"
        aria-label={ariaLabel}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        {children}
      </Button>
    </HoverHint>
  );
}

function ToolbarDivider() {
  return <span className="app-milkdown-syntax-toolbar__divider" aria-hidden />;
}

export interface MilkdownSyntaxToolbarProps {
  editorRef: RefObject<MilkdownEditorHandle | null>;
}

function modShortcutLabel(suffix: string): string {
  const mod =
    typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.platform)
      ? "⌘"
      : "Ctrl";
  return `${mod}${suffix}`;
}

/** Milkdown 编辑器顶部固定语法快捷按钮列（不抢编辑器选区焦点）。 */
export function MilkdownSyntaxToolbar({ editorRef }: MilkdownSyntaxToolbarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");

  const run = useCallback(
    (action: (handle: MilkdownEditorHandle) => void) => {
      const handle = editorRef.current;
      if (!handle) return;
      action(handle);
    },
    [editorRef],
  );

  const applyLink = useCallback(() => {
    const href = linkHref.trim();
    if (!href) return;
    run((handle) => handle.toggleLink(href));
    setLinkOpen(false);
    setLinkHref("");
  }, [linkHref, run]);

  return (
    <div className="app-milkdown-syntax-toolbar" role="toolbar" aria-label="Markdown 语法">
      <div className="app-milkdown-syntax-toolbar__group">
        <ToolbarButton title="撤销" ariaLabel="撤销" onClick={() => run((h) => h.undo())}>
          <UndoOutlined />
        </ToolbarButton>
        <ToolbarButton title="重做" ariaLabel="重做" onClick={() => run((h) => h.redo())}>
          <RedoOutlined />
        </ToolbarButton>
      </div>

      <ToolbarDivider />

      <div className="app-milkdown-syntax-toolbar__group">
        {[1, 2, 3].map((level) => (
          <ToolbarButton
            key={level}
            title={`标题 ${level}`}
            ariaLabel={`标题 ${level}`}
            onClick={() => run((h) => h.wrapHeading(level))}
          >
            <span className="app-milkdown-syntax-toolbar__heading-label">H{level}</span>
          </ToolbarButton>
        ))}
      </div>

      <ToolbarDivider />

      <div className="app-milkdown-syntax-toolbar__group">
        <ToolbarButton title="加粗" ariaLabel="加粗" onClick={() => run((h) => h.toggleStrong())}>
          <BoldOutlined />
        </ToolbarButton>
        <ToolbarButton title="斜体" ariaLabel="斜体" onClick={() => run((h) => h.toggleEmphasis())}>
          <ItalicOutlined />
        </ToolbarButton>
        <ToolbarButton title="行内代码" ariaLabel="行内代码" onClick={() => run((h) => h.toggleInlineCode())}>
          <CodeOutlined />
        </ToolbarButton>
        <Popover
          open={linkOpen}
          onOpenChange={setLinkOpen}
          trigger="click"
          placement="bottomLeft"
          content={
            <div className="app-milkdown-syntax-toolbar__link-popover">
              <Input
                size="small"
                placeholder="https://example.com"
                value={linkHref}
                autoFocus
                onChange={(event) => setLinkHref(event.target.value)}
                onPressEnter={applyLink}
              />
              <div className="app-milkdown-syntax-toolbar__link-actions">
                <Button size="small" onClick={() => setLinkOpen(false)}>
                  取消
                </Button>
                <Button type="primary" size="small" disabled={!linkHref.trim()} onClick={applyLink}>
                  插入
                </Button>
              </div>
            </div>
          }
        >
          <span onMouseDown={(event) => event.preventDefault()}>
            <HoverHint title="链接">
              <Button type="text" size="small" aria-label="链接">
                <LinkOutlined />
              </Button>
            </HoverHint>
          </span>
        </Popover>
      </div>

      <ToolbarDivider />

      <div className="app-milkdown-syntax-toolbar__group">
        <ToolbarButton title="引用" ariaLabel="引用" onClick={() => run((h) => h.wrapBlockquote())}>
          “
        </ToolbarButton>
        <ToolbarButton
          title="无序列表"
          ariaLabel="无序列表"
          onClick={() => run((h) => h.wrapBulletList())}
        >
          <UnorderedListOutlined />
        </ToolbarButton>
        <ToolbarButton
          title="有序列表"
          ariaLabel="有序列表"
          onClick={() => run((h) => h.wrapOrderedList())}
        >
          <OrderedListOutlined />
        </ToolbarButton>
        <ToolbarButton
          title={`任务项（${modShortcutLabel("+Shift+T")}）`}
          ariaLabel="任务项"
          onClick={() => run((h) => h.wrapTaskList())}
        >
          <CheckSquareOutlined />
        </ToolbarButton>
        <ToolbarButton title="代码块" ariaLabel="代码块" onClick={() => run((h) => h.createCodeBlock())}>
          {"{ }"}
        </ToolbarButton>
        <ToolbarButton title="分隔线" ariaLabel="分隔线" onClick={() => run((h) => h.insertHr())}>
          <MinusOutlined />
        </ToolbarButton>
      </div>
    </div>
  );
}
