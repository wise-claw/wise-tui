import { Button } from "antd";
import { WiseCcWorkflowStudioRoot } from "./WiseCcWorkflowStudioRoot";

export interface WiseCcWorkflowStudioPanelProps {
  repositoryPath: string;
  onClose: () => void;
  /** false 时保留 Webview/MCP 桥接，仅隐藏叠层（供 Claude Code MCP 继续读写画布）。 */
  overlayVisible?: boolean;
}

/**
 * 全屏叠层：嵌入上游 CC Workflow Studio（AGPL，见 `src/features/cc-wf-studio/NOTICE.md`）。
 */
export function WiseCcWorkflowStudioPanel({
  repositoryPath,
  onClose,
  overlayVisible = true,
}: WiseCcWorkflowStudioPanelProps) {
  return (
    <div
      className={
        overlayVisible ? "wise-cc-wf-studio-overlay" : "wise-cc-wf-studio-background-host"
      }
      role={overlayVisible ? "region" : undefined}
      aria-label={overlayVisible ? "CC Workflow Studio" : undefined}
      aria-hidden={overlayVisible ? undefined : true}
    >
      {overlayVisible ? (
        <div className="wise-cc-wf-studio-overlay-toolbar">
          <Button type="text" size="small" onClick={onClose}>
            关闭
          </Button>
        </div>
      ) : null}
      <div
        id="wise-cc-wf-studio-modal-root"
        className={overlayVisible ? "wise-cc-wf-studio-overlay-body" : undefined}
      >
        <WiseCcWorkflowStudioRoot repositoryPath={repositoryPath} />
      </div>
    </div>
  );
}
