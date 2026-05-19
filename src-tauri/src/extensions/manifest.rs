//! Extension manifest — `wise-extension.json` shape, parsing, and validation.

use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const RESERVED_NAME_PREFIXES: &[&str] = &["wise-", "internal-", "builtin-", "system-"];
const NAME_REGEX: &str = r"^[a-z0-9-]+$";

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Engines {
    /// Semver range. `*` means "any wise version."
    #[serde(default = "default_engine_range")]
    pub wise: String,
}

fn default_engine_range() -> String {
    "*".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Lifecycle {
    pub on_install: Option<HookSpec>,
    pub on_activate: Option<HookSpec>,
    pub on_deactivate: Option<HookSpec>,
    pub on_uninstall: Option<HookSpec>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", untagged)]
pub enum HookSpec {
    Script {
        script: String,
    },
    Shell {
        shell: ShellHook,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShellHook {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    #[serde(default)]
    pub storage: bool,
    #[serde(default)]
    pub network: bool,
    #[serde(default)]
    pub shell: bool,
    #[serde(default)]
    pub filesystem: Option<String>,
    #[serde(default)]
    pub clipboard: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Contributes {
    #[serde(default)]
    pub skills: Vec<SkillContribution>,
    #[serde(default)]
    pub themes: Vec<ThemeContribution>,
    #[serde(default)]
    pub settings_declarations: Vec<SettingsDeclaration>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerContribution>,
    #[serde(default)]
    pub settings_tabs: Vec<SettingsTabContribution>,
    #[serde(default)]
    pub assistants: Vec<AssistantContribution>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantContribution {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// References a detected execution engine: claude / codex / gemini /
    /// or a `custom:<id>` slug. Wise does not validate at manifest load
    /// time (engine availability changes at runtime); panels surface
    /// "engine unavailable" lazily.
    pub engine_id: String,
    /// Markdown system prompt body file, relative to the extension dir.
    pub system_prompt: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub avatar_color: Option<String>,
}

/// Optional placement hint: "show this tab before/after a known builtin
/// (or another extension's) tab id". When omitted, tabs append at end.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsTabPosition {
    pub anchor: String,
    pub placement: TabPlacement,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TabPlacement {
    Before,
    After,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsTabContribution {
    pub id: String,
    pub label: String,
    /// Markdown body, relative to the extension directory.
    pub body: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub position: Option<SettingsTabPosition>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerContribution {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub transport: crate::mcp::protocol::McpTransport,
    #[serde(default = "default_true_bool")]
    pub default_enabled: bool,
}

fn default_true_bool() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillContribution {
    pub name: String,
    pub description: String,
    /// Path to a markdown file relative to the extension directory.
    pub file: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeContribution {
    pub id: String,
    pub name: String,
    pub file: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDeclaration {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Schema-free type tag the renderer can interpret.
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub name: String,
    pub version: String,
    pub api_version: String,
    pub engines: Engines,
    pub description: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub lifecycle: Lifecycle,
    #[serde(default)]
    pub permissions: Permissions,
    #[serde(default)]
    pub dependencies: BTreeMap<String, String>,
    #[serde(default)]
    pub contributes: Contributes,
}

#[derive(Debug)]
pub enum ManifestError {
    InvalidName(String),
    ReservedName(String),
    InvalidSemver(String),
    PathOutsideExtension { kind: &'static str, value: String },
    PathDoesNotExist { kind: &'static str, value: String },
    DuplicateContributeId { kind: &'static str, id: String },
}

impl fmt::Display for ManifestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ManifestError::InvalidName(n) => {
                write!(f, "extension name '{n}' must match {NAME_REGEX}")
            }
            ManifestError::ReservedName(n) => write!(
                f,
                "extension name '{n}' uses a reserved prefix ({})",
                RESERVED_NAME_PREFIXES.join(", ")
            ),
            ManifestError::InvalidSemver(v) => write!(f, "version '{v}' is not valid semver"),
            ManifestError::PathOutsideExtension { kind, value } => {
                write!(f, "{kind} path '{value}' resolves outside the extension directory")
            }
            ManifestError::PathDoesNotExist { kind, value } => {
                write!(f, "{kind} path '{value}' does not exist")
            }
            ManifestError::DuplicateContributeId { kind, id } => {
                write!(f, "duplicate {kind} contribute id '{id}'")
            }
        }
    }
}

impl std::error::Error for ManifestError {}

fn name_is_valid(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn name_uses_reserved_prefix(name: &str) -> bool {
    RESERVED_NAME_PREFIXES.iter().any(|p| name.starts_with(p))
}

fn validate_relative_path(
    raw: &str,
    ext_dir: &Path,
    kind: &'static str,
    must_exist: bool,
) -> Result<PathBuf, ManifestError> {
    let candidate = ext_dir.join(raw);
    let canonical_ext = ext_dir.canonicalize().unwrap_or_else(|_| ext_dir.to_path_buf());
    let canonical_candidate = match candidate.canonicalize() {
        Ok(p) => p,
        Err(_) if !must_exist => {
            // Path may not exist yet (lifecycle script generated at install time).
            // Fall back to lexical containment check.
            let normalized = lexical_normalize(&candidate);
            if !normalized.starts_with(&canonical_ext)
                && !normalized.starts_with(ext_dir)
            {
                return Err(ManifestError::PathOutsideExtension {
                    kind,
                    value: raw.to_string(),
                });
            }
            return Ok(normalized);
        }
        Err(_) => {
            return Err(ManifestError::PathDoesNotExist {
                kind,
                value: raw.to_string(),
            })
        }
    };

    if !canonical_candidate.starts_with(&canonical_ext) {
        return Err(ManifestError::PathOutsideExtension {
            kind,
            value: raw.to_string(),
        });
    }
    Ok(canonical_candidate)
}

fn lexical_normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in p.components() {
        match component {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

impl ExtensionManifest {
    /// Validate the manifest against its filesystem context.
    pub fn validate(&self, ext_dir: &Path) -> Result<(), ManifestError> {
        if !name_is_valid(&self.name) {
            return Err(ManifestError::InvalidName(self.name.clone()));
        }
        if name_uses_reserved_prefix(&self.name) {
            return Err(ManifestError::ReservedName(self.name.clone()));
        }
        if semver::Version::parse(&self.version).is_err() {
            return Err(ManifestError::InvalidSemver(self.version.clone()));
        }

        // Lifecycle script paths must live under ext_dir (script may be
        // generated by onInstall, so existence is not required for any hook
        // other than onActivate at activation time).
        for (kind, hook) in [
            ("lifecycle.onInstall", &self.lifecycle.on_install),
            ("lifecycle.onActivate", &self.lifecycle.on_activate),
            ("lifecycle.onDeactivate", &self.lifecycle.on_deactivate),
            ("lifecycle.onUninstall", &self.lifecycle.on_uninstall),
        ] {
            if let Some(HookSpec::Script { script }) = hook {
                validate_relative_path(script, ext_dir, kind, false)?;
            }
        }

        // Skill / theme files must exist at validation time.
        for skill in &self.contributes.skills {
            validate_relative_path(&skill.file, ext_dir, "skill.file", true)?;
        }
        for theme in &self.contributes.themes {
            validate_relative_path(&theme.file, ext_dir, "theme.file", true)?;
        }

        // Settings tab body markdown must exist and live under ext dir.
        for tab in &self.contributes.settings_tabs {
            validate_relative_path(&tab.body, ext_dir, "settingsTab.body", true)?;
        }

        // Assistant system_prompt markdown must exist and live under ext dir.
        for a in &self.contributes.assistants {
            validate_relative_path(&a.system_prompt, ext_dir, "assistant.systemPrompt", true)?;
        }

        // Duplicate IDs across each contribute kind.
        let mut seen = HashSet::new();
        for s in &self.contributes.skills {
            if !seen.insert(("skill", s.name.as_str())) {
                return Err(ManifestError::DuplicateContributeId {
                    kind: "skill",
                    id: s.name.clone(),
                });
            }
        }
        let mut seen = HashSet::new();
        for t in &self.contributes.themes {
            if !seen.insert(("theme", t.id.as_str())) {
                return Err(ManifestError::DuplicateContributeId {
                    kind: "theme",
                    id: t.id.clone(),
                });
            }
        }
        let mut seen = HashSet::new();
        for d in &self.contributes.settings_declarations {
            if !seen.insert(("settingsDeclaration", d.id.as_str())) {
                return Err(ManifestError::DuplicateContributeId {
                    kind: "settingsDeclaration",
                    id: d.id.clone(),
                });
            }
        }
        Ok(())
    }
}

/// Test if the engine range is satisfied by the running wise version.
pub fn engine_compatible(range: &str, wise_version: &str) -> bool {
    if range.trim() == "*" {
        return true;
    }
    let req = match semver::VersionReq::parse(range) {
        Ok(r) => r,
        Err(_) => return false,
    };
    let v = match semver::Version::parse(wise_version) {
        Ok(v) => v,
        Err(_) => return false,
    };
    req.matches(&v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_file(dir: &Path, rel: &str, content: &str) -> PathBuf {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, content).unwrap();
        path
    }

    fn base_manifest(dir: &Path) -> ExtensionManifest {
        write_file(dir, "skill.md", "# hello");
        ExtensionManifest {
            name: "hello-world".to_string(),
            version: "0.1.0".to_string(),
            api_version: "1".to_string(),
            engines: Engines { wise: "*".to_string() },
            description: "demo".to_string(),
            author: None,
            homepage: None,
            repository: None,
            icon: None,
            lifecycle: Lifecycle::default(),
            permissions: Permissions::default(),
            dependencies: BTreeMap::new(),
            contributes: Contributes {
                skills: vec![SkillContribution {
                    name: "hi".to_string(),
                    description: "hi".to_string(),
                    file: "skill.md".to_string(),
                }],
                themes: vec![],
                settings_declarations: vec![],
                mcp_servers: vec![],
                settings_tabs: vec![],
                assistants: vec![],
            },
        }
    }

    #[test]
    fn valid_manifest_passes() {
        let dir = tempdir().unwrap();
        let m = base_manifest(dir.path());
        assert!(m.validate(dir.path()).is_ok());
    }

    #[test]
    fn reserved_prefix_rejected() {
        let dir = tempdir().unwrap();
        let mut m = base_manifest(dir.path());
        m.name = "wise-thing".to_string();
        let err = m.validate(dir.path()).unwrap_err();
        assert!(matches!(err, ManifestError::ReservedName(_)));
    }

    #[test]
    fn invalid_name_rejected() {
        let dir = tempdir().unwrap();
        let mut m = base_manifest(dir.path());
        m.name = "Hello_World".to_string();
        assert!(matches!(
            m.validate(dir.path()).unwrap_err(),
            ManifestError::InvalidName(_)
        ));
    }

    #[test]
    fn malformed_semver_rejected() {
        let dir = tempdir().unwrap();
        let mut m = base_manifest(dir.path());
        m.version = "not-semver".to_string();
        assert!(matches!(
            m.validate(dir.path()).unwrap_err(),
            ManifestError::InvalidSemver(_)
        ));
    }

    #[test]
    fn out_of_dir_script_rejected() {
        let dir = tempdir().unwrap();
        let mut m = base_manifest(dir.path());
        m.lifecycle.on_install = Some(HookSpec::Script {
            script: "../escape.mjs".to_string(),
        });
        let err = m.validate(dir.path()).unwrap_err();
        assert!(matches!(err, ManifestError::PathOutsideExtension { .. }));
    }

    #[test]
    fn missing_skill_file_rejected() {
        let dir = tempdir().unwrap();
        let mut m = base_manifest(dir.path());
        m.contributes.skills[0].file = "missing.md".to_string();
        let err = m.validate(dir.path()).unwrap_err();
        assert!(matches!(err, ManifestError::PathDoesNotExist { .. }));
    }

    #[test]
    fn duplicate_skill_ids_rejected() {
        let dir = tempdir().unwrap();
        let mut m = base_manifest(dir.path());
        write_file(dir.path(), "skill2.md", "# two");
        m.contributes.skills.push(SkillContribution {
            name: "hi".to_string(),
            description: "duplicate".to_string(),
            file: "skill2.md".to_string(),
        });
        let err = m.validate(dir.path()).unwrap_err();
        assert!(matches!(
            err,
            ManifestError::DuplicateContributeId { kind: "skill", .. }
        ));
    }

    #[test]
    fn engine_range_star_matches_anything() {
        assert!(engine_compatible("*", "0.1.0"));
        assert!(engine_compatible("*", "99.0.0"));
    }

    #[test]
    fn engine_range_caret_excludes_breaking_change() {
        assert!(engine_compatible("^0.1.0", "0.1.5"));
        assert!(!engine_compatible("^1.0.0", "0.9.0"));
    }
}
