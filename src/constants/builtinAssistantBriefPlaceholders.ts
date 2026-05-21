/** 内置助手 Brief 输入框占位示例（助手对话 / 产物工作区） */
export const BUILTIN_ASSISTANT_BRIEF_PLACEHOLDERS: Record<string, string> = {
  "builtin:word-doc":
    "例如：根据会议纪要生成一份正式项目复盘 Word 报告，包含摘要、问题、行动项和附件清单。",
  "builtin:ppt-deck":
    "例如：根据这份商业计划书做 12 页融资路演 PPT，风格深色高对比，保留数据图表。",
  "builtin:excel-data":
    "例如：分析 sales_2025.csv，按区域汇总 GMV、环比与 Top10 SKU，并输出清洗后的 xlsx。",
  "builtin:code-review":
    "例如：审查当前分支相对 main 的 diff，按必须修复 / 建议改进列出问题并附文件路径。",
  "builtin:tech-docs":
    "例如：为 src/services/assistantPromptLayers.ts 所在模块补 README，含 API 与配置说明。",
  "builtin:test-gen":
    "例如：为刚改的 claudeSessionContext.ts 补 bun test 用例，覆盖阈值边界与 jsonl 估算。",
  "builtin:release-notes":
    "例如：根据 v1.2.0..HEAD 的 conventional commits 写 CHANGELOG 与升级指南。",
};

export function builtinAssistantBriefPlaceholder(assistantId: string): string {
  return (
    BUILTIN_ASSISTANT_BRIEF_PLACEHOLDERS[assistantId] ??
    "描述你的目标、输入文件或审查范围，助手会结合当前工作区执行。"
  );
}
