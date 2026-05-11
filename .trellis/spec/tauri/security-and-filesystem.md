# Security and Filesystem

> Tauri permissions, asset scope, path validation, and process execution rules.

---

## Capabilities

Tauri 2 capabilities are the allowlist for APIs exposed to app windows. Wise
declares the active permissions in `src-tauri/capabilities/default.json`.

Rules:

- Keep permissions explicit and minimal.
- Add a permission only for a real feature, not preemptively.
- Check which windows need the permission: `main`, `mascot`, or both.
- Do not broaden filesystem permissions when a Rust command can enforce a
  narrower project-specific boundary.
- Review capability changes together with the command or frontend feature that needs them.

---

## Asset Protocol Scope

`src-tauri/tauri.conf.json` currently enables the asset protocol only for:

```json
"scope": ["$HOME/.wise/**"]
```

Do not broaden this scope without a concrete security reason and review of all
paths that can be rendered by the frontend.

User project files should be served or copied through a validated backend flow,
not exposed by widening asset protocol access.

---

## Path Validation

Every path influenced by frontend input, user settings, imported data, plugin
metadata, or LLM output must be validated before use.

For repository-relative paths:

- Trim input.
- Reject empty paths.
- Reject absolute paths.
- Reject `..` path components.
- Join under a canonical repository root.
- Canonicalize the resolved path when the file must already exist.
- Assert the result stays under the intended root.

Existing patterns include `safe_join_repository_root`,
`assert_resolved_path_under_repo`, and similar helpers in `prd_materialize.rs`.

---

## Wise Data Directory

Application-owned durable files live under `~/.wise/`, including:

- `wise.db`
- `repositories.json`
- `tabs.json`
- image and asset materialization directories

Use existing helpers such as `wise_dir()` and atomic write helpers where
available. Do not scatter new dot-directories without a product-level reason.

---

## Process Execution

Wise runs local tools such as Claude Code, terminal commands, and helper CLIs.
Process execution must be treated as a privileged boundary:

- Build argument arrays instead of shell-concatenated command strings.
- Validate working directories with canonical paths.
- Prefer known executable resolution helpers when launching Claude or bundled tools.
- Preserve the GUI-app PATH handling patterns; a desktop app does not inherit a full login-shell PATH.
- Do not log secrets, tokens, or complete environment maps.
- Include cancellation or cleanup for long-running processes.

---

## External Files and Plugins

When reading Claude, MCP, plugin, or project-local configuration:

- Resolve `~`, `$HOME`, and relative paths deliberately.
- Canonicalize existing paths before trusting them.
- Enforce allowed source paths for edits or deletes.
- Treat plugin JSON as untrusted until validated.
- Never delete or overwrite files outside the allowed scope.

---

## Common Mistakes

- Trusting a relative path because it came from the UI.
- Joining paths with strings instead of `Path` and `PathBuf`.
- Canonicalizing only the root but not checking the final resolved path.
- Expanding asset protocol scope for convenience.
- Using shell strings for command execution.
- Forgetting that the mascot window may inherit permissions from the default capability.
