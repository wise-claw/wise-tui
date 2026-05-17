# F2 failure diagnostics and retry-from-run-dir

## Parent

`05-16-mission-control-acceptance-closeout/design.md §2` 与 `implement.md Step 3`。沿用父任务约定。

## Scope

1. 新增 Rust 命令 `prd_split_retry_run(input: { runId, projectRootPath, missionId?, clusterId, model? }) -> { newRunId, newRunDir }`：复用旧 runDir 的 `dispatch.meta.json` + `prompt.md`，启动新 run；旧 `run-result.json` patch `"superseded_by": newRunId`。需要把 `dispatch_cluster_impl` 内核抽到 `dispatch_with_prepared_prompt` thin helper。
2. 新增 TS service `retryClusterFromRunDir(input)`（wraps Tauri 命令）。
3. `runMissionActions.retryClusterFromRunDir(runId, clusterId, state, api, missionId)` 调命令后接管 splitterStreamListener。
4. 新增组件 `details/FailureEvidenceBlock.tsx`：渲染 exitCode / stdoutPath / stderrPath / runDir，提供"打开"（`@tauri-apps/plugin-shell.open`）与"复制路径"按钮。
5. `details/TaskDetailDrawer.tsx` 失败分支接 `FailureEvidenceBlock` + "从 runDir 重试" 次级按钮。
6. 若 `shell:allow-open` capability 缺失，按最小 scope 加到 `capabilities/default.json`（限 `~/.wise/prd-runs/**` 与 `~/.trellis/**`）。

## Out of Scope

- 不改 splitter prompt 内容、不动 splitter event 协议。
- 不实现 stdout/stderr 大文件 streaming 浏览器（一键打开本地文件即可）。
- 不修改 mission_events schema。

## Acceptance

- [ ] dispatch 失败后 TaskDetailDrawer 直接展示 4 个字段并能打开 stdout/stderr 本地文件。
- [ ] "从 runDir 重试" 启动新 run，新 run 接收 splitter-output 事件，旧 run-result.json 写入 `superseded_by`。
- [ ] dispatch.meta.json 缺失或 clusterId 不匹配时 retry 命令返回明确错误。
- [ ] Rust 单测覆盖 retry 命令三种异常路径；TS 单测覆盖 FailureEvidenceBlock 渲染 + retry 调用。
- [ ] `cargo check` + `cargo test prd_split` + `bun test` + `bunx tsc --noEmit` 通过。
