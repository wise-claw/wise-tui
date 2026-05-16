import { useState, useCallback } from "react";
import { Input, Typography, message } from "antd";
import {
  EditOutlined,
  LinkOutlined,
  FileAddOutlined,
  HistoryOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { fetchPrdFromUrl, type FetchPrdFromUrlResponse } from "../../../services/prdUrlFetcher";
import { COPY } from "../copy";
import { PrdMarkdownEditor, type PrdImageBucket } from "../../PrdSplitWizard/components/PrdMarkdownEditor";

type ImportTab = "write" | "file" | "url";

interface PrdImportPageProps {
  markdown: string;
  imageBucket: PrdImageBucket | null;
  onMarkdownChange: (value: string) => void;
  onSubmit: () => void;
  onOpenLegacyImport: () => void;
}

export function PrdImportPage({
  markdown,
  imageBucket,
  onMarkdownChange,
  onSubmit,
  onOpenLegacyImport,
}: PrdImportPageProps) {
  const [tab, setTab] = useState<ImportTab>("write");
  const [urlInput, setUrlInput] = useState("");
  const [urlFetching, setUrlFetching] = useState(false);
  const [urlFetched, setUrlFetched] = useState<FetchPrdFromUrlResponse | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const handlePickFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      });
      if (!selected) return;
      setFileLoading(true);
      const content = await invoke<string>("read_local_text_file", { path: selected });
      setFilePath(selected);
      onMarkdownChange(content);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "文件读取失败");
    } finally {
      setFileLoading(false);
    }
  }, [onMarkdownChange]);

  const handleFetchUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;
    setUrlFetching(true);
    setUrlFetched(null);
    try {
      const result = await fetchPrdFromUrl(url);
      setUrlFetched(result);
      onMarkdownChange(result.content);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUrlFetching(false);
    }
  }, [urlInput, onMarkdownChange]);

  const canSubmit = markdown.trim().length > 0;

  const tabs: Array<{ key: ImportTab; icon: React.ReactNode; label: string }> = [
    { key: "write", icon: <EditOutlined />, label: "直接编写" },
    { key: "file", icon: <FileAddOutlined />, label: "本地文件" },
    { key: "url", icon: <LinkOutlined />, label: "链接导入" },
  ];

  return (
    <div className="prd-import-page">
      {/* Tab bar */}
      <div className="prd-import-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`prd-import-tab ${tab === t.key ? "prd-import-tab--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="prd-import-tab prd-import-tab--history"
          onClick={onOpenLegacyImport}
        >
          <HistoryOutlined />
          <span>历史记录</span>
        </button>
        <div className="prd-import-tabs__spacer" />
        <button
          type="button"
          className="mission-btn-primary"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {COPY.inlinePrd.submit}
        </button>
      </div>

      {/* Tab content */}
      <div className="prd-import-body">
        {tab === "write" ? (
          <div className="prd-import-editor-wrap">
            <Typography.Paragraph type="secondary" className="prd-import-hint">
              {COPY.inlinePrd.hint}
            </Typography.Paragraph>
            <PrdMarkdownEditor
              value={markdown}
              onChange={onMarkdownChange}
              imageBucket={imageBucket}
              floatingToolbar
              blockEdit={false}
              minHeight={520}
            />
            <Typography.Text type="secondary" className="prd-import-char-count">
              {COPY.inlinePrd.charCount(markdown.length)}
            </Typography.Text>
          </div>
        ) : tab === "file" ? (
          <div className="prd-import-dropzone">
            {filePath ? (
              <div className="prd-import-file-loaded">
                <CheckCircleOutlined style={{ fontSize: 20, color: "var(--mission-success)" }} />
                <div style={{ flex: "1 1 0%", minWidth: 0 }}>
                  <Typography.Text strong style={{ display: "block" }}>
                    已加载
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {filePath}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {markdown.length.toLocaleString()} 字符
                  </Typography.Text>
                </div>
                <button type="button" className="prd-import-repick-btn" onClick={handlePickFile}>
                  重新选择
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="prd-import-dropzone-btn"
                onClick={handlePickFile}
                disabled={fileLoading}
              >
                {fileLoading ? (
                  <LoadingOutlined style={{ fontSize: 28 }} />
                ) : (
                  <FileAddOutlined style={{ fontSize: 28 }} />
                )}
                <span className="prd-import-dropzone-label">
                  {fileLoading ? "读取中…" : "选择 .md 文件"}
                </span>
                <span className="prd-import-dropzone-hint">
                  支持 Markdown 和纯文本文件，内容将加载到编辑器中
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className="prd-import-url">
            <div className="prd-import-url__input-row">
              <Input
                size="large"
                placeholder="粘贴语雀文档、GitHub、或任意网页链接…"
                prefix={<LinkOutlined />}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onPressEnter={handleFetchUrl}
                allowClear
              />
              <button
                type="button"
                className="mission-btn-primary"
                disabled={!urlInput.trim() || urlFetching}
                onClick={handleFetchUrl}
              >
                {urlFetching ? <LoadingOutlined /> : "拉取"}
              </button>
            </div>
            {urlFetched ? (
              <div className="prd-import-url__result">
                <CheckCircleOutlined style={{ fontSize: 20, color: "var(--mission-success)" }} />
                <div style={{ flex: "1 1 0%", minWidth: 0 }}>
                  <Typography.Text strong style={{ display: "block" }}>
                    {urlFetched.title || "未命名文档"}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ display: "block", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {urlFetched.sourceUrl}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {markdown.length.toLocaleString()} 字符已提取
                  </Typography.Text>
                </div>
              </div>
            ) : null}
            <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 12 }}>
              支持语雀文档、GitHub、Confluence 等网页。自动剥离 HTML 提取正文。
            </Typography.Text>
          </div>
        )}
      </div>
    </div>
  );
}
