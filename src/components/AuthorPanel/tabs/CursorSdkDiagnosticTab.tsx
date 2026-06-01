import { CursorSdkDiagnosticPanel } from "../../CursorSdkDiagnosticPanel";
import "./CursorSdkDiagnosticTab.css";

export interface CursorSdkDiagnosticTabProps {
  /** 当前活动仓库绝对路径，预填诊断页 repo 参数 */
  repositoryPath?: string | null;
}

/** 工作台配置内嵌诊断（与 /demo.html 共用面板，不走 iframe，以保留 Tauri IPC）。 */
export function CursorSdkDiagnosticTab({ repositoryPath }: CursorSdkDiagnosticTabProps) {
  return (
    <div className="author-panel-cursor-sdk-diagnostic">
      <CursorSdkDiagnosticPanel
        initialRepositoryPath={repositoryPath}
        autoProbeOnMount
        showStandaloneHint={false}
      />
    </div>
  );
}
