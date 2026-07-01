use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacTerminalApp {
    pub id: String,
    pub label: String,
    pub app_name: String,
}

pub struct TerminalDef {
    pub id: &'static str,
    pub label: &'static str,
    pub app_folder_names: &'static [&'static str],
    pub open_app_name: &'static str,
    pub bundle_id: Option<&'static str>,
}

pub const CATALOG: &[TerminalDef] = &[
    TerminalDef {
        id: "terminal",
        label: "终端",
        app_folder_names: &["Terminal"],
        open_app_name: "Terminal",
        bundle_id: Some("com.apple.Terminal"),
    },
    TerminalDef {
        id: "iterm",
        label: "iTerm",
        app_folder_names: &["iTerm", "iTerm2"],
        open_app_name: "iTerm",
        bundle_id: Some("com.googlecode.iterm2"),
    },
    TerminalDef {
        id: "ghostty",
        label: "Ghostty",
        app_folder_names: &["Ghostty"],
        open_app_name: "Ghostty",
        bundle_id: Some("com.mitchellh.ghostty"),
    },
    TerminalDef {
        id: "warp",
        label: "Warp",
        app_folder_names: &["Warp"],
        open_app_name: "Warp",
        bundle_id: Some("dev.warp.Warp-Stable"),
    },
    TerminalDef {
        id: "kitty",
        label: "Kitty",
        app_folder_names: &["kitty", "Kitty"],
        open_app_name: "kitty",
        bundle_id: None,
    },
    TerminalDef {
        id: "alacritty",
        label: "Alacritty",
        app_folder_names: &["Alacritty"],
        open_app_name: "Alacritty",
        bundle_id: None,
    },
    TerminalDef {
        id: "wezterm",
        label: "WezTerm",
        app_folder_names: &["WezTerm"],
        open_app_name: "WezTerm",
        bundle_id: None,
    },
    TerminalDef {
        id: "hyper",
        label: "Hyper",
        app_folder_names: &["Hyper"],
        open_app_name: "Hyper",
        bundle_id: None,
    },
];

fn application_search_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Applications"));
    }
    roots
}

fn bundle_path_is_app(path: &Path) -> bool {
    path.is_dir() && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("app"))
}

fn app_bundle_exists(folder_name: &str) -> bool {
    let bundle = format!("{folder_name}.app");
    for root in application_search_roots() {
        if bundle_path_is_app(&root.join(&bundle)) {
            return true;
        }
        if bundle_path_is_app(&root.join("Utilities").join(&bundle)) {
            return true;
        }
    }
    false
}

#[cfg(target_os = "macos")]
fn app_installed_via_bundle_id(bundle_id: &str) -> bool {
    let output = match Command::new("mdfind").arg(format!("kMDItemCFBundleIdentifier == '{bundle_id}'")).output()
    {
        Ok(out) => out,
        Err(_) => return false,
    };
    if !output.status.success() {
        return false;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().any(|line| {
        let path = Path::new(line.trim());
        bundle_path_is_app(path)
    })
}

#[cfg(not(target_os = "macos"))]
fn app_installed_via_bundle_id(_bundle_id: &str) -> bool {
    false
}

fn terminal_def_installed(def: &TerminalDef) -> bool {
    if def
        .app_folder_names
        .iter()
        .any(|name| app_bundle_exists(name))
    {
        return true;
    }
    if let Some(bundle_id) = def.bundle_id {
        return app_installed_via_bundle_id(bundle_id);
    }
    false
}

#[cfg(target_os = "macos")]
pub fn detect_installed_mac_terminals() -> Vec<MacTerminalApp> {
    let mut found = Vec::new();
    for def in CATALOG {
        if terminal_def_installed(def) {
            found.push(MacTerminalApp {
                id: def.id.to_string(),
                label: def.label.to_string(),
                app_name: def.open_app_name.to_string(),
            });
        }
    }
    found
}

#[cfg(not(target_os = "macos"))]
pub fn detect_installed_mac_terminals() -> Vec<MacTerminalApp> {
    Vec::new()
}

#[tauri::command]
pub fn macos_detect_terminals() -> Vec<MacTerminalApp> {
    detect_installed_mac_terminals()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_are_unique() {
        let mut ids = std::collections::HashSet::new();
        for def in CATALOG {
            assert!(ids.insert(def.id), "duplicate id: {}", def.id);
        }
    }
}
