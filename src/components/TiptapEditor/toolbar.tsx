import {
  BoldOutlined,
  CheckSquareOutlined,
  ClearOutlined,
  CodeOutlined,
  ItalicOutlined,
  LinkOutlined,
  MinusOutlined,
  OrderedListOutlined,
  PictureOutlined,
  PlusSquareOutlined,
  RedoOutlined,
  StrikethroughOutlined,
  TableOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Button, Input, Popover } from "antd";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { HoverHint } from "../shared/HoverHint";

function ToolbarButton({
  title,
  ariaLabel,
  active = false,
  onClick,
  children,
}: {
  title: string;
  ariaLabel: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <HoverHint title={title}>
      <Button
        type="text"
        size="small"
        aria-label={ariaLabel}
        aria-pressed={active}
        className={active ? "app-tiptap-toolbar__button--active" : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        {children}
      </Button>
    </HoverHint>
  );
}

function ToolbarDivider() {
  return <span className="app-tiptap-toolbar__divider" aria-hidden />;
}

function modShortcutLabel(suffix: string): string {
  const mod =
    typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.platform)
      ? "⌘"
      : "Ctrl";
  return `${mod}${suffix}`;
}

/** 把图片 File 转为 base64 data URL（与旧 Milkdown 上传行为一致）。 */
export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${file.type || "image/png"};base64,${btoa(binary)}`;
}

export interface TiptapToolbarProps {
  editor: Editor;
  /** 提供时在工具栏末尾追加「新增任务」（拆分选中）入口。 */
  onSplitSelection?: () => void;
}

/** 语雀风格固定菜单栏：撤销/重做、标题、行内样式、列表、块级工具与图片。 */
export function TiptapToolbar({ editor, onSplitSelection }: TiptapToolbarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      paragraph: e.isActive("paragraph"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      blockquote: e.isActive("blockquote"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      codeBlock: e.isActive("codeBlock"),
    }),
  });

  const applyLink = useCallback(() => {
    const href = linkHref.trim();
    if (!href) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
    setLinkHref("");
  }, [editor, linkHref]);

  const insertImageFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const chain = editor.chain().focus();
    for (const file of imageFiles) {
      const src = await fileToBase64(file);
      chain.setImage({ src, alt: file.name || "" });
    }
    chain.run();
  }, [editor]);

  const insertTable = useCallback(() => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  const wrapHeading = useCallback((level: number | null) => {
    const chain = editor.chain().focus();
    if (level == null) {
      chain.setParagraph();
    } else {
      chain.toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 });
    }
    chain.run();
  }, [editor]);

  return (
    <div className="app-tiptap-toolbar" role="toolbar" aria-label="富文本编辑工具栏">
      <div className="app-tiptap-toolbar__group">
        <ToolbarButton title="撤销" ariaLabel="撤销" onClick={() => editor.chain().focus().undo().run()} active={!state.canUndo}>
          <UndoOutlined />
        </ToolbarButton>
        <ToolbarButton title="重做" ariaLabel="重做" onClick={() => editor.chain().focus().redo().run()} active={!state.canRedo}>
          <RedoOutlined />
        </ToolbarButton>
      </div>

      <ToolbarDivider />

      <div className="app-tiptap-toolbar__group">
        <ToolbarButton title="正文" ariaLabel="正文" active={state.paragraph} onClick={() => wrapHeading(null)}>
          <span className="app-tiptap-toolbar__heading-label">正文</span>
        </ToolbarButton>
        {[1, 2, 3].map((level) => (
          <ToolbarButton
            key={level}
            title={`标题 ${level}`}
            ariaLabel={`标题 ${level}`}
            active={level === 1 ? state.h1 : level === 2 ? state.h2 : state.h3}
            onClick={() => wrapHeading(level)}
          >
            <span className="app-tiptap-toolbar__heading-label">H{level}</span>
          </ToolbarButton>
        ))}
      </div>

      <ToolbarDivider />

      <div className="app-tiptap-toolbar__group">
        <ToolbarButton title="加粗" ariaLabel="加粗" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <BoldOutlined />
        </ToolbarButton>
        <ToolbarButton title="斜体" ariaLabel="斜体" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <ItalicOutlined />
        </ToolbarButton>
        <ToolbarButton title="删除线" ariaLabel="删除线" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <StrikethroughOutlined />
        </ToolbarButton>
        <ToolbarButton title="行内代码" ariaLabel="行内代码" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
          <CodeOutlined />
        </ToolbarButton>
        <Popover
          open={linkOpen}
          onOpenChange={setLinkOpen}
          trigger="click"
          placement="bottomLeft"
          content={
            <div className="app-tiptap-toolbar__link-popover">
              <Input
                size="small"
                placeholder="https://example.com"
                value={linkHref}
                autoFocus
                onChange={(event) => setLinkHref(event.target.value)}
                onPressEnter={applyLink}
              />
              <div className="app-tiptap-toolbar__link-actions">
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

      <div className="app-tiptap-toolbar__group">
        <ToolbarButton title="引用" ariaLabel="引用" active={state.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          “
        </ToolbarButton>
        <ToolbarButton
          title="无序列表"
          ariaLabel="无序列表"
          active={state.bulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <UnorderedListOutlined />
        </ToolbarButton>
        <ToolbarButton
          title="有序列表"
          ariaLabel="有序列表"
          active={state.orderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <OrderedListOutlined />
        </ToolbarButton>
        <ToolbarButton
          title={`任务项（${modShortcutLabel("+Shift+T")}）`}
          ariaLabel="任务项"
          active={state.taskList}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <CheckSquareOutlined />
        </ToolbarButton>
      </div>

      <ToolbarDivider />

      <div className="app-tiptap-toolbar__group">
        <ToolbarButton title="代码块" ariaLabel="代码块" active={state.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          {"{ }"}
        </ToolbarButton>
        <ToolbarButton title="插入表格" ariaLabel="插入表格" onClick={insertTable}>
          <TableOutlined />
        </ToolbarButton>
        <ToolbarButton title="分隔线" ariaLabel="分隔线" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <MinusOutlined />
        </ToolbarButton>
        <ToolbarButton title="插入图片" ariaLabel="插入图片" onClick={() => fileInputRef.current?.click()}>
          <PictureOutlined />
        </ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="app-tiptap-toolbar__file-input"
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) void insertImageFiles(files);
            event.target.value = "";
          }}
        />
      </div>

      <ToolbarDivider />

      <div className="app-tiptap-toolbar__group">
        <ToolbarButton
          title="清除格式"
          ariaLabel="清除格式"
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
        >
          <ClearOutlined />
        </ToolbarButton>
        {onSplitSelection ? (
          <ToolbarButton title="新增任务（拆分选中）" ariaLabel="新增任务" onClick={onSplitSelection}>
            <PlusSquareOutlined />
          </ToolbarButton>
        ) : null}
      </div>
    </div>
  );
}

