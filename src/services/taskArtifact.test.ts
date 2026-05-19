import { describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: mock(async () => null),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  readTaskArtifact,
  writeTaskArtifact,
  type TaskArtifactPayload,
} from "./taskArtifact";

describe("taskArtifact", () => {
  test("readTaskArtifact passes camelCase args under `args` key", async () => {
    const payload: TaskArtifactPayload = {
      taskDir: ".trellis/tasks/05-18-foo",
      kind: "prd",
      markdown: "# hello",
      exists: true,
    };
    (invoke as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      () => Promise.resolve(payload),
    );

    const result = await readTaskArtifact({
      repoRoot: "/abs/repo",
      taskDir: ".trellis/tasks/05-18-foo",
      kind: "prd",
    });

    expect((invoke as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)).toEqual([
      "read_task_artifact",
      {
        args: {
          repoRoot: "/abs/repo",
          taskDir: ".trellis/tasks/05-18-foo",
          kind: "prd",
        },
      },
    ]);
    expect(result).toEqual(payload);
  });

  test("readTaskArtifact handles design / implement kinds", async () => {
    (invoke as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      () =>
        Promise.resolve({
          taskDir: ".trellis/tasks/05-18-foo",
          kind: "design",
          markdown: "",
          exists: false,
        }),
    );

    const result = await readTaskArtifact({
      repoRoot: "/abs/repo",
      taskDir: ".trellis/tasks/05-18-foo",
      kind: "design",
    });

    expect((invoke as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)).toEqual([
      "read_task_artifact",
      {
        args: {
          repoRoot: "/abs/repo",
          taskDir: ".trellis/tasks/05-18-foo",
          kind: "design",
        },
      },
    ]);
    expect(result.exists).toBe(false);
  });

  test("writeTaskArtifact passes markdown alongside scope args", async () => {
    const payload: TaskArtifactPayload = {
      taskDir: ".trellis/tasks/05-18-foo",
      kind: "implement",
      markdown: "# plan",
      exists: true,
    };
    (invoke as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      () => Promise.resolve(payload),
    );

    const result = await writeTaskArtifact({
      repoRoot: "/abs/repo",
      taskDir: ".trellis/tasks/05-18-foo",
      kind: "implement",
      markdown: "# plan",
    });

    expect((invoke as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)).toEqual([
      "write_task_artifact",
      {
        args: {
          repoRoot: "/abs/repo",
          taskDir: ".trellis/tasks/05-18-foo",
          kind: "implement",
          markdown: "# plan",
        },
      },
    ]);
    expect(result).toEqual(payload);
  });
});
