# Trellis Workspace Snapshot Diff

## Goal

Capture and diff Trellis workspace manifests so Wise can explain what initialization, hooks, specs, tasks, and agents changed.

## Requirements

- Capture hashed file manifests for `.trellis/`, `.codex/`, `.claude/`, and Trellis shared skills.
- Persist snapshots with source/reason metadata.
- Diff two snapshots into added, removed, modified, and unchanged file rows.

## Acceptance Criteria

- [ ] `trellis_runtime_capture_workspace_snapshot` stores a snapshot manifest.
- [ ] `trellis_runtime_diff_workspace_snapshots` compares two persisted snapshots.
- [ ] Snapshot scanning does not read outside the allowed project directories.
