import { describe, expect, test } from "bun:test";
import type { TaskItem } from "../types";
import { countDrawerExecutableTasks, countDrawerWiseTodoTasks } from "./taskDrawerCounts";

function task(id: string, flowStatus?: TaskItem["flowStatus"]): TaskItem {
  return {
    id,
    title: id,
    description: "",
    subtasks: [],
    dod: [],
    dependencies: [],
    flowStatus,
  };
}

describe("taskDrawerCounts", () => {
  test("countDrawerWiseTodoTasks counts todo-like statuses", () => {
    expect(countDrawerWiseTodoTasks([task("a", "todo"), task("b", "done")])).toBe(1);
    expect(countDrawerWiseTodoTasks([task("a", "in_progress")])).toBe(1);
    expect(countDrawerWiseTodoTasks([task("a", "pending")])).toBe(1);
  });

  test("countDrawerExecutableTasks returns wise todo total", () => {
    expect(countDrawerExecutableTasks([task("a", "todo"), task("b", "done")])).toEqual({
      wiseTodo: 1,
      total: 1,
    });
  });
});
