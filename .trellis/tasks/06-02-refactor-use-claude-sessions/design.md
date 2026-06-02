# Design: Refactor useClaudeSessions into modules

## Scope

- In scope:
  - `src/hooks/useClaudeSessions.ts` 结构化拆分。
  - 新增同目录子模块（按职责分层）。
  - 主 hook 仅保留对外 API、主流程编排和少量胶水代码。
- Out of scope:
  - Claude 会话业务语义变更。
  - UI 组件或 Tauri IPC 协议改动。
  - 非必要的跨模块重命名和行为优化。

## Architecture

目标目录（可按实际代码微调）：

- `src/hooks/useClaudeSessions.ts`：保留对外 `useClaudeSessions` 与顶层编排。
- `src/hooks/useClaudeSessions/`（新目录）：
  - `types.ts`：内部类型与共享类型别名。
  - `constants.ts`：本 hook 私有常量。
  - `utils.ts`：纯函数与无副作用工具。
  - `state.ts` 或 `reducers.ts`：状态初始化、状态变换辅助。
  - `actions/*.ts`（可选）：按子能力拆分流程（会话加载、消息处理、运行态同步等）。

## Compatibility Contract

- 对外导出保持兼容（命名导出与默认行为不变）。
- 调用方类型推断保持兼容。
- 事件订阅/解绑与副作用触发时机保持一致。
- 不改变现有错误处理语义和 fallback 路径。

## Risks & Mitigations

- 风险：拆分中引入闭包/依赖数组变化，导致副作用时序回归。  
  缓解：优先抽离纯函数；副作用逻辑先保持原位置再逐步下沉。

- 风险：内部私有类型迁移导致 TS 推断变化。  
  缓解：先迁移类型声明，再迁移实现；每轮迁移后运行类型检查。

- 风险：循环依赖。  
  缓解：单向依赖设计（types/constants -> utils -> actions -> 主 hook）。

## Validation Strategy

- 静态校验：`bunx tsc --noEmit --pretty false`
- 质量校验：针对变更文件执行 lint 检查（IDE lints + 必要命令）
- 行为校验：确保调用方无编译改动需求，关键数据流与 effect 触发逻辑一致。
