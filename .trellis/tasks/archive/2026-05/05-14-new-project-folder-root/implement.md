# 实现清单（草案）

配合 `prd.md` + `design.md` 使用；实施前可将条目同步到 `implement.jsonl`（若走子 Agent）。

## 顺序建议

1. **后端路径工具**：`rootPath` 与仓库路径归属判定（规范化 + 前缀规则），单元测试（含 macOS 路径大小写、尾部 `/`）。
2. **`create_project` / `root_path`**：用户所选目录**直接**写入 `projects.root_path`（与 `find_trellis_project_root_from_path` 的「仅在有 .trellis 祖先时写入」行为对齐产品，见 design §1）。
3. **`add_repository_to_project` 守卫**：若 `project.root_path` 非空且候选仓路径越界 → `Err`，错误信息供前端展示（落实硬性拦截）。
4. **侧栏/UI 收敛**：按 `design.md` §4 移除或隐藏「添加仓库」「拖入加仓」等入口；保留「重新初始化」入口占位（可先 disabled + TODO，直至 §5 完成）。
5. **重新初始化命令**：实现 `design.md` §5.5 方案 A/B；内含 §3 扫描 + 可选图谱重建。
6. **图谱重建逻辑**：与产品确认是「模板全量覆盖」还是「仅修补员工节点」；补 `bun test` 或 Rust 测。
7. **违背状态修复**：进入项目时若检测到越界成员，提示并引导执行重新初始化或手动移出（与 PRD 硬性拦截一致）。

## 验证命令

```bash
bun test
```

（Rust：`cargo test` 在 `src-tauri` 若新增模块测例。）

## 高风险文件（初筛）

- `src/hooks/useRepositoryList.ts` — 创建/加仓/移动逻辑中枢
- `src/components/LeftSidebar/ProjectRepositoryList.tsx`、`repositoryRows.tsx`
- `src-tauri/src/app_state_commands.rs` — `create_project`、`add_repository_to_project`
- `src-tauri/src/wise_db.rs` — `add_repository_to_project` SQL
- `src-tauri/src/app_state_commands/workflow_graph_commands.rs` — 图谱持久化

## 回滚点

合并前保留：未改 `design.md` 白名单外目录的删除类逻辑；图谱覆盖前若加「导出当前图 JSON」可选更佳（产品决定）。
