var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
var root = fileURLToPath(new URL(".", import.meta.url));
/** 仅按需打开的功能块，不应出现在 index 入口的 modulepreload 里。 */
var DEFERRED_MODULE_PRELOAD_CHUNK = /(?:^|\/)assets\/(?:composer-region|milkdown-vendor|codemirror-vendor|monaco-vendor|terminal-vendor|graph-vendor|mermaid-vendor|AuthorPanel|x6-vendor|driver-vendor)/;
var host = process.env.TAURI_DEV_HOST;
// https://vite.dev/config/
export default defineConfig(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        return [2 /*return*/, ({
                assetsInclude: ["**/*.wasm"],
                plugins: [react()],
                resolve: {
                    /** 避免多份 React 进入不同 chunk，引发 `useLayoutEffect` of undefined。 */
                    dedupe: ["react", "react-dom"],
                },
                optimizeDeps: {
                    include: [
                        "driver.js",
                    ],
                },
                build: {
                    modulePreload: {
                        resolveDependencies: function (_filename, deps) {
                            return deps.filter(function (dep) { return !DEFERRED_MODULE_PRELOAD_CHUNK.test(dep.replace(/\\/g, "/")); });
                        },
                    },
                    /** 已知 vendor（mermaid / antd / codemirror）体积大；避免构建日志被无行动意义的告警淹没。 */
                    chunkSizeWarningLimit: 700,
                    rollupOptions: {
                        input: {
                            main: resolve(root, "index.html"),
                            mascot: resolve(root, "mascot.html"),
                        },
                        output: {
                            manualChunks: function (id) {
                                if (!id.includes("node_modules")) {
                                    return undefined;
                                }
                                if (id.includes("@tauri-apps")) {
                                    return "tauri-vendor";
                                }
                                if (id.includes("node_modules/graphology") ||
                                    id.includes("node_modules/sigma/") ||
                                    id.includes("@sigma/")) {
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
                                if (id.includes("node_modules/mermaid") || id.includes("/mermaid/")) {
                                    return "mermaid-vendor";
                                }
                                if (id.includes("@antv/x6")) {
                                    return "x6-vendor";
                                }
                                if (id.includes("ghostty-web") || id.includes("/ghostty-web/")) {
                                    return "terminal-vendor";
                                }
                                if (id.includes("node_modules/antd/") ||
                                    id.includes("/rc-") ||
                                    id.includes("/@rc-component/")) {
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
                            host: host,
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
            })];
    });
}); });
