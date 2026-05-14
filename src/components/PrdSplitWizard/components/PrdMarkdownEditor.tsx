/**
 * PRD 拆分向导内的 Markdown 富文本编辑器。
 *
 * 唯一感知"粘贴/拖拽图片落盘"的位置；其它调用方只看到 string in / string out。
 * 底层复用 MilkdownEditor（markdown lossless）。
 */

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type DragEvent as ReactDragEvent,
  type ClipboardEvent as ReactClipboardEvent,
} from "react";
import { message } from "antd";
import {
  MilkdownEditor,
  type MilkdownEditorHandle,
  type MilkdownTaskAnchor,
} from "../../MilkdownViewer";
import type { AnchorRange } from "../../MilkdownViewer/types";
import { savePrdPastedImage } from "../../../services/savePrdPastedImage";
import {
  gatePrdImage,
  isAcceptedImageMime,
  sanitizeImageFileName,
} from "./prdImageGate";

export interface PrdImageBucket {
  repositoryPath: string;
  repositoryName: string | null;
  repositoryId: number | null;
  projectName: string | null;
  projectId: string | null;
}

export interface PrdMarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  /** 图片落盘 bucket；为 null 时仍尝试调用（后端会按 path 兜底，但若 path 也为空则禁用图片）。 */
  imageBucket: PrdImageBucket | null;
  floatingToolbar?: boolean;
  taskAnchors?: MilkdownTaskAnchor[];
  selectedRequirementAnchorKey?: string | null;
  onTaskAnchorMarkerClick?: (taskId: string) => void;
  onResolvedTaskAnchorIdsChange?: (taskIds: string[]) => void;
  onTaskAnchorRangesChange?: (ranges: Record<string, AnchorRange>) => void;
  onToolbarSplitSelection?: () => void;
  /** 仅控制外层容器的最小高度；不会写入 markdown。 */
  minHeight?: number;
}

function pickImageFile(items: DataTransferItemList | null | undefined, files: FileList | null | undefined): File | null {
  if (items) {
    for (const item of Array.from(items)) {
      if (item.kind === "file" && isAcceptedImageMime(item.type)) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  if (files) {
    for (const file of Array.from(files)) {
      if (isAcceptedImageMime(file.type)) return file;
    }
  }
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read file failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("unexpected reader result"));
    };
    reader.readAsDataURL(file);
  });
}

export const PrdMarkdownEditor = forwardRef<MilkdownEditorHandle, PrdMarkdownEditorProps>(
  function PrdMarkdownEditor(props, ref) {
    const {
      value,
      onChange,
      imageBucket,
      floatingToolbar = true,
      taskAnchors,
      selectedRequirementAnchorKey,
      onTaskAnchorMarkerClick,
      onResolvedTaskAnchorIdsChange,
      onTaskAnchorRangesChange,
      onToolbarSplitSelection,
      minHeight,
    } = props;

    const editorRef = useRef<MilkdownEditorHandle | null>(null);
    useImperativeHandle(ref, () => editorRef.current as MilkdownEditorHandle, []);

    const handleImageFile = useCallback(async (file: File): Promise<boolean> => {
      if (!imageBucket || !imageBucket.repositoryPath) {
        message.warning("当前没有可用仓库目录，无法落盘图片");
        return false;
      }
      const gate = gatePrdImage(file);
      if (gate === "wrong-mime") {
        return false;
      }
      if (gate === "too-large") {
        message.warning("图片超过 8 MB，已忽略");
        return false;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const filename = sanitizeImageFileName(file.name || "pasted.png");
        const url = await savePrdPastedImage(
          imageBucket.repositoryPath,
          imageBucket.repositoryName,
          imageBucket.repositoryId,
          imageBucket.projectName,
          imageBucket.projectId,
          filename,
          dataUrl,
        );
        if (!url) {
          message.error("图片保存失败");
          return false;
        }
        editorRef.current?.insertImage({ src: url, alt: filename });
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        message.error(`图片保存失败：${msg}`);
        return false;
      }
    }, [imageBucket]);

    const onPaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
      const data = event.clipboardData;
      if (!data) return;
      const file = pickImageFile(data.items, data.files);
      if (!file) return;
      event.preventDefault();
      void handleImageFile(file);
    }, [handleImageFile]);

    const onDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
      const data = event.dataTransfer;
      if (!data) return;
      const file = pickImageFile(data.items, data.files);
      if (!file) return;
      event.preventDefault();
      void handleImageFile(file);
    }, [handleImageFile]);

    const onDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
      const data = event.dataTransfer;
      if (!data) return;
      const hasImage = Array.from(data.items ?? []).some(
        (i) => i.kind === "file" && isAcceptedImageMime(i.type),
      );
      if (hasImage) event.preventDefault();
    }, []);

    return (
      <div
        className="prd-markdown-editor"
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={onDragOver}
        style={minHeight ? { minHeight } : undefined}
      >
        <MilkdownEditor
          ref={editorRef}
          text={value}
          onChange={onChange}
          floatingToolbar={floatingToolbar}
          taskAnchors={taskAnchors}
          selectedRequirementAnchorKey={selectedRequirementAnchorKey}
          onTaskAnchorMarkerClick={onTaskAnchorMarkerClick}
          onResolvedTaskAnchorIdsChange={onResolvedTaskAnchorIdsChange}
          onTaskAnchorRangesChange={onTaskAnchorRangesChange}
          onToolbarSplitSelection={onToolbarSplitSelection}
        />
      </div>
    );
  },
);
