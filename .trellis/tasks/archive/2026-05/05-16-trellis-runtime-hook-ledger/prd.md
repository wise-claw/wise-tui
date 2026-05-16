# Trellis Runtime Hook Ledger

## Goal

Record Trellis hook and runtime events as durable, queryable backend facts so Wise can later show what each hook executed, what it injected, and whether it failed.

## Requirements

- Provide an append-only runtime event API.
- Support event filtering by project, root path, session, task path, and event kind.
- Store structured payload JSON with timestamps and correlation IDs.
- Use the same ledger for future hook ingestion and backend-generated lifecycle events.

## Acceptance Criteria

- [ ] `trellis_runtime_record_event` persists an event and returns the saved row.
- [ ] `trellis_runtime_list_events` returns ordered filtered events.
- [ ] Events include project/root/session/task/platform/actor/correlation fields.
