---
name: wise-tauri-ipc
description: "用于 Wise Tauri/Rust IPC、src-tauri commands、前端 service wrapper、SQLite migration、filesystem/path 安全、Tauri capabilities、事件流、长任务或跨前后端 DTO 契约改动。"
---

# Wise Tauri IPC

修改 Wise 后端命令、前端 IPC wrapper、数据库、文件系统、进程、事件或跨层 DTO 时使用本 Skill。

## 先读

1. 先用 `wise-before-dev`。
2. 读取 `.trellis/spec/tauri/index.md`。
3. 按改动类型读取：
   - `.trellis/spec/tauri/ipc-guidelines.md`
   - `.trellis/spec/tauri/security-and-filesystem.md`
   - `.trellis/spec/tauri/persistence-and-migrations.md`
4. 如果同时改前端，读取 `.trellis/spec/frontend/index.md` 与 `.trellis/spec/guides/cross-layer-thinking-guide.md`。

## 跨层契约

Wise 的 IPC 链路固定为：

```text
React component/hook
  -> src/services/<domain>.ts
  -> invoke("<tauri_command>", typed camelCase payload)
  -> #[tauri::command] Rust function
  -> Result<T, String>
```

组件和 hooks 不直接调用 raw `invoke`。新增命令必须先有或同步补齐 service wrapper。

## 代码地图

Tauri 入口：

- `src-tauri/src/lib.rs`：模块声明。
- `src-tauri/src/lib_impl.rs`：app setup、managed state、command registration。
- `src-tauri/src/main.rs`：进程入口。

通用基础：

- `src-tauri/src/wise_db.rs`：SQLite 初始化与 migration include list。
- `src-tauri/migrations/`：append-only migrations。
- `src-tauri/src/wise_paths.rs`：`~/.wise` 路径与 atomic file helpers。
- `src-tauri/capabilities/default.json`：Tauri 2 权限 allowlist。

常见命令模块：

- `src-tauri/src/app_state_commands/`
- `src-tauri/src/repository_files.rs`
- `src-tauri/src/git_commands.rs`
- `src-tauri/src/claude_commands.rs` 与 `src-tauri/src/claude_commands/`
- `src-tauri/src/mission_control.rs`
- `src-tauri/src/trellis_runtime.rs`
- `src-tauri/src/skills/`
- `src-tauri/src/mcp/`
- `src-tauri/src/extensions/`
- `src-tauri/src/remote_channels.rs`

前端服务：

- `src/services/*` 是所有 Tauri 调用的边界。
- 服务层负责 trim、默认值、参数形状、返回类型，而不是让组件拼 IPC payload。

## DTO 规则

- Rust 返回给 TypeScript 的结构体使用 `#[serde(rename_all = "camelCase")]`。
- TypeScript 类型与 Rust DTO 字段保持同名 camelCase。
- 命令返回 `Result<T, String>`；错误信息要可读、可直接展示。
- 不要把 secret、token、webhook、完整环境变量放进错误或日志。

## 命令规则

- 短任务可直接返回结果。
- 长任务要考虑 status、cancel/stop、event emit 或后台 task handle。
- 共享状态使用 `tauri::State`，注意锁粒度，不要持锁 await。
- 进程调用、网络调用、文件读写都要有明确错误上下文。
- 新命令要注册到 `lib_impl.rs`，新模块要声明到 `lib.rs`。
- 如果使用 Tauri API 权限或 asset scope，检查 `src-tauri/capabilities/default.json` 和 `tauri.conf.json`。

## 文件系统与持久化

- 用户传入路径必须校验和 canonicalize；不要信任前端传来的路径。
- App 数据优先放在 `~/.wise/`，使用 `wise_paths.rs` helper。
- 写 JSON/settings 优先 atomic temp + rename。
- SQLite schema 只能追加 migration，不改旧 migration。
- 新表或新字段要考虑旧数据、空值、默认值和迁移幂等。
- UI cleanup 不等于删除后端能力；旧命令、数据和集成路径需要保留或迁移包装。

## 验证

前端契约：

```bash
bunx tsc --noEmit --pretty false
bun test
```

Rust 改动按范围补充：

```bash
cd src-tauri && cargo check
cd src-tauri && cargo test
```

不要启动 `bun run dev`、`bun run tauri:dev` 或桌面窗口，除非用户明确要求。

