import { describe, expect, test } from "bun:test";
import {
  applyReactCoreTypeLibs,
  filterAsyncTypePackages,
  REACT_CORE_TYPE_LIBS,
} from "./monacoReactTypeLibs";

describe("monacoReactTypeLibs", () => {
  test("同步注入清单非空且包含 React/ReactDOM 关键入口", () => {
    expect(REACT_CORE_TYPE_LIBS.length).toBeGreaterThan(0);
    const paths = REACT_CORE_TYPE_LIBS.map((lib) => lib.filePath);
    expect(paths).toContain("file:///node_modules/@types/react/index.d.ts");
    expect(paths).toContain("file:///node_modules/@types/react/jsx-runtime.d.ts");
    expect(paths).toContain("file:///node_modules/@types/react/jsx-dev-runtime.d.ts");
    expect(paths).toContain("file:///node_modules/@types/react-dom/index.d.ts");
    expect(paths).toContain("file:///node_modules/@types/react-dom/client.d.ts");
  });

  test("所有 filePath 都走 file:///node_modules/@types/... 形式", () => {
    for (const lib of REACT_CORE_TYPE_LIBS) {
      expect(lib.filePath.startsWith("file:///node_modules/@types/")).toBe(true);
      expect(lib.filePath.endsWith(".d.ts")).toBe(true);
    }
  });

  test("d.ts 文本非空且看起来像类型声明", () => {
    for (const lib of REACT_CORE_TYPE_LIBS) {
      expect(lib.content.length).toBeGreaterThan(0);
      expect(/declare|export|interface/.test(lib.content)).toBe(true);
    }
  });

  test("applyReactCoreTypeLibs 按清单顺序同步调用 addExtraLib, csstype stub 在末尾", () => {
    const calls: Array<{ content: string; filePath: string }> = [];
    const disposables = applyReactCoreTypeLibs((content, filePath) => {
      calls.push({ content, filePath });
      return { dispose() {} };
    });
    // 6 个 react/react-dom d.ts + 1 个 csstype stub = 7
    expect(calls.length).toBe(REACT_CORE_TYPE_LIBS.length + 1);
    expect(disposables.length).toBe(REACT_CORE_TYPE_LIBS.length + 1);
    for (let i = 0; i < REACT_CORE_TYPE_LIBS.length; i += 1) {
      expect(calls[i]?.filePath).toBe(REACT_CORE_TYPE_LIBS[i]?.filePath);
      expect(calls[i]?.content).toBe(REACT_CORE_TYPE_LIBS[i]?.content);
    }
    // csstype stub 在最后
    const csstypeCall = calls[calls.length - 1];
    expect(csstypeCall?.filePath).toBe("file:///node_modules/csstype/index.d.ts");
    expect(csstypeCall?.content).toContain("declare module 'csstype'");
    expect(csstypeCall?.content).toContain("Properties");
  });

  test("filterAsyncTypePackages 剥离 react 与 react-dom 与 csstype", () => {
    expect(
      filterAsyncTypePackages([
        "react",
        "react-dom",
        "csstype",
        "react/jsx-runtime",
        "node",
        "vitest",
      ]),
    ).toEqual(["node", "vitest"]);
  });

  test("filterAsyncTypePackages 不误伤非 React 同名前缀", () => {
    expect(
      filterAsyncTypePackages(["react-native", "react-router-dom", "node"]),
    ).toEqual(["react-native", "react-router-dom", "node"]);
  });

  test("filterAsyncTypePackages 接受空数组与冻结数组", () => {
    expect(filterAsyncTypePackages([])).toEqual([]);
    const readonlyPackages: readonly string[] = Object.freeze(["react", "node"]);
    expect(filterAsyncTypePackages(readonlyPackages)).toEqual(["node"]);
  });
});
