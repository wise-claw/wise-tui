# Design - 执行环境一键卸载

## Scope

- 前端：`src/components/ClaudeConfigDirPanel/AgentRegistrySection.tsx`
- 服务：`src/services/agentRegistry.ts`
- 后端：`src-tauri/src/agent_registry.rs`、`src-tauri/src/lib_impl.rs`

## Out of Scope

- 不新增批量卸载。
- 不改造自定义入口删除逻辑。
- 不变更 Cursor SDK 的配置流转。

## Data Flow

1. 用户在内置 CLI 卡片点击「一键卸载」。
2. 前端弹出 `Popconfirm` 二次确认。
3. 确认后调用服务层 `uninstallBuiltinAgent(kind)`。
4. 服务层调用 Tauri IPC `agent_registry_uninstall_builtin`。
5. Rust 使用 `npm uninstall -g <package>` 执行卸载。
6. 后端在命令成功后触发 `registry.refresh_all(true, ...)` 并返回最新 agents。
7. 前端刷新列表并展示成功/失败提示。

## API Contract

- 新增 Tauri command：`agent_registry_uninstall_builtin(kind: String) -> Result<Vec<DetectedAgent>, String>`
- `kind` 仅允许：`claude | codex | gemini | opencode`
- 错误风格与 `agent_registry_install_builtin` 保持一致，返回 `String`
- 前端新增服务函数：`uninstallBuiltinAgent(kind: BuiltinInstallableKind): Promise<DetectedAgent[]>`

## UI Rules

- 仅在内置入口且 `available = true` 时展示「一键卸载」。
- 未安装态继续显示「一键安装」。
- 卸载按钮为危险语义（`danger`）并带确认文案。
- 交互期间复用已有 `installingId` 风格，新增 `uninstallingId` 防止重复触发。

## Risks and Mitigations

- 风险：`npm` 不存在导致卸载命令失败。  
  规避：复用 `resolve_npm_binary`，返回明确错误提示。
- 风险：系统中存在非 npm 安装的同名命令。  
  规避：错误中保留 stdout/stderr，提示用户手工检查 PATH。
- 风险：卸载后探测缓存未刷新。  
  规避：统一使用 `refresh_all(true, ...)` 强制探测。
