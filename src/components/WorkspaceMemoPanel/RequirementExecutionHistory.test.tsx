import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClaudeSession } from "../../types";
import { createWorkspaceRequirementItem } from "../../types/workspaceRequirements";
import { RequirementExecutionHistory } from "./RequirementExecutionHistory";

const item = { ...createWorkspaceRequirementItem("修复登录", 1, "1"), status: "verifying" as const, executionSessionIds: ["worker"] };
const session: ClaudeSession = {
  id: "worker", status: "running", claudeSessionId: null, repositoryPath: "/repo", repositoryName: "repo",
  executionEngine: "codex-rpc", model: "", messages: [], createdAt: 1, pendingPrompt: "",
};
const noop = () => {};

describe("requirement execution and acceptance", () => {
  test("disables retry and acceptance while linked work is still running", () => {
    const html = renderToStaticMarkup(<RequirementExecutionHistory item={item} sessions={[session]} busy={false} onDispatch={noop} onAccept={noop} onReject={noop} />);
    expect(html).toContain("运行中");
    const buttons = html.match(/<button\b[^>]*>.*?<\/button>/g) ?? [];
    const actions = buttons.filter((button) => /重新执行|验收失败，继续修改|确认验收完成/.test(button));
    expect(actions).toHaveLength(3);
    expect(actions.every((button) => button.includes('disabled=""'))).toBe(true);
  });
  test("keeps an unavailable historical session visible and recoverable", () => {
    const html = renderToStaticMarkup(<RequirementExecutionHistory item={item} sessions={[]} busy={false} onDispatch={noop} onAccept={noop} onReject={noop} />);
    expect(html).toContain("状态未知");
    expect(html).toContain("会话未加载或已移除");
    expect(html).toContain("查看会话");
    expect(html).not.toContain(">执行结束</span>");
  });
});
