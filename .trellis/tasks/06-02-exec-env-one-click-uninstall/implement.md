# Implement Plan - 执行环境一键卸载

## Steps

1. 后端实现卸载能力
   - 在 `agent_registry.rs` 新增 builtin 卸载规格与 `run_npm_global_uninstall`
   - 新增 `agent_registry_uninstall_builtin` Tauri command
   - 在 `lib_impl.rs` 注册新 command

2. 前端服务层接入
   - 在 `src/services/agentRegistry.ts` 新增 `uninstallBuiltinAgent`

3. 前端卡片交互
   - 在 `AgentRegistrySection.tsx` 增加卸载状态 `uninstallingId`
   - 新增 `handleUninstall`
   - 在可用内置入口上展示「一键卸载 + Popconfirm」

4. 验证
   - 对改动文件进行 lint/类型检查
   - 运行最小测试命令，确认无回归

## Validation Commands

- `bunx tsc --noEmit --pretty false`
- `bun test src/components/ClaudeConfigDirPanel/AgentRegistrySection.test.tsx`

## Rollback

- 若卸载命令行为异常，可回滚新增 IPC 和前端按钮逻辑，不影响既有安装与探测能力。
