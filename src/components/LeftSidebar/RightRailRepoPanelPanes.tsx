import { memo, type ReactNode } from "react";

export type RightRailRepoPanelPanesProps = {
  showGit: boolean;
  showFiles: boolean;
  gitPane: ReactNode;
  filesPane: ReactNode;
};

export const RightRailRepoPanelPanes = memo(function RightRailRepoPanelPanes({
  showGit,
  showFiles,
  gitPane,
  filesPane,
}: RightRailRepoPanelPanesProps) {
  return (
    <div className="app-right-repo-panel-tab-content">
      <div
        className={
          "app-right-repo-panel-tab-pane" +
          (!showGit ? " app-right-repo-panel-tab-pane--hidden" : "")
        }
        hidden={!showGit ? true : undefined}
        aria-hidden={!showGit}
      >
        {gitPane}
      </div>
      <div
        className={
          "app-right-repo-panel-tab-pane" +
          (!showFiles ? " app-right-repo-panel-tab-pane--hidden" : "")
        }
        hidden={!showFiles ? true : undefined}
        aria-hidden={!showFiles}
      >
        {filesPane}
      </div>
    </div>
  );
});
