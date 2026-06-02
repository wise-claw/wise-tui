# 执行环境提供一键卸载能力

## Goal

在「执行环境」面板中，为内置 CLI 入口（Claude Code / Codex CLI / Gemini CLI / OpenCode）提供一键卸载能力，降低用户手工卸载门槛，并让安装/卸载入口形成闭环。

## Requirements

- 在执行环境卡片中，已安装且可探测到的内置 CLI 入口应展示「一键卸载」操作。
- 卸载操作需提供二次确认，明确提示将执行的卸载命令与影响范围。
- 卸载成功后立即刷新探测状态，卡片应回到未安装/待就绪状态。
- 卸载失败时应向用户展示可读错误信息，不可静默失败。
- 不改变已有能力：自定义入口继续使用「编辑/删除」，Cursor SDK 继续使用「配置 API Key」，未安装入口继续使用「一键安装」。
- 前端不得直接调用 `invoke`，需经 `src/services/agentRegistry.ts` 包装。
- 后端命令需保持现有数据与命令兼容，不删除已有安装/探测能力。

## Acceptance Criteria

- [ ] 内置 CLI 卡片在 `available = true` 时出现「一键卸载」按钮，点击后出现确认弹窗。
- [ ] 点击确认后调用新的卸载 IPC，成功时提示「<name> 卸载成功」并刷新列表状态。
- [ ] 卸载失败时展示错误信息，列表状态保持可追踪（不出现假成功）。
- [ ] 未安装内置 CLI 仍显示「一键安装」；`custom` 与 `cursor` 卡片行为不变。
- [ ] 通过最小必要校验（至少包含相关单测或现有测试通过）。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
