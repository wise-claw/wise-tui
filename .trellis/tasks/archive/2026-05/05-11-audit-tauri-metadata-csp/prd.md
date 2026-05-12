# PRD: Correct Tauri Package Metadata and Document CSP Plan

## Problem

`src-tauri/Cargo.toml` still contains template metadata: `name = "tauri-app"`, `description = "A Tauri App"`, and `authors = ["you"]`. `src-tauri/tauri.conf.json` has `csp: null`, which disables content security policy. The audit marks metadata as low priority and CSP as follow-up because asset protocol scope is already constrained to `$HOME/.wise/**`.

## Scope

- Update Cargo package metadata to real Wise values.
- Confirm crate/lib naming constraints before changing library names.
- Decide whether CSP can be safely enabled now or should be documented as a follow-up with constraints.
- If CSP is enabled, verify it does not break Tauri asset protocol, local app assets, markdown rendering, Monaco/Milkdown, or image previews.
- If CSP remains disabled, document why and create an explicit follow-up note.

## Acceptance Criteria

- Cargo package metadata no longer uses template values.
- Any package or lib rename is compile-safe and reflected where required.
- `tauri.conf.json` CSP state is intentional and documented.
- Asset protocol scope remains no broader than `$HOME/.wise/**` unless a separate security review justifies it.
- Relevant checks pass without starting frontend dev servers unless explicitly allowed.

## Non-Goals

- Do not broaden filesystem or asset protocol access.
- Do not perform large Rust module extraction in this task.
- Do not hardcode author-private data without project agreement.
