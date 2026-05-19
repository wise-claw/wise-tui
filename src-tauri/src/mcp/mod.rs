//! MCP (Model Context Protocol) unified abstraction.
//!
//! This module introduces a backend-neutral, trait-based protocol for
//! managing MCP servers. The existing `claude_commands::mcp` surface is
//! preserved unchanged; this layer adds:
//!
//! - A typed `McpTransport` enum covering all four official transports.
//! - An `McpProtocol` trait every backend can implement.
//! - A new `mcp_server` table storing user-defined servers neutrally
//!   (source = `User | Builtin | Extension(String)`).
//! - Tauri commands for CRUD against that table.
//!
//! Transport-level connection testing (with OAuth challenge surfacing)
//! and engine-bound sync are scaffolded but full implementation is
//! deferred to a follow-up — v1 ships the storage + types + a stub
//! tester so the frontend can already wire up against the contract.

pub mod protocol;
pub mod storage;
pub mod transport;
pub mod commands;
