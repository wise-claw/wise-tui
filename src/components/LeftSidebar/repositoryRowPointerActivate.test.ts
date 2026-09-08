import { beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  handleRepositoryRowPointerDown,
  isKeyboardRepositoryRowClick,
  isRepositoryRowNestedActionTarget,
} from "./repositoryRowPointerActivate";

beforeAll(() => {
  const domWindow = new Window();
  globalThis.document = domWindow.document as unknown as Document;
  globalThis.Element = domWindow.Element as unknown as typeof Element;
});

function pointerEvent(button: number, target: EventTarget | null, preventDefault = () => undefined) {
  return { button, target, preventDefault } as unknown as Parameters<typeof handleRepositoryRowPointerDown>[0];
}

test("忽略按钮、展开箭头和拖动手柄，左键按下才激活", () => {
  const button = document.createElement("button");
  button.className = "app-repository-header-btn";
  expect(isRepositoryRowNestedActionTarget(button)).toBe(true);

  const handle = document.createElement("span");
  handle.className = "app-repository-drag-handle";
  expect(isRepositoryRowNestedActionTarget(handle)).toBe(true);

  const name = document.createElement("span");
  name.className = "app-repository-name";
  expect(isRepositoryRowNestedActionTarget(name)).toBe(false);

  const calls: string[] = [];
  handleRepositoryRowPointerDown(pointerEvent(2, name), () => calls.push("right"));
  handleRepositoryRowPointerDown(pointerEvent(0, button), () => calls.push("nested"));
  handleRepositoryRowPointerDown(pointerEvent(0, name), () => calls.push("name"));
  expect(calls).toEqual(["name"]);
});

test("整行拖拽时不 preventDefault，以免打断 HTML5 drag", () => {
  const name = document.createElement("span");
  let prevented = false;
  handleRepositoryRowPointerDown(
    pointerEvent(0, name, () => {
      prevented = true;
    }),
    () => undefined,
    { preserveDefaultForDrag: true },
  );
  expect(prevented).toBe(false);

  prevented = false;
  handleRepositoryRowPointerDown(
    pointerEvent(0, name, () => {
      prevented = true;
    }),
    () => undefined,
  );
  expect(prevented).toBe(true);
});

test("鼠标 click 视为已由 pointerdown 处理，键盘 click 仍可激活", () => {
  expect(isKeyboardRepositoryRowClick({ detail: 0 })).toBe(true);
  expect(isKeyboardRepositoryRowClick({ detail: 1 })).toBe(false);
});
