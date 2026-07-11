import { dispatchWorkspaceTodosOpen } from "../constants/workspaceTodosEvents";

export function openWorkspaceTodosFromSidebarMenu(input: {
  focusAdd?: boolean;
} = {}): void {
  dispatchWorkspaceTodosOpen({
    focusAdd: input.focusAdd ?? true,
    surface: "modal",
  });
}
