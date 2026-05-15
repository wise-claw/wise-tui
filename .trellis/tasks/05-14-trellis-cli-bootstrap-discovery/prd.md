# 新建项目内置 Trellis：未找到 `trellis` 可执行文件

## Goal

用户在 Wise 中「新建项目」并勾选内置 Trellis 时，应能可靠完成 `trellis init`（或得到可执行的修复路径）；当前在部分环境（尤其从 `.app` 启动、PATH 精简）下会直接失败并提示安装 CLI。

## User value

- 降低「已安装 Trellis 却仍报错」的挫败感。
- 明确区分「未安装」与「装了但 GUI 进程 PATH 探测不到」两类情况的可行动指引。

## Confirmed facts（来自代码库）

- 入口命令：`bootstrap_trellis_if_missing`（`src-tauri/src/trellis_bootstrap.rs`）。
- 查找顺序概要：
  1. 在 `claude_path_search_prefixes()`（`src-tauri/src/claude_commands.rs`）所列目录下拼接 `trellis` 文件名，存在且为文件则采用。
  2. 非 Windows：`which trellis`，`PATH` 为上述前缀与进程现有 `PATH` 的合并（`merge_path_env`）。
  3. 非 Windows：依次用 `/bin/zsh -l -c 'command -v trellis'`、`/bin/bash -lc 'command -v trellis'` 尝试登录式 shell 解析路径。
- 已覆盖的常见前缀包括：`/opt/homebrew/bin`、`/usr/local/bin`、`~/bin`、`~/.local/bin`、`~/.volta/bin`、`~/.bun/bin`、`~/.npm-global/bin`、按版本排序的 `~/.nvm/...`、`NVM_DIR`、`fnm` 的 node-versions 目录等。
- **未**在 `claude_path_search_prefixes` 中出现的路径示例：`~/.cargo/bin`（若 Trellis 以 Rust/cargo 方式安装则可能漏检）。
- 登录 shell 回退**仅** zsh/bash，Fish 等用户的 `trellis` 若只写在 fish 配置里，该回退可能无效。
- 错误文案即用户所见字符串，硬编码于 `find_trellis_cli_binary` 的 `Err(...)`。

## Requirements（待产品决策后细化）

- （待定）在「自动探测失败」场景下，产品允许的兜底手段范围（见下方开放问题）。

## Acceptance Criteria（草案，待确认后定稿）

- [ ] 在至少一种「Trellis 已装在常见非 GUI PATH、但 .app 继承 PATH 很瘦」的复现环境下，勾选内置 Trellis 能成功完成 init，或给出与真实原因一致的引导（可测：集成/手测步骤写入 `design.md`）。
- [ ] 不引入未经约定的持久化配置项（若 PRD 确认需要「手动 CLI 路径」，再补充验收）。

## Out of scope（暂定）

- 不要求 Wise 捆绑完整 Trellis 运行时并实现全部 CLI 语义（除非产品明确选择该方向）。

## Open questions（阻塞规划定稿）

- 见对话中**单条**产品决策问题（探测扩展 vs 用户配置路径 vs 其他）。

## Changelog

- 2026-05-14：从代码库梳理 `trellis_bootstrap` 与 PATH 前缀逻辑，建任务目录。
