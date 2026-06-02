# Implement Plan: Refactor useClaudeSessions into modules

## Step Checklist

- [ ] 1) 阅读并标注 `useClaudeSessions.ts` 的职责分段（类型、常量、纯函数、状态、effects、actions）。
- [ ] 2) 先迁移低风险内容：`types/constants/utils`。
- [ ] 3) 在主文件接入新模块并保持编译通过。
- [ ] 4) 逐步迁移中等风险逻辑（状态辅助、可独立 action 组）。
- [ ] 5) 收敛主文件：仅保留 hook 入口、核心副作用编排、对外返回。
- [ ] 6) 运行类型检查与 lint，修复新增问题。
- [ ] 7) 自检 API 兼容性并记录结果。

## Execution Notes

- 每次迁移保持小步提交思维（虽然当前不要求提交，但按小步验证执行）。
- 优先“搬运 + 引用替换”，避免在同一步引入语义调整。
- 遇到不确定逻辑先保留在主文件，避免过度拆分。

## Validation Commands

```bash
bunx tsc --noEmit --pretty false
```

必要时补充针对性测试或额外检查，但不启动 dev server。

## Rollback Points

- 若某轮拆分导致 TS 大量回归，先回退该轮模块接入，保留已验证通过的拆分层。
- 若出现跨模块循环依赖，优先将共享逻辑下沉至 `utils/types` 解除耦合。
