/**
 * Monaco 本地加载环境配置。
 *
 * `@monaco-editor/loader` 默认从 CDN（jsdelivr）下载 monaco-editor，对 Tauri 桌面应用不可接受：
 * 离线即不可用、版本随 CDN 漂移、首屏打开文件需联网下载 ~5MB。本模块把本地打包的 monaco-editor
 * 实例注入 loader，并设置 worker 工厂，使 Monaco 完全从本地 chunk 加载。
 *
 * 由 `ensureMonacoEnvironmentReady` / `preloadMonacoEditor` 在首次打开编辑器时按需 import，
 * 避免应用冷启动即解析 monaco-vendor。
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
