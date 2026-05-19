//! Extension system — manifest, loader, registry, lifecycle, watcher, commands.
//!
//! Greenfield module. Owns its own JSON state file (`~/.wise/extension-states.json`);
//! does not touch SQLite, Mission, Trellis, or Claude paths.

pub mod manifest;
pub mod loader;
pub mod state;
pub mod registry;
pub mod lifecycle;
pub mod commands;

pub use registry::ExtensionRegistry;
