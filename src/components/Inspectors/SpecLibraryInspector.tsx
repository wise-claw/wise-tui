import { Button, Tag, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { SpecLibraryPanel } from "../MissionControl/engineering/SpecLibraryPanel";
import "./Inspectors.css";

interface SpecLibraryInspectorProps {
  rootPath: string;
  onClose: () => void;
}

/**
 * Stage 5 / E7：Trellis Spec 规范库 Inspector(只读速览)。
 * 承接旧 `ProjectTrellisCenter` "规范库" Tab,改为按需打开的叠层透镜。
 * 可写编辑由 `AssistantSettingsDrawer` 的 Specs Tab 承担(待 Stage 4 扩展)。
 */
export function SpecLibraryInspector({
  rootPath,
  onClose,
}: SpecLibraryInspectorProps) {
  return (
    <div className="trellis-inspector" role="region" aria-label="Trellis 规范库">
      <header className="trellis-inspector__head">
        <Typography.Title level={5} className="trellis-inspector__title">
          Trellis 规范库
        </Typography.Title>
        <Tag>{rootPath}</Tag>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onClose}
          aria-label="关闭"
        />
      </header>
      <div className="trellis-inspector__body">
        <SpecLibraryPanel rootPath={rootPath} />
      </div>
    </div>
  );
}
