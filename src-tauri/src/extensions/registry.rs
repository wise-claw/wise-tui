//! Extension registry — owns loaded set, enable state, and resolved contributes.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::RwLock;

use serde::Serialize;

use super::loader::{scan_all, LoadedExtension, LoadOutcome};
use super::manifest::{
    engine_compatible, McpServerContribution, Permissions, SettingsTabContribution,
    SettingsTabPosition, TabPlacement,
};
use super::state::{load as load_state, save as save_state, ExtensionPersistedEntry, ExtensionPersistedState};

const WISE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionListEntry {
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub installed: bool,
    pub error: Option<String>,
    pub last_activation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSkill {
    pub id: String,
    pub extension: String,
    pub name: String,
    pub description: String,
    pub location: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTheme {
    pub id: String,
    pub extension: String,
    pub name: String,
    pub location: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSettingsDeclaration {
    pub id: String,
    pub extension: String,
    pub label: String,
    pub description: Option<String>,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedMcpServer {
    pub id: String,
    pub extension: String,
    pub name: String,
    pub description: Option<String>,
    pub transport: crate::mcp::protocol::McpTransport,
    pub default_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSettingsTab {
    pub id: String,
    pub extension: String,
    pub label: String,
    /// Absolute filesystem path to the body markdown.
    pub body_path: String,
    pub icon: Option<String>,
    pub anchor: Option<String>,
    pub placement: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAssistant {
    pub id: String,
    pub extension: String,
    pub name: String,
    pub description: Option<String>,
    pub engine_id: String,
    /// Absolute filesystem path to the system prompt body.
    pub system_prompt_path: String,
    pub model: Option<String>,
    pub avatar_color: Option<String>,
}

#[derive(Default)]
struct RegistryInner {
    loaded: Vec<LoadedExtension>,
    /// per-extension load/validation errors that should appear in `list()`
    errors: HashMap<String, String>,
    persisted: ExtensionPersistedState,
    /// home dir for state persistence (test override).
    home: Option<PathBuf>,
}

pub struct ExtensionRegistry {
    inner: RwLock<RegistryInner>,
}

impl Default for ExtensionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ExtensionRegistry {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(RegistryInner::default()),
        }
    }

    /// Load extensions and replace the inner state. `home` is the directory
    /// holding `extension-states.json`. `extra_dirs` are scanned in addition
    /// to env + `~/.wise/extensions/`.
    pub fn initialize(
        &self,
        home: Option<PathBuf>,
        extra_dirs: &[PathBuf],
    ) -> Result<(), String> {
        let outcome = scan_all(extra_dirs);
        let next = build_inner(home, outcome)?;
        let mut guard = self.inner.write().map_err(|e| format!("lock poisoned: {e}"))?;
        *guard = next;
        Ok(())
    }

    pub fn hot_reload(&self, extra_dirs: &[PathBuf]) -> Result<(), String> {
        let home = self
            .inner
            .read()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .home
            .clone();
        let outcome = scan_all(extra_dirs);
        let next = build_inner(home, outcome)?;
        let mut guard = self.inner.write().map_err(|e| format!("lock poisoned: {e}"))?;
        *guard = next;
        Ok(())
    }

    pub fn list(&self) -> Vec<ExtensionListEntry> {
        let guard = self.inner.read().expect("lock poisoned");
        let mut out = Vec::new();
        for ext in &guard.loaded {
            let name = ext.manifest.name.clone();
            let entry = guard.persisted.extensions.get(&name);
            out.push(ExtensionListEntry {
                version: ext.manifest.version.clone(),
                description: ext.manifest.description.clone(),
                enabled: entry.map(|e| e.enabled).unwrap_or(true),
                installed: entry.map(|e| e.installed).unwrap_or(true),
                error: guard.errors.get(&name).cloned(),
                last_activation: None,
                name,
            });
        }
        // Surface load-time errors that have no loaded manifest.
        for (name, err) in &guard.errors {
            if !out.iter().any(|e| &e.name == name) {
                out.push(ExtensionListEntry {
                    name: name.clone(),
                    version: String::new(),
                    description: String::new(),
                    enabled: false,
                    installed: false,
                    error: Some(err.clone()),
                    last_activation: None,
                });
            }
        }
        out
    }

    pub fn skills(&self) -> Vec<ResolvedSkill> {
        let guard = self.inner.read().expect("lock poisoned");
        let mut out = Vec::new();
        for ext in &guard.loaded {
            if !is_enabled(&guard.persisted, &ext.manifest.name) {
                continue;
            }
            for s in &ext.manifest.contributes.skills {
                out.push(ResolvedSkill {
                    id: format!("ext-{}-{}", ext.manifest.name, s.name),
                    extension: ext.manifest.name.clone(),
                    name: s.name.clone(),
                    description: s.description.clone(),
                    location: ext.dir.join(&s.file).to_string_lossy().to_string(),
                });
            }
        }
        out
    }

    pub fn themes(&self) -> Vec<ResolvedTheme> {
        let guard = self.inner.read().expect("lock poisoned");
        let mut out = Vec::new();
        for ext in &guard.loaded {
            if !is_enabled(&guard.persisted, &ext.manifest.name) {
                continue;
            }
            for t in &ext.manifest.contributes.themes {
                out.push(ResolvedTheme {
                    id: format!("ext-{}-{}", ext.manifest.name, t.id),
                    extension: ext.manifest.name.clone(),
                    name: t.name.clone(),
                    location: ext.dir.join(&t.file).to_string_lossy().to_string(),
                });
            }
        }
        out
    }

    pub fn settings_declarations(&self) -> Vec<ResolvedSettingsDeclaration> {
        let guard = self.inner.read().expect("lock poisoned");
        let mut out = Vec::new();
        for ext in &guard.loaded {
            if !is_enabled(&guard.persisted, &ext.manifest.name) {
                continue;
            }
            for d in &ext.manifest.contributes.settings_declarations {
                out.push(ResolvedSettingsDeclaration {
                    id: format!("ext-{}-{}", ext.manifest.name, d.id),
                    extension: ext.manifest.name.clone(),
                    label: d.label.clone(),
                    description: d.description.clone(),
                    kind: d.kind.clone(),
                });
            }
        }
        out
    }

    pub fn permissions(&self, name: &str) -> Option<Permissions> {
        let guard = self.inner.read().expect("lock poisoned");
        guard
            .loaded
            .iter()
            .find(|e| e.manifest.name == name)
            .map(|e| e.manifest.permissions.clone())
    }

    pub fn mcp_servers(&self) -> Vec<ResolvedMcpServer> {
        let guard = self.inner.read().expect("lock poisoned");
        let mut out = Vec::new();
        for ext in &guard.loaded {
            if !is_enabled(&guard.persisted, &ext.manifest.name) {
                continue;
            }
            for s in &ext.manifest.contributes.mcp_servers {
                out.push(ResolvedMcpServer {
                    id: format!("ext-{}-{}", ext.manifest.name, s.name),
                    extension: ext.manifest.name.clone(),
                    name: s.name.clone(),
                    description: s.description.clone(),
                    transport: s.transport.clone(),
                    default_enabled: s.default_enabled,
                });
            }
        }
        out
    }

    pub fn settings_tabs(&self) -> Vec<ResolvedSettingsTab> {
        let guard = self.inner.read().expect("lock poisoned");
        let mut out = Vec::new();
        for ext in &guard.loaded {
            if !is_enabled(&guard.persisted, &ext.manifest.name) {
                continue;
            }
            for t in &ext.manifest.contributes.settings_tabs {
                let body_path = ext.dir.join(&t.body).to_string_lossy().to_string();
                let (anchor, placement) = match &t.position {
                    Some(SettingsTabPosition { anchor, placement }) => (
                        Some(anchor.clone()),
                        Some(match placement {
                            TabPlacement::Before => "before",
                            TabPlacement::After => "after",
                        }),
                    ),
                    None => (None, None),
                };
                out.push(ResolvedSettingsTab {
                    id: format!("ext-{}-{}", ext.manifest.name, t.id),
                    extension: ext.manifest.name.clone(),
                    label: t.label.clone(),
                    body_path,
                    icon: t.icon.clone(),
                    anchor,
                    placement,
                });
            }
        }
        out
    }

    /// Read a markdown body for a settings tab, with path-traversal check
    /// against the contributing extension's directory.
    pub fn read_settings_tab_body(&self, id: &str) -> Result<String, String> {
        let guard = self.inner.read().expect("lock poisoned");
        for ext in &guard.loaded {
            if !is_enabled(&guard.persisted, &ext.manifest.name) {
                continue;
            }
            for t in &ext.manifest.contributes.settings_tabs {
                let resolved_id = format!("ext-{}-{}", ext.manifest.name, t.id);
                if resolved_id != id {
                    continue;
                }
                let abs = ext.dir.join(&t.body);
                let canonical_ext = ext
                    .dir
                    .canonicalize()
                    .map_err(|e| format!("ext_dir canonicalize: {e}"))?;
                let canonical_body = abs
                    .canonicalize()
                    .map_err(|e| format!("body file: {e}"))?;
                if !canonical_body.starts_with(&canonical_ext) {
                    return Err("settingsTab.body resolves outside extension dir".to_string());
                }
                return std::fs::read_to_string(&canonical_body)
                    .map_err(|e| format!("read body: {e}"));
            }
        }
        Err(format!("no settings tab with id {id}"))
    }

    pub fn assistants(&self) -> Vec<ResolvedAssistant> {
        let guard = self.inner.read().expect("lock poisoned");
        let mut out = Vec::new();
        for ext in &guard.loaded {
            if !is_enabled(&guard.persisted, &ext.manifest.name) {
                continue;
            }
            for a in &ext.manifest.contributes.assistants {
                out.push(ResolvedAssistant {
                    id: format!("ext-{}-{}", ext.manifest.name, a.id),
                    extension: ext.manifest.name.clone(),
                    name: a.name.clone(),
                    description: a.description.clone(),
                    engine_id: a.engine_id.clone(),
                    system_prompt_path: ext.dir.join(&a.system_prompt).to_string_lossy().to_string(),
                    model: a.model.clone(),
                    avatar_color: a.avatar_color.clone(),
                });
            }
        }
        out
    }

    /// Read assistant system prompt with the same path-traversal check.
    pub fn read_assistant_system_prompt(&self, id: &str) -> Result<String, String> {
        let guard = self.inner.read().expect("lock poisoned");
        for ext in &guard.loaded {
            if !is_enabled(&guard.persisted, &ext.manifest.name) {
                continue;
            }
            for a in &ext.manifest.contributes.assistants {
                let resolved_id = format!("ext-{}-{}", ext.manifest.name, a.id);
                if resolved_id != id {
                    continue;
                }
                let canonical_ext = ext
                    .dir
                    .canonicalize()
                    .map_err(|e| format!("ext_dir canonicalize: {e}"))?;
                let canonical_body = ext
                    .dir
                    .join(&a.system_prompt)
                    .canonicalize()
                    .map_err(|e| format!("system prompt: {e}"))?;
                if !canonical_body.starts_with(&canonical_ext) {
                    return Err("assistant.systemPrompt resolves outside extension dir".to_string());
                }
                return std::fs::read_to_string(&canonical_body)
                    .map_err(|e| format!("read prompt: {e}"));
            }
        }
        Err(format!("no assistant with id {id}"))
    }

    pub fn set_enabled(&self, name: &str, enabled: bool) -> Result<(), String> {
        let mut guard = self.inner.write().map_err(|e| format!("lock poisoned: {e}"))?;
        let entry = guard
            .persisted
            .extensions
            .entry(name.to_string())
            .or_insert_with(|| ExtensionPersistedEntry {
                enabled: true,
                last_version: None,
                installed: true,
                install_error: None,
            });
        entry.enabled = enabled;
        if let Some(home) = guard.home.clone() {
            save_state(&home, &guard.persisted)?;
        }
        Ok(())
    }

    /// Expose loaded list for lifecycle integration tests.
    #[cfg(test)]
    pub fn loaded_for_test(&self) -> Vec<LoadedExtension> {
        self.inner.read().expect("lock poisoned").loaded.clone()
    }
}

fn is_enabled(persisted: &ExtensionPersistedState, name: &str) -> bool {
    persisted
        .extensions
        .get(name)
        .map(|e| e.enabled)
        .unwrap_or(true)
}

fn build_inner(
    home: Option<PathBuf>,
    outcome: LoadOutcome,
) -> Result<RegistryInner, String> {
    let LoadOutcome { loaded, errors: load_errors } = outcome;

    // Filter by engine compatibility.
    let mut errors: HashMap<String, String> = HashMap::new();
    let mut compat: Vec<LoadedExtension> = Vec::new();
    for ext in loaded {
        if engine_compatible(&ext.manifest.engines.wise, WISE_VERSION) {
            compat.push(ext);
        } else {
            errors.insert(
                ext.manifest.name.clone(),
                format!(
                    "engine '{}' not compatible with wise {}",
                    ext.manifest.engines.wise, WISE_VERSION
                ),
            );
        }
    }

    // Topo sort by manifest.dependencies. Cycles → error and skip the cycle members.
    let sorted = topological_sort(&compat).map_err(|e| {
        format!("dependency cycle detected: {e}")
    })?;

    // Carry path-keyed load errors over with a synthesized name.
    for (path, msg) in load_errors {
        let synth = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("?")
            .to_string();
        errors.entry(format!("[load:{synth}]")).or_insert(msg);
    }

    // Load persisted state.
    let persisted = if let Some(h) = &home {
        load_state(h).unwrap_or_default()
    } else {
        ExtensionPersistedState::default()
    };

    Ok(RegistryInner {
        loaded: sorted,
        errors,
        persisted,
        home,
    })
}

fn topological_sort(extensions: &[LoadedExtension]) -> Result<Vec<LoadedExtension>, String> {
    let by_name: BTreeMap<&str, &LoadedExtension> =
        extensions.iter().map(|e| (e.manifest.name.as_str(), e)).collect();
    let mut indeg: HashMap<&str, usize> = HashMap::new();
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for (name, ext) in &by_name {
        indeg.entry(*name).or_insert(0);
        for dep in ext.manifest.dependencies.keys() {
            if !by_name.contains_key(dep.as_str()) {
                continue;
            }
            adj.entry(dep.as_str()).or_default().push(name);
            *indeg.entry(*name).or_insert(0) += 1;
        }
    }

    let mut queue: VecDeque<&str> =
        indeg.iter().filter_map(|(k, v)| (*v == 0).then_some(*k)).collect();
    let mut visited: HashSet<&str> = HashSet::new();
    let mut order: Vec<&str> = Vec::new();
    while let Some(n) = queue.pop_front() {
        if !visited.insert(n) {
            continue;
        }
        order.push(n);
        if let Some(succ) = adj.get(n) {
            for &s in succ {
                let entry = indeg.entry(s).or_insert(0);
                if *entry > 0 {
                    *entry -= 1;
                }
                if *entry == 0 {
                    queue.push_back(s);
                }
            }
        }
    }
    if order.len() != by_name.len() {
        let cycle: Vec<String> = by_name
            .keys()
            .filter(|k| !visited.contains(*k))
            .map(|k| k.to_string())
            .collect();
        return Err(cycle.join(" → "));
    }
    Ok(order
        .into_iter()
        .filter_map(|n| by_name.get(n).map(|e| (*e).clone()))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::manifest::{
        Contributes, Engines, ExtensionManifest, Lifecycle, Permissions, SkillContribution,
    };
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn fake_ext(name: &str, deps: &[&str]) -> LoadedExtension {
        let mut dependencies = BTreeMap::new();
        for d in deps {
            dependencies.insert((*d).to_string(), "*".to_string());
        }
        LoadedExtension {
            dir: PathBuf::from(format!("/tmp/{name}")),
            manifest_path: PathBuf::from(format!("/tmp/{name}/wise-extension.json")),
            manifest: ExtensionManifest {
                name: name.to_string(),
                version: "0.1.0".to_string(),
                api_version: "1".to_string(),
                engines: Engines { wise: "*".to_string() },
                description: format!("{name} desc"),
                author: None,
                homepage: None,
                repository: None,
                icon: None,
                lifecycle: Lifecycle::default(),
                permissions: Permissions::default(),
                dependencies,
                contributes: Contributes {
                    skills: vec![SkillContribution {
                        name: format!("{name}-skill"),
                        description: "s".to_string(),
                        file: "skill.md".to_string(),
                    }],
                    themes: vec![],
                    settings_declarations: vec![],
                    mcp_servers: vec![],
                    settings_tabs: vec![],
                    assistants: vec![],
                },
            },
        }
    }

    #[test]
    fn topo_orders_deps_first() {
        let exts = vec![fake_ext("b", &["a"]), fake_ext("a", &[])];
        let sorted = topological_sort(&exts).unwrap();
        assert_eq!(sorted[0].manifest.name, "a");
        assert_eq!(sorted[1].manifest.name, "b");
    }

    #[test]
    fn topo_detects_cycle() {
        let exts = vec![fake_ext("a", &["b"]), fake_ext("b", &["a"])];
        let err = topological_sort(&exts).unwrap_err();
        assert!(err.contains("a") && err.contains("b"));
    }

    #[test]
    fn engine_filter_drops_incompatible_extensions() {
        let mut a = fake_ext("a", &[]);
        a.manifest.engines.wise = ">99.0.0".to_string();
        let b = fake_ext("b", &[]);
        let outcome = LoadOutcome {
            loaded: vec![a, b],
            errors: HashMap::new(),
        };
        let inner = build_inner(None, outcome).unwrap();
        let names: Vec<_> = inner.loaded.iter().map(|e| e.manifest.name.clone()).collect();
        assert_eq!(names, vec!["b".to_string()]);
        assert!(inner.errors.contains_key("a"));
    }

    #[test]
    fn set_enabled_persists() {
        let dir = tempfile::tempdir().unwrap();
        let registry = ExtensionRegistry::new();
        let outcome = LoadOutcome {
            loaded: vec![fake_ext("a", &[])],
            errors: HashMap::new(),
        };
        // Inject inner directly.
        let inner = build_inner(Some(dir.path().to_path_buf()), outcome).unwrap();
        *registry.inner.write().unwrap() = inner;

        registry.set_enabled("a", false).unwrap();
        // Reload and verify.
        let reloaded = load_state(dir.path()).unwrap();
        assert!(!reloaded.extensions.get("a").unwrap().enabled);
    }
}
