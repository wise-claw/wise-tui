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
  /(?:^|\/)assets\/(?:composer-region|markdown-vendor|tiptap-vendor|codemirror-vendor|monaco-vendor|terminal-vendor|graph-vendor|mermaid-vendor|AuthorPanel|x6-vendor)/;

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
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => !DEFERRED_MODULE_PRELOAD_CHUNK.test(dep.replace(/\\/g, "/"))),
    },
    /** 已知 vendor（mermaid / antd / codemirror）体积大；避免构建日志被无行动意义的告警淹没。 */
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        mascot: resolve(root, "mascot.html"),
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
          if (id.includes("node_modules/mermaid") || id.includes("/mermaid/")) {
            return "mermaid-vendor";
          }
          if (id.includes("@antv/x6")) {
            return "x6-vendor";
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
