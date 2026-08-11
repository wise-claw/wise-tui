import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  RestOutlined,
} from "@ant-design/icons";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";

/** 图片预览：Esc 关闭，⌘/Ctrl + 滚轮缩放（与旧 Milkdown 预览一致）。 */
function WiseImagePreview({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(1);
  }, [src]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleWheel(e: ReactWheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    setScale((s) => Math.min(4, Math.max(0.25, s * factor)));
  }

  return createPortal(
    <div className="app-tiptap-image-preview-backdrop" onClick={onClose} role="presentation">
      <div
        className="app-tiptap-image-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="图片预览"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        <div className="app-tiptap-image-preview-stage" style={{ transform: `scale(${scale})` }}>
          <img src={src} alt="" className="app-tiptap-image-preview-img" draggable={false} />
        </div>
        <p className="app-tiptap-image-preview-hint">Esc 关闭 · ⌘ 或 Ctrl + 滚轮缩放</p>
      </div>
    </div>,
    document.body,
  );
}

function parseWidthPx(value: unknown): number {
  if (typeof value !== "string") return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 语雀风格图片节点视图：左对齐 + 右下角拖拽缩放 + 选中时对齐操作条。 */
export function WiseImageNodeView(props: ReactNodeViewProps) {
  const { node, selected, updateAttributes, editor } = props;
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const align = typeof node.attrs.align === "string" ? node.attrs.align : "left";
  const width = typeof node.attrs.width === "string" ? node.attrs.width : "";
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const editable = editor.isEditable;

  const startResize = useCallback((e: ReactMouseEvent) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    const el = boxRef.current;
    if (!el) return;
    const current = parseWidthPx(width) || el.getBoundingClientRect().width;
    dragRef.current = { startX: e.clientX, startWidth: current };

    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const container = boxRef.current?.parentElement;
      const max = container ? container.getBoundingClientRect().width : 1200;
      const next = Math.min(Math.max(48, drag.startWidth + (ev.clientX - drag.startX)), Math.max(48, max));
      updateAttributes({ width: `${Math.round(next)}px` });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [editable, updateAttributes, width]);

  const resetSize = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updateAttributes({ width: null });
  }, [updateAttributes]);

  const setAlign = useCallback((next: "left" | "center" | "right") => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updateAttributes({ align: next });
  }, [updateAttributes]);

  const boxStyle: React.CSSProperties = { textAlign: align as React.CSSProperties["textAlign"] };
  if (width) boxStyle.width = width;

  return (
    <NodeViewWrapper as="div" className="app-tiptap-image">
      <div
        ref={boxRef}
        className={[
          "app-tiptap-image__box",
          align === "center" ? "app-tiptap-image__box--center" : "",
          align === "right" ? "app-tiptap-image__box--right" : "",
          selected ? "app-tiptap-image__box--selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={boxStyle}
        contentEditable={false}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onDoubleClick={() => setPreviewSrc(src || null)}
          className="app-tiptap-image__img"
        />
        {editable && selected ? (
          <div className="app-tiptap-image__actions" contentEditable={false}>
            <button
              type="button"
              className={`app-tiptap-image__action${align === "left" ? " app-tiptap-image__action--active" : ""}`}
              aria-label="左对齐"
              title="左对齐"
              onMouseDown={(e) => e.preventDefault()}
              onClick={setAlign("left")}
            >
              <AlignLeftOutlined />
            </button>
            <button
              type="button"
              className={`app-tiptap-image__action${align === "center" ? " app-tiptap-image__action--active" : ""}`}
              aria-label="居中"
              title="居中"
              onMouseDown={(e) => e.preventDefault()}
              onClick={setAlign("center")}
            >
              <AlignCenterOutlined />
            </button>
            <button
              type="button"
              className={`app-tiptap-image__action${align === "right" ? " app-tiptap-image__action--active" : ""}`}
              aria-label="右对齐"
              title="右对齐"
              onMouseDown={(e) => e.preventDefault()}
              onClick={setAlign("right")}
            >
              <AlignRightOutlined />
            </button>
            {width ? (
              <button
                type="button"
                className="app-tiptap-image__action"
                aria-label="还原原始大小"
                title="还原原始大小"
                onMouseDown={(e) => e.preventDefault()}
                onClick={resetSize}
              >
                <RestOutlined />
              </button>
            ) : null}
          </div>
        ) : null}
        {editable ? (
          <span
            className="app-tiptap-image__resize-handle"
            role="presentation"
            aria-hidden
            onMouseDown={startResize}
          />
        ) : null}
      </div>
      {previewSrc ? (
        <WiseImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />
      ) : null}
    </NodeViewWrapper>
  );
}
