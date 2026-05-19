//! Skills three-tier source model.
//!
//! Adds a unified `source: 'builtin' | 'custom' | 'extension'` view over
//! Wise's existing skill surfaces. `skills_sh.rs` (registry search) is
//! left untouched; this module adds external-path discovery, copy/symlink
//! import, and a classifier that the existing `ClaudeProjectSkill` outputs
//! consume.

pub mod source;
pub mod external_paths;
pub mod import;
pub mod commands;
