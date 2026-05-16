# Trellis Workflow Compiler

## Goal

Compile `.trellis/workflow.md` into a structured backend model that Wise can visualize and validate without parsing Markdown in frontend components.

## Requirements

- Parse phase headings, step headings, workflow-state blocks, and platform routing blocks.
- Report missing workflow file, missing required state blocks, and empty phase/step output as validation issues.
- Record a runtime event every time compilation runs.

## Acceptance Criteria

- [ ] `trellis_runtime_compile_workflow` returns phases, steps, workflow states, platform blocks, and validation issues.
- [ ] Missing workflow produces a safe response with validation issues, not a panic.
- [ ] Unit tests cover phase/step/state extraction.
