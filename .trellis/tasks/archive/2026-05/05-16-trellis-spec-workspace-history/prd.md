# Trellis Spec Workspace History

## Goal

Version Trellis spec and workflow file edits so Wise can explain how project rules changed over time.

## Requirements

- Record spec/workflow file content revisions with file path, hash, author, reason, and source.
- List revisions by project/root/file path.
- Emit runtime events for spec history changes.

## Acceptance Criteria

- [ ] `trellis_runtime_record_spec_revision` stores a durable revision.
- [ ] `trellis_runtime_list_spec_revisions` returns ordered history.
- [ ] File paths are constrained to `.trellis/spec/**` and `.trellis/workflow.md`.
