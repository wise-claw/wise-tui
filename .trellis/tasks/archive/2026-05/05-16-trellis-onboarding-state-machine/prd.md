# Trellis Onboarding State Machine

## Goal

Expose project onboarding state as explicit backend checks so Wise can guide users from selected project to observable Trellis runtime readiness.

## Requirements

- Check Trellis installation, `task.py`, developer identity, workflow, spec layers, hook/platform files, active tasks, and runtime ledger readiness.
- Return status per check with blocking severity and suggested backend action.
- Record onboarding inspection as a runtime event.

## Acceptance Criteria

- [ ] `trellis_runtime_get_onboarding_state` returns ordered checks and overall status.
- [ ] Missing `.trellis/` or missing `task.py` is a blocked state.
- [ ] Existing workflow/spec/hooks produce ready or warning states with evidence.
