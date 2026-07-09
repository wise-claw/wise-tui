import { mergeAssistantParts, reconcileResultFullTextParts } from "../src/services/claudeStreamAssembler";
import type { ClaudeMessage, MessagePart } from "../src/types";

// 模拟一条带段落与列表的长助手回复，按 chunk 流式累积，再走 result 全文对齐
const full = `这是第一段结论，描述整体情况。

这是第二段分析，展开说明背景与约束。

- 说明点一：负责用户会话的实时渲染
- 说明点二：负责工具调用的折叠展示
- 说明点三：负责刷新后与磁盘态保持一致

最后一段总结。`;

// 切成若干 delta chunk（模拟 text_delta 流）
const chunks = full.match(/[\s\S]{1,20}/g) ?? [full];
let parts: MessagePart[] = [];
for (const c of chunks) {
  parts = mergeAssistantParts(parts, [{ type: "text", text: c }]);
}
const deltaText = (parts.find((p) => p.type === "text") as any)?.text ?? "";

console.log("=== delta 累积后的 text ===");
console.log(JSON.stringify(deltaText));
console.log("含 \\\\n\\\\n 段落分隔:", deltaText.includes("\n\n"));
console.log("含 - 列表:", /- /.test(deltaText));

// result 全文事件
const resultParts: MessagePart[] = [{ type: "text", text: full }];
const reconciled = reconcileResultFullTextParts({
  resultParts,
  existingParts: parts,
  lastAssistantHasText: true,
});
console.log("\n=== reconcile 返回的 parts ===");
console.log(JSON.stringify(reconciled, null, 2));

const finalText = reconciled.map((p) => (p as any).text).join("\n\n");
console.log("\n=== 最终拼接 text ===");
console.log(JSON.stringify(finalText));
console.log("含 \\\\n\\\\n 段落分隔:", finalText.includes("\n\n"));
console.log("含列表项:", (finalText.match(/- /g) ?? []).length, "个");
