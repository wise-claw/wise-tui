import { useState, useRef, useCallback, useEffect } from "react";
import { Image } from "antd";
import type { ImageAttachmentPart } from "../../types";
import { isWiseRepositoryFileDragDataTransfer } from "../../utils/repositoryFileDrag";
import { insertPillAtCursor } from "./editor-dom";
import { usePrompt } from "./prompt-context";
import { ImageRedBoxCropModal } from "./image-red-box-crop-modal";

interface AttachmentManagerProps {
  editorRef: React.RefObject<HTMLDivElement | null>;
  onImagesChange: (images: ImageAttachmentPart[]) => void;
}

function detectMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", txt: "text/plain", md: "text/markdown",
    ts: "text/typescript", tsx: "text/typescript", js: "text/javascript", jsx: "text/javascript",
    py: "text/x-python", rs: "text/x-rust", go: "text/x-go", java: "text/x-java",
    css: "text/css", html: "text/html", json: "application/json", yaml: "text/yaml",
    yml: "text/yaml", toml: "text/toml", xml: "text/xml", sql: "text/x-sql",
  };
  return map[ext] || "application/octet-stream";
}

export function AttachmentManager({ editorRef, onImagesChange }: AttachmentManagerProps) {
  const { contextAdd } = usePrompt();
  const [images, setImages] = useState<ImageAttachmentPart[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 避免每个 dragover 都 setState 导致全局卡顿（仓库文件树拖放会高频触发）。 */
  const dragOverHighlightRef = useRef(false);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      if (isWiseRepositoryFileDragDataTransfer(e.dataTransfer)) return;
      e.preventDefault();
      if (!dragOverHighlightRef.current) {
        dragOverHighlightRef.current = true;
        setIsDragOver(true);
      }
    };
    const handleDragLeave = (e: DragEvent) => {
      if (isWiseRepositoryFileDragDataTransfer(e.dataTransfer)) return;
      if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
        dragOverHighlightRef.current = false;
        setIsDragOver(false);
      }
    };
    const handleDrop = (e: DragEvent) => {
      if (isWiseRepositoryFileDragDataTransfer(e.dataTransfer)) {
        dragOverHighlightRef.current = false;
        return;
      }
      e.preventDefault();
      dragOverHighlightRef.current = false;
      setIsDragOver(false);
      const fl = e.dataTransfer?.files;
      if (!fl?.length) return;
      processFiles(Array.from(fl));
    };
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
    };
  }, []);

  const processFiles = useCallback(
    (files: File[]) => {
      const editor = editorRef.current;
      if (!editor) return;

      files.forEach((file) => {
        const mime = detectMime(file);
        if (mime.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const img: ImageAttachmentPart = {
              type: "image",
              id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              filename: file.name,
              mime,
              dataUrl,
            };
            setImages((prev) => {
              const next = [...prev, img];
              onImagesChange(next);
              return next;
            });
          };
          reader.readAsDataURL(file);
        } else {
          // Text file: add as context item
          contextAdd({
            type: "file",
            path: file.name,
            key: `file:${file.name}:${Date.now()}`,
          });
          // Insert pill into editor
          editor.focus();
          insertPillAtCursor(editor, "file", `@${file.name}`, { path: file.name });
        }
      });
    },
    [editorRef, contextAdd, onImagesChange],
  );

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        processFiles(Array.from(e.target.files));
        e.target.value = "";
      }
    },
    [processFiles],
  );

  const removeImage = useCallback(
    (id: string) => {
      setImages((prev) => {
        const next = prev.filter((img) => img.id !== id);
        onImagesChange(next);
        return next;
      });
    },
    [onImagesChange],
  );

  return {
    isDragOver,
    images,
    handleFileSelect,
    handleFileInputChange,
    removeImage,
    fileInputRef,
    fileInput: (
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="*/*"
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />
    ),
  };
}

export function ImageThumbnails({
  images,
  onRemove,
  onReplace,
}: {
  images: ImageAttachmentPart[];
  onRemove: (id: string) => void;
  onReplace: (id: string, next: ImageAttachmentPart) => void;
}) {
  const [editing, setEditing] = useState<ImageAttachmentPart | null>(null);

  if (images.length === 0) return null;
  return (
    <>
      <ImageRedBoxCropModal
        open={editing !== null}
        image={editing}
        onClose={() => setEditing(null)}
        onApply={(next) => onReplace(next.id, next)}
      />
      <div className="app-claude-image-thumbs" style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" }}>
        <Image.PreviewGroup>
          {images.map((img) => (
            <div
              key={img.id}
              className="app-claude-image-thumb-wrap"
              style={{
                position: "relative",
                width: "48px",
                height: "48px",
                borderRadius: "6px",
                overflow: "hidden",
                border: "1px solid var(--ant-color-border-secondary)",
                flexShrink: 0,
              }}
            >
              <Image
                src={img.dataUrl}
                alt={img.filename}
                width={48}
                height={48}
                style={{ objectFit: "cover", display: "block" }}
                preview={{
                  mask: "预览",
                }}
              />
              <button
                type="button"
                aria-label="编辑图片"
                title="编辑图片（裁剪、红框标注、划线）"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setEditing(img);
                }}
                style={{
                  position: "absolute",
                  bottom: "2px",
                  left: "2px",
                  zIndex: 2,
                  width: "16px",
                  height: "16px",
                  borderRadius: "4px",
                  border: "none",
                  background: "rgba(0,0,0,0.65)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "10px",
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                  <path d="M17 3a2.83 2.83 0 114 4L7 21l-4 1 1-4L17 3z" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="移除图片"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onRemove(img.id);
                }}
                style={{
                  position: "absolute",
                  top: "2px",
                  right: "2px",
                  zIndex: 2,
                  width: "14px",
                  height: "14px",
                  borderRadius: "50%",
                  border: "none",
                  background: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "9px",
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </Image.PreviewGroup>
      </div>
    </>
  );
}
