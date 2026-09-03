import "./WorkspaceViewportLoading.css";

/** 相对整个应用视口居中的加载态（不受左栏占位影响）。 */
export function WorkspaceViewportLoading() {
  return (
    <div
      className="app-workspace-loading-overlay app-workspace-loading-overlay--viewport"
      aria-busy="true"
      aria-live="polite"
      aria-label="加载中"
    >
      <span className="app-workspace-loading-spinner" aria-hidden="true" />
    </div>
  );
}
