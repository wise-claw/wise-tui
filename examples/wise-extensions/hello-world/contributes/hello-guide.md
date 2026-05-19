# Hello World 扩展指南

这个 markdown 文件由 `hello-world` 扩展通过 `contributes.settingsTabs` 注入到
设置 modal 的左 nav。

## 它做了什么

- 注入一个新的设置 tab，标题为「Hello World 指南」
- 在 nav 上挂 `before` `dingtalk` 这个内置 tab 的位置
- 内容 100% 由扩展自己提供，wise 只负责安全地展示

## 怎么写自己的 settings tab

在 `wise-extension.json` 的 `contributes.settingsTabs[]` 里加一条：

```json
{
  "id": "hello-guide",
  "label": "Hello World 指南",
  "body": "contributes/hello-guide.md",
  "position": { "anchor": "dingtalk", "placement": "before" }
}
```

`body` 是一个相对扩展目录的 markdown 文件路径。**wise 会做路径越界校验**，
确保只能读取扩展自己目录内的文件。
