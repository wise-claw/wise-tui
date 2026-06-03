import { dispatchWorkspaceTodosOpen } from "../constants/workspaceTodosEvents";
import { workspaceTodosAnchorKey } from "./workspaceTodosAnchorKey";

export function openWorkspaceTodosFromSidebarMenu(input: {
  projectId: string | null;
  repositoryId: number | null;
  focusAdd?: boolean;
}): void {
  dispatchWorkspaceTodosOpen({
    projectId: input.projectId,
    repositoryId: input.repositoryId,
    focusAdd: input.focusAdd ?? true,
    surface: "modal",
    anchorKey: workspaceTodosAnchorKey(input.projectId, input.repositoryId),
  });
}
