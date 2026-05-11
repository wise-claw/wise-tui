# Wise tauri

基于 **Tauri 2**、**Bun**、**Vite**、**React** 与 **Ant Design** 的桌面端壳：含侧栏导航、顶栏、内容区与 `invoke` 调用 Rust 示例，可直接扩展业务。

## 环境要求

- [Bun](https://bun.sh/)（建议与 `packageManager` 字段一致）
- [Rust stable](https://rustup.rs/)（`tauri build` / `tauri dev` 需要）
- macOS / Windows / Linux 桌面开发依赖见 [Tauri 前置条件](https://tauri.app/start/prerequisites/)

## 本地开发

```bash
bun install
bun run tauri:dev
```

- 会启动 Vite（`http://localhost:16088`）并由 Tauri 打开桌面窗口。
- 若仅调试前端（不启 Rust 壳），可另开终端执行 `bun run dev`，再用浏览器打开上述地址（部分 Tauri API 在浏览器中不可用）。

## 打包

```bash
bun run tauri:build
```

- 产物目录：`src-tauri/target/release/bundle/`（各平台安装包形态不同，如 `.dmg`、`.msi`、`.AppImage` 等）。
- 应用显示名与窗口标题在 `src-tauri/tauri.conf.json` 的 `productName` / `windows[].title`。
- Bundle Identifier：`identifier` 字段（当前为 `com.wise.tauri`，可按组织域名修改）。

## 部署

1. **手动 / 内网分发**：将 `bundle` 目录下对应平台的安装包拷贝到下载站或对象存储即可。
2. **GitHub Release（CI）**：
   - 推送以 `v` 开头的 tag（例如 `v0.1.0`）会触发 `.github/workflows/tauri-release.yml`，由 [tauri-action](https://github.com/tauri-apps/tauri-action) 构建并创建**草稿** Release，你在 Release 页面检查附件后发布即可。
3. **PR / 主分支检查**：`.github/workflows/ci.yml` 执行 `bun run build`（前端类型检查与 Vite 构建）。

### macOS：提示「已损坏，无法打开」

从网页或网盘下载的 `.app` / `.dmg` 若**未使用 Apple「Developer ID」签名并公证**，系统会加上隔离属性（quarantine），此时常见提示是**「已损坏，无法打开」**（并不一定是文件真的坏了）。

**正式解决（推荐给对外分发）**

1. 使用付费 [Apple Developer Program](https://developer.apple.com/programs/)，在「Certificates」中创建 **Developer ID Application** 证书，导出为 `.p12` 并转为 base64。
2. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中配置（名称需与 workflow 一致）：
   - `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`KEYCHAIN_PASSWORD`（CI 导入证书用）
   - 公证（使用 Developer ID 时必需）：`APPLE_ID`、`APPLE_PASSWORD`（Apple 账号的 [App 专用密码](https://support.apple.com/HT204397)）、`APPLE_TEAM_ID`
3. 重新打 tag 触发 `tauri-release.yml` 构建后再下载安装。流程与变量说明见 [Tauri：macOS 代码签名](https://v2.tauri.app/distribute/sign/macos/)。若使用 App Store Connect API 密钥公证，需在 workflow 中把私钥 `.p8` 写入文件并设置 `APPLE_API_ISSUER`、`APPLE_API_KEY`、`APPLE_API_KEY_PATH`（见该文档）。

**临时绕过（仅自用或内测，自行承担风险）**

在终端执行（将路径换成你拖入终端的 `Wise.app` 或挂载 DMG 后的 `.app` 路径）：

```bash
xattr -dr com.apple.quarantine "/Applications/Wise.app"
```

也可在 **系统设置 → 隐私与安全性** 中查看是否出现「仍要打开」；或对应用**右键 → 打开**试一次。

Windows 安装包若需消除 SmartScreen 警告，需另行购买代码签名证书并在构建时配置。

## 推荐 IDE

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
