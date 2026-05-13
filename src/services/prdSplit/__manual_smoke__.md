# Stage 1 manual smoke

> 不在 CI 跑；Stage 4 wizard 接好以后这份文档可以删除。

把 Stage 1 的两个 Tauri 命令在 devtools 里串起来跑通一遍，验证父子任务真的能写到 `.trellis/tasks/`。

## 准备

1. 在一个有 `.trellis/` 的项目里启动 `bun run tauri:dev`（**仅在用户授权时**；本仓库 AI agent 默认不动 dev server）。
2. 浏览器 devtools 打开。
3. `import { invoke } from "@tauri-apps/api/core"`（已挂在 window 上时可省略）。

## 创建父任务

```js
const projectRootPath = "/Users/me/path/to/project"; // 绝对路径

const parent = await invoke("prd_split_create_parent_task", {
  input: {
    projectRootPath,
    clusterId: "cluster-fe-smoke",
    title: "Smoke parent — frontend cluster",
    description: "Stage 1 smoke",
    prdMarkdown: "# Smoke PRD\n\n这是一个端到端冒烟测试。",
    requirementsIndexJson: JSON.stringify({
      version: "smoke-0",
      schemaVersion: 2,
      requirements: [
        { id: "req-functional-1", content: "登录流程", bodyHash: "deadbeef" },
      ],
    }, null, 2),
    primaryRepositoryId: 7,
    repositoryIds: [7],
  },
});

console.log("parent:", parent);
// → { parentTaskName: "MM-DD-smoke-parent-frontend-cluster", parentTaskPath: "..." }
```

落盘后检查：
- `.trellis/tasks/<parentTaskName>/task.json` 含 `repositoryId: 7`、`clusterId: "cluster-fe-smoke"`、`meta.clusterRepositoryIds: [7]`。
- `.trellis/tasks/<parentTaskName>/prd.md` 是你传入的 PRD（已被覆盖）。
- `.trellis/tasks/<parentTaskName>/requirements-index.json` 是你传入的 JSON。

## 写入子任务

```js
const materialize = await invoke("prd_split_materialize_tasks", {
  input: {
    projectRootPath,
    parentTaskName: parent.parentTaskName,
    cluster: {
      id: "cluster-fe-smoke",
      title: "Frontend cluster",
      primaryRepositoryId: 7,
      repositoryIds: [7],
    },
    childTasks: [
      {
        title: "Wire login form",
        slug: "wire-login-form",
        prdMarkdown: "# Wire login form\n\n* req-functional-1",
        repositoryId: 7,
        clusterId: "cluster-fe-smoke",
        role: "frontend",
        dependencies: [],
        sourceRequirementIds: ["req-functional-1"],
        taskAnchors: {
          from: 0,
          to: 12,
          textHash: "abcdef0123456789",
          contextBefore: "",
          contextAfter: "登录流程",
        },
      },
    ],
    claudeSplitMapping: {
      version: 1,
      taskRequirementLinks: [
        { taskId: "wire-login-form", requirementIds: ["req-functional-1"] },
      ],
      capturedAtMs: Date.now(),
    },
  },
});

console.log("materialize:", materialize);
// → { parentTaskName: "...", childTaskNames: ["MM-DD-wire-login-form"], warnings: [] }
```

落盘后检查：
- 子任务 `.trellis/tasks/<childName>/task.json` 含 `parent: <parentTaskName>`、`repositoryId: 7`、`clusterId: "cluster-fe-smoke"`、`dev_type: "frontend"`、`meta.sourceRequirementIds: ["req-functional-1"]`、`meta.taskAnchors: {…}`。
- 父 `.trellis/tasks/<parentTaskName>/task.json` 的 `children` 数组包含 `<childName>`。
- 父 `.trellis/tasks/<parentTaskName>/task.json` 的 `meta.claudeSplitMapping` 含 `taskRequirementLinks`。

## 清理

```bash
python3 .trellis/scripts/task.py archive <childName>
python3 .trellis/scripts/task.py archive <parentName>
```

或直接 `rm -rf` 那两个目录 + `git checkout` `.trellis/tasks` 的更改。
