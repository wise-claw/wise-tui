//! 内置助手注册表。
//!
//! 每个 builtin 助手由 Rust 字面量定义,系统提示词 / 默认 prompt
//! layers / 默认 Trellis workflow / 默认 skills / 默认 MCPs / 工具表均编译期内嵌。
//! 用户的覆盖通过 `assistant_overrides` 表追加。

pub mod ppt_deck;
pub mod prd_split;
pub mod word_doc;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinSkillRef {
    pub id: &'static str,
    pub source_path: &'static str,
    pub label: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinMcpRef {
    pub id: &'static str,
    pub label: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinWorkflowRef {
    pub id: &'static str,
    pub stage: &'static str,
    pub label: &'static str,
    pub description: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinPromptLayer {
    pub template_id: &'static str,
    pub version: &'static str,
    pub enabled: bool,
    pub system_body: &'static str,
    pub repo_strategy_body: &'static str,
    pub user_body: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinPromptLayers {
    pub prd_task_split: BuiltinPromptLayer,
    pub phase1: BuiltinPromptLayer,
    pub phase2: BuiltinPromptLayer,
}

/// 一个 builtin 助手的完整定义。`id` 形如 `builtin:prd-split`。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinAssistantBundle {
    pub assistant_id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub avatar_color: &'static str,
    pub engine_id: &'static str,
    pub model: Option<&'static str>,
    pub system_prompt: &'static str,
    pub tools: &'static [&'static str],
    pub default_workflows: &'static [BuiltinWorkflowRef],
    pub default_skills: &'static [BuiltinSkillRef],
    pub default_mcps: &'static [BuiltinMcpRef],
    pub default_prompt_layers: BuiltinPromptLayers,
}

const fn registry() -> &'static [&'static BuiltinAssistantBundle] {
    &[&prd_split::BUNDLE, &word_doc::BUNDLE, &ppt_deck::BUNDLE]
}

pub fn list() -> &'static [&'static BuiltinAssistantBundle] {
    registry()
}

pub fn find(assistant_id: &str) -> Option<&'static BuiltinAssistantBundle> {
    registry()
        .iter()
        .copied()
        .find(|b| b.assistant_id == assistant_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_contains_prd_split() {
        assert!(find("builtin:prd-split").is_some());
        assert!(find("builtin:word-doc").is_some());
        assert!(find("builtin:ppt-deck").is_some());
        assert!(find("builtin:nonexistent").is_none());
    }

    #[test]
    fn prd_split_bundle_well_formed() {
        let b = find("builtin:prd-split").unwrap();
        assert_eq!(b.engine_id, "claude");
        assert!(!b.system_prompt.trim().is_empty());
        assert!(b.tools.len() >= 5);
        assert!(b.default_skills.is_empty());
        assert!(!b.default_workflows.is_empty());
        assert_eq!(b.default_workflows[0].id, "trellis:requirement-intake");
        assert_eq!(
            b.default_prompt_layers.prd_task_split.template_id,
            "prdTaskSplit"
        );
    }

    #[test]
    fn office_assistant_bundles_are_skill_backed() {
        let word = find("builtin:word-doc").unwrap();
        assert_eq!(word.name, "Word 文档助手");
        assert!(word.default_workflows.is_empty());
        assert_eq!(word.default_skills.len(), 1);
        assert_eq!(word.default_skills[0].id, "officecli-docx");
        assert!(word.default_skills[0]
            .source_path
            .contains("officecli-docx"));

        let ppt = find("builtin:ppt-deck").unwrap();
        assert_eq!(ppt.name, "PPT 演示助手");
        assert!(ppt.default_workflows.is_empty());
        assert_eq!(ppt.default_skills.len(), 1);
        assert_eq!(ppt.default_skills[0].id, "officecli-pptx");
        assert!(ppt.default_skills[0].source_path.contains("officecli-pptx"));
    }
}
