# P0 Mission Ledger, Traceability Index, and Live Agent Assignments — Implementation Plan

## 1. SQLite

- Add migration `020_mission_control.sql`.
- Register migration in `wise_db.rs`.
- Update migration registry test expected names.

## 2. Rust Backend

- Add `src-tauri/src/mission_control.rs`.
- Define command DTOs and helpers.
- Implement Mission create/resume, snapshot read, recent list, event append/list side effects, trace query, agent assignment upsert/complete/list.
- Register module in `src-tauri/src/lib.rs`.
- Register commands in `src-tauri/src/lib_impl.rs`.
- Add Rust unit tests for core SQL behavior and trace extraction helpers.

## 3. Frontend Service

- Add `src/services/missionControlBackend.ts`.
- Keep all raw `invoke` calls inside the service wrapper.
- Add DTO types for Mission snapshots, events, traces, and assignments.

## 4. Validation

- Run targeted Rust tests for mission control / migrations.
- Run TypeScript type check.
- Run frontend tests touched by service types if needed.
- Run `git diff --check`.
- Run GitNexus detect changes before final report.
