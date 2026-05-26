//! User extension library: capture from repositories, install globally or per-repo.

pub mod commands;
mod capture;
mod config_file;
mod discover;
mod hooks_config;
mod install;
mod inventory;
pub mod library;
mod mcp_config;
pub mod paths;

pub use paths::InstallScope;
