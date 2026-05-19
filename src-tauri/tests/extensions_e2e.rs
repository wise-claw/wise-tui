//! End-to-end test driving the bundled `examples/wise-extensions/hello-world`
//! extension through the registry. Avoids spinning up a Tauri app — exercises
//! the registry directly so the test is hermetic.

use std::path::PathBuf;

use tauri_app_lib as _; // ensure the lib crate is linked in

#[test]
fn hello_world_example_loads_and_resolves_contributes() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let scan_root = manifest_dir
        .join("..")
        .join("examples")
        .join("wise-extensions")
        .canonicalize()
        .expect("examples/wise-extensions must exist");

    // Sanity: the example must be present where this test expects it.
    assert!(scan_root.join("hello-world").join("wise-extension.json").exists());

    // Use the public registry surface directly so the test does not depend on
    // the Tauri host or capability files.
    use tauri_app_lib::extensions::ExtensionRegistry;
    let registry = ExtensionRegistry::new();
    let extras = vec![scan_root.clone()];
    registry
        .initialize(None, &extras)
        .expect("initialize must succeed");

    let entries = registry.list();
    let hello = entries
        .iter()
        .find(|e| e.name == "hello-world")
        .expect("hello-world must be in the loaded list");
    assert_eq!(hello.version, "0.1.0");
    assert!(hello.error.is_none(), "expected no error, got {hello:?}");

    let skills = registry.skills();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].extension, "hello-world");
    assert_eq!(skills[0].name, "say-hello");
    assert!(skills[0].location.ends_with("contributes/skill.md"));

    let themes = registry.themes();
    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0].id, "ext-hello-world-hello-warm");

    let decls = registry.settings_declarations();
    assert_eq!(decls.len(), 1);
    assert_eq!(decls[0].id, "ext-hello-world-greeting-text");
}
