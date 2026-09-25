import { CollabRepositoryAgentsModal } from "./agents/CollabRepositoryAgentsModal";
import { CollabRequirementCreateModal } from "./requirement/CollabRequirementCreateModal";
import { CollabRequirementDetailDrawer } from "./requirement/CollabRequirementDetailDrawer";
import { CollabProjectSharingModal } from "./resources/CollabProjectSharingModal";

/** 协作层全局浮层（仓库智能体管理、项目协作与共享、需求详情），在主窗口挂载一次。 */
export function CollabUiHost() {
  return (
    <>
      <CollabRepositoryAgentsModal />
      <CollabProjectSharingModal />
      <CollabRequirementCreateModal />
      <CollabRequirementDetailDrawer />
    </>
  );
}
