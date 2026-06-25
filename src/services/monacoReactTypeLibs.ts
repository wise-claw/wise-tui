/**
 * React/ReactDOM 核心类型同步注入到 Monaco。
 *
 * ## 背景
 *
 * 仓库 100% 依赖 react / react-dom（`@types/react`、`@types/react-dom`），但之前这两个包的
 * `.d.ts` 走的是 `registerRepositoryTypeScriptLibs` 异步路径：先 await Tauri 读文件，再
 * `addExtraLib`。Monaco 在 `beforeMount` 里只是 `void ensureRepositoryTypeScriptEnvironment(...)`
 * 不等待，再加上 `useEffect` 那条 `runWhenIdle(..., { timeoutMs: 1200~4000 })` 路径，
 * Monaco TS worker 的首轮诊断经常在 React 类型还没注册前就跑完，JSX 元素因为
 * `JSX.IntrinsicElements` 缺失全部按 unknown 报红——所有 `<div>`、`<span>`、`<button>`
 * 一片红波浪线。
 *
 * ## 方案
 *
 * React/ReactDOM 是所有仓库都用到的「核心类型」，用 Vite `?raw` 在构建期把关键 d.ts
 * 文本直接打进 bundle。`configureWiseMonacoTypeScript` 是同步路径，monaco 启动
 * 之前就把这些 lib 注入 worker，首轮诊断即可看到正确的 JSX 类型。
 *
 * 其他 `@types/*`（工具/测试类型等）仍走 `registerRepositoryTypeScriptLibs` 异步加载——
 * 它们不是首屏必需的，多等几百毫秒对用户不可感知。
 *
 * ## 体积影响
 *
 * 当前 6 个核心 d.ts 合计 ~7KB 文本，加 csstype stub 后约 8KB，打进 vendor 体积可忽略。
 *
 * ## csstype 为什么要单独打 stub
 *
 * `@types/react/index.d.ts` 顶部有一行 `import * as CSS from "csstype";`，
 * TS worker 解析 react 类型时必须能解析 `csstype` 模块——否则整个 react 类型
 * 解析失败（namespace JSX 块被丢弃），`JSX.IntrinsicElements` 不可用，TSX 元素
 * 全部按 unknown 报红。csstype 真实 d.ts 有 2.2 万行 22KB，全量进 bundle 不划算，
 * 实际 react 只用到 `CSS.Properties<string | number>`，用极简 stub 即可让 import 通过。
 */

// Vite 在构建/运行时把 `?raw` 后缀的文件内容以字符串 default 形式注入。
// 仓库 vite-env.d.ts 已通过 `/// <reference types="vite/client" />` 引入模块声明，
// 所以 `*?raw` 在 TS 看来是 `{ default: string }`——即使源文件是只有 declare 的 .d.ts，
// Vite 仍会以字符串形式 default 导出，TS 不会报错。
//
// 选择这 6 个文件的依据：
// - `react/index.d.ts`：JSX.IntrinsicElements / React.* 全部类型都在这里，
//   且 `/// <reference path="global.d.ts" />` 自动拉入 global.d.ts
// - `react/jsx-runtime.d.ts` + `react/jsx-dev-runtime.d.ts`：`jsx: react-jsx` 模式下
//   编译器自动插入 `react/jsx-runtime`，需要这两个文件来解析 ambient 模块
// - `react-dom/index.d.ts` + `react-dom/client.d.ts`：`react-dom/client` 入口；
//   `createRoot` 等 API 类型在此
import reactIndex from "../../node_modules/@types/react/index.d.ts?raw";
import reactGlobal from "../../node_modules/@types/react/global.d.ts?raw";
import reactJsxRuntime from "../../node_modules/@types/react/jsx-runtime.d.ts?raw";
import reactJsxDevRuntime from "../../node_modules/@types/react/jsx-dev-runtime.d.ts?raw";
import reactDomIndex from "../../node_modules/@types/react-dom/index.d.ts?raw";
import reactDomClient from "../../node_modules/@types/react-dom/client.d.ts?raw";

