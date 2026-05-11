import { Button, Modal, message } from "antd";
import { RepositoryImagePreview } from "./RepositoryImagePreview";
import { openInFinder } from "../services/repository";
import { toUiErrorMessage } from "../utils/appErrorMessage";
import type { RepositoryBinaryPreviewState } from "../utils/repositoryFilePreview";

interface Props {
  preview: RepositoryBinaryPreviewState | null;
  onClose: () => void;
}

export function RepositoryFilePreviewModal({ preview, onClose }: Props) {
  return (
    <Modal
      open={preview !== null}
      title={preview?.relativePath ?? "文件预览"}
      onCancel={onClose}
      footer={null}
      centered
      width="min(1100px, 96vw)"
      destroyOnHidden
      zIndex={3100}
      rootClassName="app-repository-file-preview-modal"
      styles={{
        body: {
          padding: "12px 16px 20px",
          maxHeight: "calc(100vh - 100px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {preview ? (
        <div
          className={
            "app-repository-file-preview-body" +
            (preview.kind === "docx" ? " app-repository-file-preview-body--docx" : "") +
            (preview.kind === "image" ? " app-repository-file-preview-body--image" : "")
          }
        >
          {preview.kind === "image" ? <RepositoryImagePreview src={preview.src} alt={preview.relativePath} /> : null}
          {preview.kind === "pdf" ? (
            <iframe
              key={preview.blobUrl}
              title={preview.relativePath}
              src={preview.blobUrl}
              className="app-repository-file-preview-pdf"
            />
          ) : null}
          {preview.kind === "docx" ? (
            <div className="app-repository-docx-preview" dangerouslySetInnerHTML={{ __html: preview.html }} />
          ) : null}
          {preview.kind === "doc" ? (
            <div className="app-repository-doc-legacy-preview">
              <p className="app-repository-doc-legacy-preview-text">
                旧版 Word（.doc）为二进制格式，无法在应用内渲染。请使用本机已安装的 Word、Pages 或 WPS 等打开查看。
              </p>
              <Button
                type="primary"
                onClick={() => {
                  void openInFinder(preview.absolutePath).catch((err) => {
                    console.error(err);
                    message.error(`打开失败：${toUiErrorMessage(err)}`);
                  });
                }}
              >
                用默认应用打开
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
