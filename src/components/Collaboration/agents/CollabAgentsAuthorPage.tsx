import { ApartmentOutlined } from "@ant-design/icons";
import { AuthorPanelPageShell } from "../../AuthorPanel/AuthorPanelPageShell";
import { CollabResourcesHubSection } from "../resources/CollabResourcesHubSection";
import { CollabAgentsHubSection } from "./CollabAgentsHubSection";

/** 配置中心「协作智能体」：创建/启用仓库智能体，并管理跨项目共享资源。 */
export function CollabAgentsAuthorPage() {
  return (
    <AuthorPanelPageShell
      id="collab-agents"
      icon={<ApartmentOutlined />}
      title="协作智能体"
      subtitle="先创建并启用智能体、绑定仓库，再在会话输入框 @ 它讨论、规划或执行多仓库需求。配置中心的「仓库智能体」是浏览仓库 .agents 目录的旧页，不是这里。"
    >
      <div className="collab-author-page">
        <CollabAgentsHubSection />
        <CollabResourcesHubSection />
      </div>
    </AuthorPanelPageShell>
  );
}
