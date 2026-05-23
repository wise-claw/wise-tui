# 分析期：用 LLM 代理捕获 FCC HTTP

FCC **直连**时 Wise 不在 HTTP 路径上。临时抓包可按以下步骤（无需改 FCC）：

1. **默认配置** → 打开顶栏 **LLM 代理** 图标。
2. 开启 **流量监听**；**上游** 填当前 FCC 地址（通常为 `http://127.0.0.1:8082`，与 `~/.claude/settings.json` 中 `ANTHROPIC_BASE_URL` 一致）。
3. **新建或重启** Claude 子进程（已有 Wise 注入：监听开启时子进程 `ANTHROPIC_BASE_URL` 指向 Wise 本地代理）。
4. 在 **全链路分析** 或 **LLM 代理** 面板查看 HTTP 记录；导出链路包时 `sources.llmProxyRecordCount > 0`。

链路：`Claude Code → Wise LLM 代理 → fcc-server → 上游 Provider`。

恢复直连：关闭 LLM 代理监听，并确保 `settings.json` 仍指向 FCC（可用 FCC 面板的「同步 Claude 设置」）。

长期方案见 [ARCHITECTURE.md](./ARCHITECTURE.md) §4.1：FCC 写入 `~/.fcc/traces/`，由 `list_fcc_traces` 合并进全链路分析。
