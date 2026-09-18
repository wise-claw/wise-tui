import { useMemo, useState } from "react";
import { Modal, Segmented } from "antd";
import { conversationCanvasArtifacts } from "../utils/canvasArtifacts";
import { DocumentCanvasPreview } from "./DocumentCanvasPreview";
import { RepositoryCanvasPreview } from "./RepositoryCanvasPreview";

export default function ConversationCanvasModal({ source, onClose }: { source: string; onClose: () => void }) {
  const artifacts = useMemo(() => conversationCanvasArtifacts(source), [source]);
  const [selected, setSelected] = useState(0);
  const [showSource, setShowSource] = useState(false);
  const artifact = artifacts[selected] ?? artifacts[0];
  return (
    <Modal open title="画布 · 页面与产品方案" onCancel={onClose} footer={null} width="94vw"
      centered destroyOnHidden zIndex={3100} styles={{ body: { height: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" } }}>
      <div className="app-canvas__toolbar">
        <label>查看内容 <select aria-label="画布内容" value={artifacts.indexOf(artifact)} onChange={(event) => setSelected(Number(event.target.value))}>
          {artifacts.map((item, index) => <option key={item.path} value={index}>{item.title}</option>)}
        </select></label>
        <Segmented value={showSource ? "source" : "preview"} onChange={(value) => setShowSource(value === "source")}
          options={[{ label: "画布", value: "preview" }, { label: "原文", value: "source" }]} />
      </div>
      {showSource ? <pre className="app-canvas__source">{artifact.content}</pre> : artifact === artifacts[0] ? (
        <DocumentCanvasPreview key={artifact.path} content={artifact.content} path={artifact.path} />
      ) : <RepositoryCanvasPreview key={artifact.path} content={artifact.content} path={artifact.path} />}
    </Modal>
  );
}
