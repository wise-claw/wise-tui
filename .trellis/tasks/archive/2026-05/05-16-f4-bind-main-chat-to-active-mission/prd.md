# F4 bind main chat dispatch to active mission

## Parent

`05-16-mission-control-acceptance-closeout/design.md §4` 与 `implement.md Step 6`。

## Scope

1. 新增 `src/services/mission/sessionBinding.ts`：`ensureSessionBoundToActiveMission(sessionId, projectId, rootPath)` → 取 `mission_list_recent({ projectId, limit: 5 })` 中 stage != done/archived 的最新条目，若未绑则 `mission_attach_to_session`。
2. `AppImpl.tsx` 在 Claude session 激活点调用 ensure（异步，不阻塞 UI；改动 ≤ 15 行，符合父任务 E4）。
3. 新增 `src/components/ClaudeChatInput/missionMentionHook.ts`：解析消息中的 `@xxx`，对每个 mention 调 `mission_record_agent_command({ missionId, commandType:"mention", targetKind:"text", targetId: mention })`；消息提交后 `mission_append_event({ eventType:"mission.session.message", payload:{ sessionId, snippet, mentions } })`。
4. `composer-region.tsx` commit handler 调用 helper（最薄接线，不在 composer 中堆业务）。
5. `MissionReplayPanel.tsx` 事件 payload 含 sessionId 时显示 sessionId 标签（不强求跳转，仅信息展示）。

## Out of Scope

- 不实现 mention 自动补全 / 高亮（仅运行期解析 + 后端记录）。
- 不修改 Claude session 路由 / window 管理。
- 不实现"跳到会话"双向链接的实际跳转动作。

## Acceptance

- [ ] 主会话首次激活后 `mission_session_bindings` 表出现 sessionId↔missionId 行。
- [ ] 主会话发"修改需求 @后端 加缓存"后，`mission_agent_commands` 出现一条 commandType=`mention` 记录，`mission_events` 出现一条 `mission.session.message` 记录。
- [ ] 项目无 active mission 时所有写入静默 skip，不报错。
- [ ] `bun test src/services/mission src/components/ClaudeChatInput` + `bunx tsc --noEmit` 通过。
