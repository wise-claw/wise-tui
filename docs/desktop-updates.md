# 桌面版本更新

工作台配置 → 版本更新：显示当前版本，手动检查新版本，查看更新说明，下载并安装签名更新。安装后在保存工作后点击「重启 Wise」。Windows 安装程序可能自行退出并重启应用。浏览器预览只提供发布页面链接。

自动检查更新默认开启，可在版本更新中关闭，设置保存在本地数据库。主窗口启动 10 秒后检查，运行期间每 6 小时复查；休眠、后台或断网时跳过，恢复前台或网络后补查到期任务。同一版本每次启动只提示一次；后台错误保持安静并在下一周期重试。点击新版通知打开更新面板，下载、安装仍需手动触发。

检查时先读取 GitHub 最新稳定版 Release 并比较版本号；没有新版时直接显示暂无更新。新版缺少 latest.json 时提供手动下载入口；仅新版包含清单时访问 https://github.com/wise-claw/wise-tui/releases/latest/download/latest.json 并使用签名 updater 安装。检查失败会显示错误并提供发布页面入口，不会视作「已是最新版本」。

## 首次配置发布签名

1. 使用 `bun tauri signer generate -w /安全路径/wise-update.key` 生成密钥对，安全备份私钥，勿提交到仓库。
2. GitHub 仓库 Actions Variables 设置 `TAURI_UPDATER_PUBLIC_KEY` 为生成的公钥文件内容。
3. Actions Secrets 设置 `TAURI_SIGNING_PRIVATE_KEY` 为私钥内容，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 为私钥密码。
4. 同步 package.json、src-tauri/Cargo.toml、src-tauri/tauri.conf.json 中的版本号，推送对应 `v版本号` 标签。
5. CI 注入公钥、启用 updater artifacts，并生成签名包及 latest.json；将安装包与更新清单上传到正式 Release。

默认开发配置包含发布公钥，但不产生签名更新包。需测试原生更新时，先设置环境变量 `TAURI_UPDATER_PUBLIC_KEY`，运行 `bun run scripts/configure-updater.mjs` 再构建。私钥保持在环境变量中。macOS 应用签名、公证与更新包签名是独立配置。

每种系统/架构须提供对应更新包；当前 CI 使用各 runner 默认架构。客户端缺少对应架构时会报告更新失败。

参考：https://v2.tauri.app/plugin/updater/
