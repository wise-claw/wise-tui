import { Layout } from "antd";
import { WorkspaceViewportLoading } from "./WorkspaceViewportLoading";

/** 工作区主壳懒加载占位：Spin 相对视口居中，避免被左栏占位挤偏。 */
export function AppWorkspaceLayoutShell() {
  return (
    <Layout
      className="app-main-layout app-workspace-layout-shell"
      style={{ minWidth: 0, flex: 1, minHeight: 0, height: "100%" }}
    >
      <WorkspaceViewportLoading />
    </Layout>
  );
}
