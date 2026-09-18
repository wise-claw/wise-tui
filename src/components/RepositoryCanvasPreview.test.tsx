import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, create } from "react-test-renderer";
import { Button, Segmented, Select } from "antd";
import { RepositoryCanvasPreview } from "./RepositoryCanvasPreview";

const dom = new Window();
const saved = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
  for (const key of ["window", "document", "HTMLElement", "Element", "Node", "ShadowRoot", "SVGElement", "getComputedStyle", "ResizeObserver", "IS_REACT_ACT_ENVIRONMENT"]) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : (dom as unknown as Record<string, unknown>)[key];
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
});
afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  dom.happyDOM.abort();
});

test("Canvas isolates scripts, changes viewport, refreshes and reflects updated content", () => {
  let renderer: ReturnType<typeof create>;
  act(() => { renderer = create(<RepositoryCanvasPreview path="demo.html" content="<button>First</button>" />); });
  const root = renderer!.root;
  const initialFrame = root.findByType("iframe");
  expect(initialFrame.props.sandbox).toBe("allow-scripts");
  expect(initialFrame.props.referrerPolicy).toBe("no-referrer");
  expect(initialFrame.props.srcDoc).toContain("First");
  act(() => root.findByType(Segmented).props.onChange("390"));
  expect(root.findByType("iframe").props.style.width).toBe("390px");
  act(() => root.findAllByType(Button)[0].props.onClick());
  expect(root.findByType("iframe")).not.toBe(initialFrame);
  act(() => renderer!.update(<RepositoryCanvasPreview path="demo.html" content="<h1>Updated</h1>" />));
  expect(root.findByType("iframe").props.srcDoc).toContain("Updated");
  expect(root.findByType("iframe").props.style.width).toBe("390px");
  act(() => root.findByType(Select).props.onChange(75));
  expect(root.findByType("iframe").props.style.zoom).toBe(0.75);
  act(() => root.findAllByType(Button)[1].props.onClick());
  expect(root.findByType("section").props.className).toContain("app-canvas--expanded");
  act(() => root.findAllByType(Button)[1].props.onClick());
  expect(root.findByType("section").props.className).not.toContain("app-canvas--expanded");
  act(() => renderer!.unmount());
});
