---
name: wise-skill-system
description: "用于 Wise Skills Hub、三层 skill 来源 builtin/custom/extension、外部 skill 路径扫描、copy/symlink 导入、SKILL.md 读取、~/.wise/skills、skills Tauri IPC 或技能市场产品化改动。"
---

# Wise Skill System

修改 Wise 技能系统、技能市场、导入导出、外部路径、扩展贡献 skill 或项目 skill 读取时使用本 Skill。

## 先读

1. 先用 `wise-before-dev`。
2. 涉及产品入口时读 `.trellis/spec/guides/agent-harness-architecture.md`。
3. 涉及 Skill 创建规范时读系统 `skill-creator`。
4. 相关历史任务优先读 `.trellis/tasks/05-17-skills-source-tiers/prd.md`。

## 产品归属

Skills 属于 Author 域的供给生态，长期应在 Hub / Skills 市场中统一管理。

- 不要把 Claude、Codex、Goose 等平台 skill 做成分散菜单。
- 项目、用户、扩展来源要在同一 Skills Hub 中表达来源、状态和导入方式。
- 新增 skill 管理能力应保留旧项目 skill、Claude project skill 等后端能力。

## 代码地图

前端：

- `src/components/SkillsHub/`：统一技能市场/技能管理 UI。
- `src/components/ClaudeCodeToolsPanel`、`ClaudeConfigDirPanel`、`ClaudeHooksConfigPanel`：可能展示或关联 Claude 技能/配置目录。
- `src/services/` 中的 skills 相关 wrapper：前端只能通过 service 调 Tauri。

Tauri：

- `src-tauri/src/skills/commands.rs`：新三层 skill 命令、DTO、读取 `SKILL.md`、外部路径、导入删除。
- `src-tauri/src/skills/source.rs`：`SkillSource` 与路径分类。
- `src-tauri/src/skills/external_paths.rs`：用户新增外部路径持久化。
- `src-tauri/src/skills/import.rs`：copy/symlink import、delete、export symlink。
- `src-tauri/src/skills/mod.rs`：模块出口。
- `src-tauri/src/skills_sh.rs`：旧 skills.sh / 项目技能发现能力，保留兼容。
- `src-tauri/src/claude_commands/project_skills.rs`：Claude project/user/plugin cache skills surface。
- `src-tauri/src/extensions/`：扩展贡献 skills 的来源。
- `src-tauri/src/assistants/builtins/mod.rs`：内置助手可声明默认 skill refs。

## 来源模型

Skill 来源必须可区分：

- `builtin`：Wise 内置或项目内受控来源。
- `custom`：用户导入、复制、symlink 或外部路径扫描到的技能。
- `extension`：扩展 manifest 贡献的技能。

外部路径包含但不限于 Claude、Codex 等平台的 skills 目录。扫描路径只发现技能，不应偷偷复制；导入动作必须由用户触发。

## IPC 能力

常用命令：

- `skills_read_instruction`
- `skills_add_external_path`
- `skills_remove_external_path`
- `skills_list_external_paths`
- `skills_import_copy`
- `skills_import_symlink`
- `skills_delete_imported`
- `skills_export_symlink`
- `skills_wise_home`

相关 DTO 应使用 camelCase。路径参数要校验空值和边界，错误信息要能被 UI 直接展示。

## Skill 文件规则

- Skill 目录必须有 `SKILL.md`。
- `SKILL.md` 必须有 YAML frontmatter，至少包含 `name` 和 `description`。
- 不要自动生成 README、CHANGELOG、QUICK_REFERENCE 等辅助文件。
- 长内容用 references 分层，主 `SKILL.md` 保持短小。
- Copy import 应复制完整 skill 目录；symlink import 应清楚展示 `isSymlink`。
- 删除 imported skill 时只删 Wise 管理的导入项，不误删外部原始目录。

## 改动规则

- 新增来源类型前先确认是否能映射到 `builtin/custom/extension`。
- 不改变既有 Claude skill 命令返回的兼容字段，只做 additive 扩展。
- UI 必须显示来源、路径、是否 symlink、是否有 `SKILL.md`。
- 读取 skill 内容时只读用户选中的 `SKILL.md`，不要批量塞入所有技能正文。
- 不要把外部平台目录当成 Wise 所有物；导入和删除语义必须分清楚。

## 验证

```bash
bun test src/components/SkillsHub
bunx tsc --noEmit --pretty false
```

Rust 侧改动补充相关 `cargo test` / `cargo check`，不要启动 Tauri 窗口。

