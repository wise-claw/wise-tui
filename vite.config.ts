import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

/** 仅按需打开的功能块，不应出现在 index 入口的 modulepreload 里。 */
const DEFERRED_MODULE_PRELOAD_CHUNK =
  /(?:^|\/)assets\/(?:cc-wf-mermaid|cc-wf-reactflow|cc-wf-radix|WiseCcWorkflowStudioPanel|composer-region|milkdown-vendor|codemirror-vendor|monaco-vendor|terminal-vendor|graph-vendor|AuthorPanel|x6-vendor|driver-vendor)/;

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    /** 避免多份 React 进入不同 chunk，引发 `useLayoutEffect` of undefined。 */
    dedupe: ["react", "react-dom"],
    alias: {
      /** CC Workflow Studio（vendor）与上游一致的 `@shared/*` 解析。 */
      "@shared": resolve(root, "src/features/cc-wf-studio/vendor/shared"),
      /** 与 vendor 解耦的纯类型与导出生成（slash / mermaid）。 */
      "@cc-workflow-studio-core": resolve(root, "src/cc-workflow-studio-core"),
      /** Radix Portal 挂到工作流壳，修正内嵌时 Popper/Dialog 锚点相对整窗偏移。 */
      "@radix-ui/react-portal": resolve(root, "src/features/cc-wf-studio/shims/wiseRadixPortal.tsx"),
      /** Radix DismissableLayer 默认对 body 设 pointer-events:none，会锁死整个 Wise；改为仅锁 shell-main。 */
      "@radix-ui/react-dismissable-layer": resolve(
        root,
        "src/features/cc-wf-studio/shims/wiseRadixDismissableLayer.tsx",
      ),
    },
  },
  /** 勿预打包 Radix：避免把未走 alias 的 `@radix-ui/react-portal` 打进依赖块，导致蒙层仍挂 body。 */
  optimizeDeps: {
    exclude: [
      "@radix-ui/react-portal",
      "@radix-ui/react-dismissable-layer",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-switch",
      "@radix-ui/react-toggle-group",
      "@radix-ui/react-collapsible",
    ],
    include: [
      "reactflow",
      "mermaid",
      "zustand",
      "zundo",
      "lucide-react",
      "driver.js",
    ],
  },
  build: {
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => !DEFERRED_MODULE_PRELOAD_CHUNK.test(dep.replace(/\\/g, "/"))),
    },
    /** 已知 vendor（mermaid / antd / codemirror）体积大；避免构建日志被无行动意义的告警淹没。 */
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        mascot: resolve(root, "mascot.html"),
        /** 独立诊断页：开发时 http://localhost:16088/demo.html，不经过 Vue 入口 */
        demo: resolve(root, "public/demo.html"),
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("@tauri-apps")) {
            return "tauri-vendor";
          }
          if (
            id.includes("node_modules/graphology") ||
            id.includes("node_modules/sigma/") ||
            id.includes("@sigma/")
          ) {
            return "graph-vendor";
          }
          if (id.includes("driver.js")) {
            return "driver-vendor";
          }
          // 仅匹配核心 react / react-dom，勿用 `/react/`（会误伤 @milkdown/react 等）。
          if (id.includes("node_modules/react-dom/") || id.includes("node_modules/react/")) {
            return "react-vendor";
          }
          if (id.includes("@monaco-editor") || id.includes("/monaco-editor/")) {
            return "monaco-vendor";
          }
          if (id.includes("@milkdown/") || id.includes("remark-") || id.includes("rehype-")) {
            return "milkdown-vendor";
          }
          if (id.includes("@codemirror/language-data")) {
            return "codemirror-language-data";
          }
          if (id.includes("@codemirror/lang-")) {
            return "codemirror-langs";
          }
          if (id.includes("prosemirror")) {
            return "prosemirror-vendor";
          }
          if (id.includes("@lezer/")) {
            return "codemirror-parser";
          }
          if (id.includes("@codemirror/") || id.includes("/codemirror/")) {
            return "codemirror-vendor";
          }
          if (id.includes("katex")) {
            return "katex-vendor";
          }
          if (id.includes("@antv/x6")) {
            return "x6-vendor";
          }
          if (id.includes("reactflow") || id.includes("/@reactflow/")) {
            return "cc-wf-reactflow";
          }
          if (id.includes("mermaid")) {
            return "cc-wf-mermaid";
          }
          if (id.includes("@radix-ui/")) {
            return "cc-wf-radix";
          }
          if (id.includes("@xterm/") || id.includes("/xterm/")) {
            return "terminal-vendor";
          }
          if (
            id.includes("node_modules/antd/") ||
            id.includes("/rc-") ||
            id.includes("/@rc-component/")
          ) {
            return "antd-vendor";
          }
          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 16088,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
