---
name: wise-agent-harness-architecture
description: "Use when changing or evaluating Wise product architecture, navigation, ViewMode, Cockpit/Chat/Author/Inspector surfaces, PRD assistant flow, Mission/Trellis runtime binding, Workspace semantics, or configuration-center menus."
---

# Wise Agent Harness Architecture

Use this skill whenever a change affects Wise as a product surface, not just an isolated implementation detail.

Before making decisions, read `.trellis/spec/guides/agent-harness-architecture.md`. It is the source of truth; this skill is only the short operating checklist.

## Product Frame

Wise is a Trellis-native development cockpit, not a Claude Code shell. Its core loop is:

```text
PRD -> Plan -> Split -> Dispatch -> Run -> Verify -> Reflect
```

Every major feature must map to one loop node, to an Author-domain configuration surface, or to a short-lived Inspector lens.

## Domain Test

Classify every UI entry before adding or moving it:

- Operator: the user is running work now. Examples: Chat, Cockpit, PRD assistant conversation, Mission execution.
- Author: the user configures the loop's contracts and supply. Examples: Workspaces, Agents, Delegation Protocol, MCP, Skills, Hooks, Prompts, Trellis Spec.
- Inspector: the user temporarily inspects evidence or context. Examples: code graph, git diff, task detail, progress monitor, session history.

If a surface does not clearly fit, do not add it yet. Update the architecture guide first or reshape the feature.

## ViewMode Rules

- `chat` and `cockpit` are mutually exclusive Operator modes.
- `author` is a separate configuration mode; it should not compete with the main running surface.
- `inspect` is an overlay/drawer/lens over the current mode; it should close back to the prior context.
- Avoid nested mode stacks. If a feature needs Cockpit inside Mission Control inside a modal, the product boundary is wrong.
- Assistant Hub is explicit entry; the app should not default away from the main conversation just because assistants exist.

## Mission And Trellis

- Trellis is the semantic layer; Mission is the runtime instance.
- Runtime work should keep Mission and Trellis records coherent, including shared identifiers where the architecture requires it.
- Loop state should be visible, interruptible, and recoverable. Do not turn dispatch/run/verify into a black box.
- PRD split output stays in the Wise UI sandbox until user confirmation. Materialization writes Trellis task artifacts; dispatch/run status belongs in Mission/runtime surfaces.

## Workspace Semantics

- Workspace is the scheduling boundary and Trellis runtime root.
- Standalone Repo is still a first-class entry for Claude Code, Git, file editing, and code graph.
- A Standalone Repo can be promoted to a Workspace when it needs Trellis orchestration.
- Workspace rootPath is the Trellis/runtime root, not necessarily the physical boundary of all member repositories.
- Workspace main session and member repo execution sessions are separate.

## Configuration Center Rule

Review every settings menu as a workbench product surface:

- Hub: ecosystem entry for extensions, assistants, skills, MCP, engines, channels, automation, artifacts.
- Channel / Remote Access: platform-neutral remote entry. DingTalk, Feishu, WeCom, Telegram, and similar integrations should not become permanent top-level menus.
- Automation: scheduled or background work tied to repository, Mission, or session state.
- Artifact: reviewable outputs such as Markdown, diff, image, HTML, PDF, and Office previews.
- Delegation Protocol: workflow templates, stages, assignments, async progress.
- Runtime Control: Claude/Codex/custom engines, config directories, hooks, sandbox, health checks.

Preserve backend commands and persisted data when reshaping UI. Build adapters or aggregation commands when a cleaner product surface needs them.

