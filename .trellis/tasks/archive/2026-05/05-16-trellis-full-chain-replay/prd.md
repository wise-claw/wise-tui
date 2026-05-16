# Trellis Full-Chain Replay

## Goal

Merge Trellis runtime events, agent ownership updates, and spec revisions into a single timeline for later visual replay.

## Requirements

- Filter replay by project, root path, session, task path, and timestamp range.
- Include runtime events, agent run state, and spec revision entries.
- Return stable IDs and typed entry kinds.

## Acceptance Criteria

- [ ] `trellis_runtime_get_replay` returns a timestamp-ordered timeline.
- [ ] Replay includes event, agentRun, and specRevision entries.
- [ ] Empty filters return a safe empty list or scoped project timeline.
