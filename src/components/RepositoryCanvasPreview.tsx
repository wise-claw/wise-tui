import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Select, Spin } from "antd";
import { ReloadOutlined, ExpandOutlined, CompressOutlined } from "@ant-design/icons";
import { buildRepositoryCanvasDocument } from "../utils/repositoryCanvas";
import { loadRepositoryCanvasAssets } from "../services/repositoryCanvasAssets";
import "./RepositoryCanvasPreview.css";

export function RepositoryCanvasPreview({ content, path, root, children, toolbarStart }: { content: string; path: string; root?: string; children?: ReactNode; toolbarStart?: ReactNode }) {
  const isDocument = children != null;
  const [revision, setRevision] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [expanded, setExpanded] = useState(false);
  const [prepared, setPrepared] = useState<{ content: string; warnings: string[] } | null>(null);
  const [loading, setLoading] = useState(Boolean(root) && !isDocument);
  useEffect(() => {
    let cancelled = false;
    setLoading(Boolean(root) && !isDocument);
    setPrepared(null);
    if (!root || isDocument) return;
    const timer = setTimeout(() => {
      void loadRepositoryCanvasAssets(root, path, content).then((result) => {
        if (!cancelled) { setPrepared(result); setLoading(false); }
      }).catch((error) => {
        if (!cancelled) {
          setPrepared({ content, warnings: [`资源加载失败：${String(error)}`] });
          setLoading(false);
        }
      });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [root, path, content, revision, isDocument]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setExpanded(false); }
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [expanded]);
  const document = useMemo(() => buildRepositoryCanvasDocument(prepared?.content ?? content), [prepared, content]);
  return (
    <section className={`app-canvas${expanded ? " app-canvas--expanded" : ""}`} aria-label={`${path} 画布`}>
      <div className="app-canvas__toolbar">
        {toolbarStart}
        <div className="app-canvas__actions">
          <Select size="small" aria-label="画布缩放" value={zoom} onChange={setZoom}
            options={[50, 75, 100, 125, 150, 200].map((value) => ({ value, label: `${value}%` }))} />
          <Button size="small" icon={<ReloadOutlined />} onClick={() => setRevision((value) => value + 1)}>刷新画布</Button>
          <Button size="small" icon={expanded ? <CompressOutlined /> : <ExpandOutlined />}
            onClick={() => setExpanded((value) => !value)}>{expanded ? "收起画布" : "展开画布"}</Button>
        </div>
      </div>
      <div className="app-canvas__viewport" aria-busy={loading}>
        {isDocument ? <div key={revision} className="app-canvas__document" style={{ width: `${10000 / zoom}%`, zoom: zoom / 100 }}>{children}</div> : loading ? <div className="app-canvas__loading"><Spin size="small" /> 正在加载画布资源…</div> : (
          <iframe key={revision} title={`${path} Canvas`} sandbox="allow-scripts" referrerPolicy="no-referrer"
            srcDoc={document}
            style={{ width: `${10000 / zoom}%`, height: `${10000 / zoom}%`, zoom: zoom / 100 }} />
        )}
      </div>
      {prepared?.warnings.length ? (
        <details className="app-canvas__warnings">
          <summary>有 {prepared.warnings.length} 项资源未完整加载</summary>
          <ul>{prepared.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}
