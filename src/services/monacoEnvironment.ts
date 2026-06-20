/**
 * Monaco 本地加载环境配置。
 *
 * `@monaco-editor/loader` 默认从 CDN（jsdelivr）下载 monaco-editor，对 Tauri 桌面应用不可接受：
 * 离线即不可用、版本随 CDN 漂移、首屏打开文件需联网下载 ~5MB。本模块把本地打包的 monaco-editor
 * 实例注入 loader，并设置 worker 工厂，使 Monaco 完全从本地 chunk 加载。
 *
 * 由 main.tsx 在应用启动时尽早异步 import：不阻塞首屏 root render，且在首个编辑器 mount 前
 * 完成 loader 配置（编辑器按需打开，通常有数秒交互窗口）。即便极端竞态下未及时就绪，
 * @monaco-editor/react 会降级走默认 CDN，不会崩溃。
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

interface MonacoWorkerEnvironment {
  getWorker(workerId: string, label: string): Worker;
}

const monacoEnvironment: MonacoWorkerEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

(self as unknown as { MonacoEnvironment: MonacoWorkerEnvironment }).MonacoEnvironment = monacoEnvironment;

// 注入本地打包的 monaco 实例，使 @monaco-editor/react 不再走 CDN。
loader.config({ monaco });