export interface ReactCoreTypeLib {
  /** Monaco 注册用的虚拟路径，需与仓库本来的 d.ts 位置对齐。 */
  filePath: string;
  /** d.ts 文本，运行时同步注入。 */
  content: string;
}

/**
 * csstype 极简 ambient stub，仅暴露 react 实际访问的成员（CSS.Properties）。
 *
 * `@types/react/index.d.ts` 顶部 `import * as CSS from "csstype";` 决定 TS worker 解析
 * react 类型时必须能解析 `csstype` 模块。真实 csstype d.ts 2.2 万行太大不进 bundle，
 * 这里用宽松的索引签名即可让 import 通过——CSS 属性类型是富信息（CSSProperties 有几百
 * 个字段），但 wise 仓库浏览 TSX 主要看 `JSX.IntrinsicElements` 是否可用，CSSProperties
 * 用 [key: string]: unknown 不影响 JSX 元素检查。
 */
const CSSTYPE_STUB = [
  "declare module 'csstype' {",
  "  export interface Properties<TLength = (string & {}) | 0, TTime = string & {}> {",
  "    [key: string]: unknown;",
  "  }",
  "  export interface Property<TLength = (string & {}) | 0, TTime = string & {}> {",
  "    [key: string]: unknown;",
  "  }",
  "}",
].join("\n");

/**
 * 启动时一次性同步注入的 React/ReactDOM 核心类型清单。
 *
 * 顺序：react 在前（jsx-runtime/client 依赖 react 的全局命名空间），react-dom 紧随其后。
 */
export const REACT_CORE_TYPE_LIBS: ReadonlyArray<ReactCoreTypeLib> = [
  {
    filePath: "file:///node_modules/@types/react/index.d.ts",
    content: reactIndex,
  },
  {
    filePath: "file:///node_modules/@types/react/global.d.ts",
    content: reactGlobal,
  },
  {
    filePath: "file:///node_modules/@types/react/jsx-runtime.d.ts",
    content: reactJsxRuntime,
  },
  {
    filePath: "file:///node_modules/@types/react/jsx-dev-runtime.d.ts",
    content: reactJsxDevRuntime,
  },
  {
    filePath: "file:///node_modules/@types/react-dom/index.d.ts",
    content: reactDomIndex,
  },
  {
    filePath: "file:///node_modules/@types/react-dom/client.d.ts",
    content: reactDomClient,
  },
];

/**
 * 同步把 React/ReactDOM 核心类型 + csstype stub 注入到 Monaco TS worker。
 *
 * 必须在 `configureWiseMonacoTypeScript` 里调用（monaco 启动前的同步路径），
 * 异步路径不保证 Monaco 首轮诊断时这些 lib 已就绪——会复现 JSX 红波浪线竞态。
 */
export function applyReactCoreTypeLibs(
  addExtraLib: (content: string, filePath: string) => { dispose: () => void },
): Array<{ dispose: () => void }> {
  const disposables: Array<{ dispose: () => void }> = [];
  for (const lib of REACT_CORE_TYPE_LIBS) {
    disposables.push(addExtraLib(lib.content, lib.filePath));
  }
  // csstype 必须在 react 之后注入，因为 react/index.d.ts 的 `import * as CSS from "csstype"`
  // 解析时依赖此 stub 存在。
  disposables.push(addExtraLib(CSSTYPE_STUB, "file:///node_modules/csstype/index.d.ts"));
  return disposables;
}

/**
 * 仓库 typePackages 列表里需要被异步路径剔除的前缀。
 *
 * react 与 react-dom 已通过 `applyReactCoreTypeLibs` 同步注入，异步路径再
 * 走 `registerRepositoryTypeScriptLibs` 会重复 addExtraLib 同一份内容（虽然不报错，
 * 但浪费 IPC 流量且可能让 Monaco worker 内部维护两份缓存）。
 */
const SYNC_TYPE_PACKAGE_PREFIXES = ["react", "react-dom", "csstype"];

export function filterAsyncTypePackages(packages: readonly string[]): string[] {
  return packages.filter(
    (pkg) => !SYNC_TYPE_PACKAGE_PREFIXES.some(
      (prefix) => pkg === prefix || pkg.startsWith(`${prefix}/`),
    ),
  );
}
