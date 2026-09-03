import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, cpSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const MATERIAL_ICONS_DIR = resolve(
  root,
  "node_modules/vscode-material-icons/generated/icons",
);
const MATERIAL_ICONS_MOUNT = "/material-icons";

/** Dev 中间件 + build 拷贝：自托管 Material Icon Theme SVG。 */
function materialIconsStaticPlugin(): Plugin {
  return {
    name: "wise-material-icons-static",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url ?? "";
        if (!rawUrl.startsWith(`${MATERIAL_ICONS_MOUNT}/`)) {
          next();
          return;
        }
        const pathname = decodeURIComponent(rawUrl.split("?", 1)[0] ?? "");
        const relative = pathname.slice(MATERIAL_ICONS_MOUNT.length + 1);
        if (!relative || relative.includes("\0") || relative.includes("..")) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const filePath = normalize(join(MATERIAL_ICONS_DIR, relative));
        if (
          !filePath.startsWith(MATERIAL_ICONS_DIR + sep) ||
          extname(filePath).toLowerCase() !== ".svg" ||
          !existsSync(filePath) ||
          !statSync(filePath).isFile()
        ) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=604800, immutable");
        createReadStream(filePath).pipe(res);
      });
    },
    writeBundle(options) {
      if (!existsSync(MATERIAL_ICONS_DIR)) {
        return;
      }
      const outDir = options.dir ? resolve(options.dir) : resolve(root, "dist");
      cpSync(MATERIAL_ICONS_DIR, resolve(outDir, "material-icons"), { recursive: true });
    },
  };
}

/** 仅按需打开的功能块，不应出现在 index 入口的 modulepreload 里。 */
const DEFERRED_MODULE_PRELOAD_CHUNK =
  /(?:^|\/)assets\/(?:composer-region|markdown-vendor|tiptap-vendor|codemirror-vendor|monaco-vendor|terminal-vendor|graph-vendor|mermaid-vendor|antd-vendor|AuthorPanel|x6-vendor)/;

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  assetsInclude: ["**/*.wasm"],
  plugins: [react(), materialIconsStaticPlugin()],
  resolve: {
    /**
     * 避免多份 React / ProseMirror 进入不同 chunk：
     * - React 多份会引发 `useLayoutEffect` of undefined；
     * - prosemirror-model/view 被 nested node_modules 重复安装时，`splitBlock`（Enter）与
     *   列表/表格等 transform 命令会抛 "multiple versions of prosemirror-model were loaded"，
     *   导致 tiptap 内 Enter 与工具栏按钮失效。强制解析到项目根目录同一份。
     */
    dedupe: [
      "react",
      "react-dom",
      "prosemirror-model",
      "prosemirror-view",
      "prosemirror-state",
      "prosemirror-transform",
      "prosemirror-commands",
      "prosemirror-schema-list",
      "prosemirror-tables",
      "prosemirror-keymap",
    ],
  },
  optimizeDeps: {
    /** 开发态 esbuild 预构建同样强制单份，避免 dev 与 build 行为不一致。 */
    dedupe: [
      "prosemirror-model",
      "prosemirror-view",
      "prosemirror-state",
      "prosemirror-transform",
      "prosemirror-commands",
      "prosemirror-schema-list",
      "prosemirror-tables",
      "prosemirror-keymap",
    ],
  },
  build: {
    modulePreload: {
      /**
       * Tauri 2 的受支持 WebView 均原生支持 modulepreload。关闭 Vite 的兼容 polyfill，
       * 避免它被 Rollup 提升进某个大型动态 vendor（曾把入口绑到 3MB Mermaid chunk）。
       */
      polyfill: false,
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => !DEFERRED_MODULE_PRELOAD_CHUNK.test(dep.replace(/\\/g, "/"))),
    },
    /** 已知 vendor（mermaid / antd / codemirror）体积大；避免构建日志被无行动意义的告警淹没。 */
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        mascot: resolve(root, "mascot.html"),
        hud: resolve(root, "hud.html"),
      },
      output: {
        manualChunks(id) {
          const moduleId = id.replace(/\\/g, "/");
          // 动态 import 的共享预加载 helper 必须留在独立小 chunk；如果交给 Rollup，
          // 它可能落入首个大型动态 vendor，反向制造启动期静态依赖。
          if (id === "\0vite/preload-helper.js") {
            return "vite-runtime";
          }
          // 启动壳与 AppImpl 共用的小模块必须钉死独立 chunk。否则 Vite 会把它们
          // 并进 @mermaid-js/parser 的语言块（产物名常带 cynefin），导致 main/AppImpl
          // 静态依赖 3MB mermaid-vendor，并经由 dayjs 等共享依赖间接拖入 antd-vendor。
          if (moduleId.endsWith("/src/utils/safeTauriUnlisten.ts")) {
            return "wise-runtime";
          }
          if (
            moduleId.endsWith("/src/utils/mermaidRender.ts") ||
            moduleId.endsWith("/src/utils/mermaidViewerUi.ts") ||
            moduleId.endsWith("/src/utils/mermaidSourceNormalize.ts")
          ) {
            return "mermaid-runtime";
          }
          if (!moduleId.includes("/node_modules/")) {
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
          // 仅匹配核心 react / react-dom，勿用 `/react/`（会误伤 @tiptap/react 等）。
          if (id.includes("node_modules/react-dom/") || id.includes("node_modules/react/")) {
            return "react-vendor";
          }
          if (id.includes("@monaco-editor") || id.includes("/monaco-editor/")) {
            return "monaco-vendor";
          }
          if (id.includes("remark-") || id.includes("rehype-")) {
            return "markdown-vendor";
          }
          if (
            id.includes("@tiptap/") ||
            id.includes("tiptap-markdown") ||
            id.includes("node_modules/lowlight")
          ) {
            return "tiptap-vendor";
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
          // DOMPurify 是启动期与 Markdown/Mermaid 共用的小依赖；必须独立分块，
          // 否则 Rollup 可能把入口对 DOMPurify 的静态引用并入巨型 Mermaid chunk。
          if (id.includes("node_modules/dompurify/")) {
            return "dompurify-vendor";
          }
          // dayjs 被 antd 与 mermaid 同时使用；不独立分块时会被并进 antd-vendor，
          // 导致 deferred 的 mermaid-vendor 静态 import 整包 Ant Design。
          if (id.includes("node_modules/dayjs/")) {
            return "dayjs-vendor";
          }
          if (
            id.includes("node_modules/mermaid/") ||
            id.includes("node_modules/@mermaid-js/")
          ) {
            return "mermaid-vendor";
          }
          if (id.includes("@antv/x6")) {
            return "x6-vendor";
          }
          if (
            id.includes("node_modules/antd/") ||
            /(?:^|\/)node_modules\/rc-[^/]+\//.test(moduleId) ||
            id.includes("node_modules/@rc-component/")
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
      // 3. 忽略 Rust 构建与高 churn 本地索引，避免 dev 时 HMR 风暴拖慢 WebView
      ignored: [
        "**/src-tauri/**",
        "**/.codegraph/**",
        "**/.git/**",
        "**/.history/**",
        "**/.trellis/workspace/**",
      ],
    },
  },
}));
