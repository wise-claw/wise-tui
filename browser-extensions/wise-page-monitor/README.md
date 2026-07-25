# Wise 页面监控 · Chrome 扩展

把日常 Chrome 标签的页面异常、console、网络错误转发到 Wise「页面监控 / AI 自动修复」。

## 安装（开发者模式）

1. 打开 Chrome → `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本目录
4. 在 Wise 页面监控选择 **Chrome 扩展** → 开始监控

扩展会轮询 `http://127.0.0.1:17321/v1/active-monitor`，并对匹配标签使用 `chrome.debugger` 捕获问题。

## 说明

- 页顶可能出现「扩展正在调试此浏览器」提示，属 Chrome 正常行为
- 停止 Wise 监控后扩展会自动卸除调试附着
- 仅连接本机 `127.0.0.1`
