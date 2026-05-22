---
name: wise-remote-channels
description: "用于 Wise 远程入口、Channel、WebSocket 推送、钉钉/飞书/企业微信/Telegram 集成、远程消息入站出站、Channel UI 或相关 Tauri IPC 改动。"
---

# Wise Remote Channels

修改 Wise 的远程连接、远程入口、通道配置、消息推送、IM 机器人或 Channel 产品面时使用本 Skill。

## 先读

1. 先用 `wise-before-dev` 读取当前 Trellis 任务和适用 spec。
2. 涉及产品入口或配置中心时，读取 `.trellis/spec/guides/agent-harness-architecture.md`。
3. 涉及前后端链路时，读取：
   - `.trellis/spec/frontend/index.md`
   - `.trellis/spec/tauri/index.md`
   - `.trellis/spec/guides/cross-layer-thinking-guide.md`

## 产品归属

远程连接统一归到 Author 域的 **Channel / Remote Access**，不要新增单平台顶级菜单。

- 钉钉、飞书、企业微信、Telegram 都是 Channel 的具体适配器。
- 通用 WebSocket 是远程中继/自建网关适配器。
- `wise_push` 是把远端推送转成本地 Wise 通知/入站消息的低层能力，不应单独变成产品顶级入口。
- 远程入口的目标是让外部平台触发 Wise 工作台 loop，而不是绕过 Mission/Trellis 运行态。

## 代码地图

前端：

- `src/components/ChannelsPanel/`：统一远程入口配置页。
- `src/components/ChannelsPanel/index.tsx`：Channel 列表、钉钉 Stream 网关开关、配置状态汇总。
- `src/components/ChannelsPanel/FeishuChannelBody.tsx`：飞书自建机器人 Webhook。
- `src/components/ChannelsPanel/WecomChannelBody.tsx`：企业微信群机器人 Webhook。
- `src/components/ChannelsPanel/TelegramChannelBody.tsx`：Telegram Bot。
- `src/components/ChannelsPanel/GenericWebSocketChannelBody.tsx`：通用 WebSocket 客户端。
- `src/components/DingTalkEnterpriseBotPopoverBody.tsx`：钉钉企业内部机器人配置、联调说明、旧入口兼容。
- `src/components/DingTalkStreamGatewayTopbarSwitch.tsx`：钉钉 Stream 网关顶部开关。

前端服务：

- `src/services/remoteChannels.ts`：飞书、企微、Telegram、通用 WebSocket 的 IPC wrapper 和设置读写。
- `src/services/dingtalkEnterpriseBot.ts`：钉钉企业机器人配置、ping、单聊 Markdown/图片发送。
- `src/services/dingtalkStreamGateway.ts`：钉钉 Stream 网关 start/stop/status。
- `src/services/dingtalkWiseAutomation.ts`：钉钉自动化回发 Markdown/图片。
- `src/services/dingTalkAutomationReplyBody.ts`：从 Claude 会话提取钉钉回发正文。

Tauri：

- `src-tauri/src/remote_channels.rs`：飞书、企微、Telegram、通用 WebSocket 实现。
- `src-tauri/src/dingtalk_enterprise_bot.rs`：钉钉企业内部机器人出站消息。
- `src-tauri/src/dingtalk_stream_gateway.rs`：本机内嵌钉钉 Stream 长连接入站。
- `src-tauri/src/wise_push.rs`：远端 WebSocket 推送入站，复用 `wise_notification_ingest` 逻辑。
- `src-tauri/src/lib_impl.rs`：Tauri state 管理和命令注册。

## 当前通道能力

- 飞书：`feishu_webhook_send` / `feishu_webhook_test`，设置 key 为 `wise.channels.feishu.v1`，支持 `text` / `post` 和可选 secret 签名。
- 企业微信：`wecom_webhook_send` / `wecom_webhook_test`，设置 key 为 `wise.channels.wecom.v1`，支持 `text` / `markdown`。
- Telegram：`telegram_bot_send_message` / `telegram_bot_test`，设置 key 为 `wise.channels.telegram.v1`，测试走 `getMe`。
- 通用 WebSocket：`generic_ws_start` / `generic_ws_stop` / `generic_ws_status` / `generic_ws_send_text`，设置 key 为 `wise.channels.genericWs.v1`，事件为 `wise:generic-ws:status` 和 `wise:generic-ws:message`。
- 钉钉企业机器人：`dingtalk_enterprise_bot_*`，设置 key 为 `wise.dingtalk.enterprise_bot.v1`，支持单聊 Markdown、公网图片 URL、本机图片上传。
- 钉钉 Stream 网关：`dingtalk_stream_gateway_start` / `stop` / `is_running` / `status`，用已保存的钉钉企业机器人配置建立长连接。
- Wise Push：`wise_push_start` / `wise_push_stop`，接收 `{ conversationId, messageId?, body }` JSON 帧并入站。

## 设计规则

- 新增平台时先判断是否能作为 `ChannelsPanel` 的一个适配器，而不是新增侧栏或顶栏入口。
- UI 文案优先中文，状态要区分“未配置”“已配置”“运行中”“连接中”“错误”。
- 配置保存走 `src/services/appSettingsStore`，设置 key 使用 `wise.channels.<channel>.v1` 风格；钉钉历史 key 保持兼容。
- React 组件不要直接 `invoke`，必须通过 `src/services/*`。
- Tauri 命令返回 `Result<T, String>`；跨 IPC DTO 用 camelCase。
- 长连接必须有 start/stop/status，状态中至少包含 phase、running、lastError、lastInboundAt 或同等字段。
- 入站消息要截断或限长，避免远端 payload 撑爆本地会话、通知或数据库。
- 出站消息要处理平台限流、错误码和用户可读错误；不要只吞掉 raw response。
- Secret、Token、Webhook URL 不要打印到日志、错误文本或 UI 预览。
- 不要删除旧钉钉入口；需要产品收敛时，把旧能力包装进 Channel 面板。

## 验证

优先跑聚焦测试，不启动 dev server：

```bash
bun test src/components/ChannelsPanel/index.test.tsx
bunx tsc --noEmit --pretty false
```

若改到 Rust 长连接或 HTTP 客户端，补充相应 `cargo test` / `cargo check`，并确认命令不会启动 Tauri 桌面窗口。

