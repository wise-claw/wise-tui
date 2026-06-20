import type * as Monaco from "monaco-editor";
import { readProjectRelativeFile } from "./projectRelativeFiles";
import {
  loadRepositoryTypeScriptProfile,
  mapTsconfigCompilerOptionsToMonaco,
  registerRepositoryTypeScriptLibs,
} from "./monacoRepositoryTypeScriptConfig";
import { shouldSkipMonacoTypeScriptModelSync } from "../utils/monacoLargeFile";

type MonacoApi = typeof Monaco;
type MonacoCompilerOptionsValue =
  | string
  | number
  | boolean
  | (string | number)[]
  | string[]
  | Record<string, string[]>
  | null
  | undefined;

interface MonacoCompilerOptions {
  [option: string]: MonacoCompilerOptionsValue;
}

interface MonacoDiagnosticsOptions {
  noSemanticValidation?: boolean;
  noSyntaxValidation?: boolean;
  noSuggestionDiagnostics?: boolean;
  onlyVisible?: boolean;
  diagnosticCodesToIgnore?: number[];
}

interface MonacoLanguageDefaults {
  getCompilerOptions(): MonacoCompilerOptions;
  setCompilerOptions(options: MonacoCompilerOptions): void;
  getDiagnosticsOptions(): MonacoDiagnosticsOptions;
  setDiagnosticsOptions(options: MonacoDiagnosticsOptions): void;
  addExtraLib(content: string, filePath?: string): Monaco.IDisposable;
  setEagerModelSync(value: boolean): void;
}

interface MonacoTypeScriptRuntime {
  ScriptTarget: Record<string, number>;
  ModuleKind: Record<string, number>;
  ModuleResolutionKind: Record<string, number | undefined>;
  JsxEmit: Record<string, number>;
  typescriptDefaults: MonacoLanguageDefaults;
  javascriptDefaults: MonacoLanguageDefaults;
}

export interface MonacoRepositorySourceFile {
  /** 仓库内真实文件路径，用于继续解析依赖。 */
  relativePath: string;
  content: string;
  /** 与 import 语句一致的模型路径（例如 .js 导入映射到 .ts 源文件）。 */
  modelRelativePath?: string;
}

interface SyncMonacoTypeScriptModelsInput {
  monaco: MonacoApi;
  repositoryPath: string;
  sourceFiles: MonacoRepositorySourceFile[];
}

const TYPESCRIPT_LIKE_EXTENSIONS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);
const MODEL_SOURCE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "d.ts",
  "json",
]);
const RESOLVABLE_SOURCE_EXTENSIONS = Array.from(MODEL_SOURCE_EXTENSIONS).map((extension) => `.${extension}`);
const COMMON_AMBIENT_MODULES = ["react/jsx-runtime"];
const VITE_CLIENT_AMBIENT_TYPES = [
  "declare module '*.css';",
  "declare module '*.scss';",
  "declare module '*.sass';",
  "declare module '*.less';",
  "declare module '*.styl';",
  "declare module '*.stylus';",
  "declare module '*.pcss';",
  "declare module '*.sss';",
  "declare module '*.svg' { const src: string; export default src; }",
  "declare module '*.png' { const src: string; export default src; }",
  "declare module '*.jpg' { const src: string; export default src; }",
  "declare module '*.jpeg' { const src: string; export default src; }",
  "declare module '*.gif' { const src: string; export default src; }",
  "declare module '*.webp' { const src: string; export default src; }",
  "declare module '*?raw' { const src: string; export default src; }",
  "declare module '*?url' { const src: string; export default src; }",
].join("\n");
const MAX_DEPENDENCY_MODEL_COUNT = 80;
const MAX_DEPENDENCY_DEPTH = 3;
const CONFIGURED_MONACO_INSTANCES = new WeakSet<MonacoApi>();
const REGISTERED_AMBIENT_MODULES = new WeakMap<MonacoApi, Set<string>>();
const REGISTERED_REPOSITORY_EXTRA_LIBS = new WeakMap<
  MonacoApi,
  Map<string, { content: string; disposable: Monaco.IDisposable }>
>();
const DEPENDENCY_FILE_CONTENT_CACHE = new Map<string, string>();
const PENDING_DEPENDENCY_FILES = new Map<string, Promise<string | null>>();
const LAST_SYNC_SIGNATURE_BY_REPOSITORY = new WeakMap<MonacoApi, Map<string, string>>();
const APPLIED_REPOSITORY_TS_ENVIRONMENT = new WeakMap<MonacoApi, string>();

export function isTypeScriptLikeRepositoryPath(path: string): boolean {
  return TYPESCRIPT_LIKE_EXTENSIONS.has(getPathExtension(path));
}

export function monacoUriForRepositoryPath(relativePath: string, repositoryPath?: string | null): string {
  const normalized = normalizeRepositoryRelativePath(relativePath);
  const repositoryKey = repositoryPath ? stableHash(repositoryPath) : "current";
  const encoded = normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file:///wise-repositories/${repositoryKey}/${encoded}`;
}

export function configureWiseMonacoTypeScript(monaco: MonacoApi): void {
  if (CONFIGURED_MONACO_INSTANCES.has(monaco)) return;
  CONFIGURED_MONACO_INSTANCES.add(monaco);

  const ts = getMonacoTypeScriptRuntime(monaco);
  const compilerOptions: MonacoCompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: resolveMonacoBundlerModuleResolution(ts),
    jsx: ts.JsxEmit.ReactJSX,
    useDefineForClassFields: true,
    allowSyntheticDefaultImports: true,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true,
    resolvePackageJsonExports: true,
    resolvePackageJsonImports: true,
    allowNonTsExtensions: true,
  };

  applyWiseTypeScriptDefaults(ts.typescriptDefaults, compilerOptions);
  applyWiseTypeScriptDefaults(ts.javascriptDefaults, {
    ...compilerOptions,
    allowJs: true,
    checkJs: false,
  });
  ts.typescriptDefaults.addExtraLib(VITE_CLIENT_AMBIENT_TYPES, "file:///node_modules/vite/client.d.ts");
  registerAmbientModules(monaco, COMMON_AMBIENT_MODULES);
}

export async function ensureRepositoryTypeScriptEnvironment(
  monaco: MonacoApi,
  repositoryPath: string,
): Promise<void> {
  await applyRepositoryTypeScriptEnvironment(monaco, repositoryPath);
}

export async function syncMonacoRepositoryTypeScriptModels({
  monaco,
  repositoryPath,
  sourceFiles,
}: SyncMonacoTypeScriptModelsInput): Promise<void> {
  configureWiseMonacoTypeScript(monaco);
  await applyRepositoryTypeScriptEnvironment(monaco, repositoryPath);

  const normalizedSources = sourceFiles
    .filter((file) => isTypeScriptLikeRepositoryPath(file.relativePath))
    .map((file) => ({
      relativePath: normalizeRepositoryRelativePath(file.relativePath),
      content: file.content,
    }))
    .filter((file) => file.relativePath.length > 0);
  if (normalizedSources.length === 0) {
    return;
  }

  const syncSignature = normalizedSources
    .map((source) => `${source.relativePath}:${stableHash(source.content)}`)
    .sort()
    .join("|");
  let repositorySignatures = LAST_SYNC_SIGNATURE_BY_REPOSITORY.get(monaco);
  if (!repositorySignatures) {
    repositorySignatures = new Map();
    LAST_SYNC_SIGNATURE_BY_REPOSITORY.set(monaco, repositorySignatures);
  }
  if (repositorySignatures.get(repositoryPath) === syncSignature) {
    return;
  }

  if (normalizedSources.some((source) => shouldSkipMonacoTypeScriptModelSync(source.content.length))) {
    repositorySignatures.set(repositoryPath, syncSignature);
    return;
  }

  repositorySignatures.set(repositoryPath, syncSignature);

  for (const source of normalizedSources) {
    registerRepositorySource(monaco, repositoryPath, source);
  }

  const queue = normalizedSources.map((source) => ({ ...source, depth: 0 }));
  const visited = new Set(normalizedSources.map((source) => source.relativePath));
  let loadedCount = 0;

  while (queue.length > 0 && loadedCount < MAX_DEPENDENCY_MODEL_COUNT) {
    const current = queue.shift()!;
    const imports = extractMonacoTypeScriptModuleSpecifiers(current.content);
    registerAmbientModules(monaco, imports.filter((specifier) => !isRelativeModuleSpecifier(specifier)));

    if (current.depth >= MAX_DEPENDENCY_DEPTH) continue;

    for (const specifier of imports) {
      if (!isRelativeModuleSpecifier(specifier)) continue;
      const dependency = await readFirstExistingRelativeImport(repositoryPath, current.relativePath, specifier);
      if (!dependency || visited.has(dependency.relativePath)) continue;

      visited.add(dependency.relativePath);
      loadedCount += 1;
      const dependencySource = shouldSkipMonacoTypeScriptModelSync(dependency.content.length)
        ? {
            relativePath: dependency.relativePath,
            content: buildMonacoLargeModuleStub(dependency.relativePath),
            modelRelativePath: dependency.modelRelativePath,
          }
        : dependency;
      registerRepositorySource(monaco, repositoryPath, dependencySource);
      if (
        !shouldSkipMonacoTypeScriptModelSync(dependency.content.length) &&
        isTypeScriptLikeRepositoryPath(dependency.relativePath)
      ) {
        queue.push({ ...dependency, depth: current.depth + 1 });
      }
      if (loadedCount >= MAX_DEPENDENCY_MODEL_COUNT) break;
    }
  }
}

async function applyRepositoryTypeScriptEnvironment(
  monaco: MonacoApi,
  repositoryPath: string,
): Promise<void> {
  const signature = repositoryPath.trim();
  if (!signature) return;
  if (APPLIED_REPOSITORY_TS_ENVIRONMENT.get(monaco) === signature) {
    return;
  }

  const profile = await loadRepositoryTypeScriptProfile(signature);
  const ts = getMonacoTypeScriptRuntime(monaco);
  const mappedOptions = mapTsconfigCompilerOptionsToMonaco(profile.compilerOptions, ts);
  const compilerOptions: MonacoCompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: resolveMonacoBundlerModuleResolution(ts),
    jsx: ts.JsxEmit.ReactJSX,
    useDefineForClassFields: true,
    allowSyntheticDefaultImports: true,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true,
    resolvePackageJsonExports: true,
    resolvePackageJsonImports: true,
    allowNonTsExtensions: true,
    ...mappedOptions,
  };

  applyWiseTypeScriptDefaults(ts.typescriptDefaults, compilerOptions);
  applyWiseTypeScriptDefaults(ts.javascriptDefaults, {
    ...compilerOptions,
    allowJs: typeof compilerOptions.allowJs === "boolean" ? compilerOptions.allowJs : true,
    checkJs: typeof compilerOptions.checkJs === "boolean" ? compilerOptions.checkJs : false,
  });

  await registerRepositoryTypeScriptLibs(
    signature,
    profile.typePackages,
    (content, filePath) => ts.typescriptDefaults.addExtraLib(content, filePath),
    monaco,
  );
  APPLIED_REPOSITORY_TS_ENVIRONMENT.set(monaco, signature);
}

function applyWiseTypeScriptDefaults(
  defaults: MonacoLanguageDefaults,
  compilerOptions: MonacoCompilerOptions,
): void {
  defaults.setCompilerOptions({
    ...defaults.getCompilerOptions(),
    ...compilerOptions,
  });
  defaults.setDiagnosticsOptions({
    ...defaults.getDiagnosticsOptions(),
    noSyntaxValidation: false,
    noSemanticValidation: false,
    noSuggestionDiagnostics: false,
    // 仅诊断可见区：打开中等 .ts 文件（几 KB~128KB，依赖图最多 80 个 model）时，
    // 避免 ts.worker 全量编译整个依赖图造成的首次打开卡顿。语法诊断仍全量；
    // 语义诊断（类型错误）仅在滚动到可见时标红。本项目无问题面板消费全量诊断，
    // 故无功能损失。>128KB 文件本就跳过 model 同步，此处主要惠及中等文件。
    onlyVisible: true,
  });
  defaults.setEagerModelSync(true);
}

function resolveMonacoBundlerModuleResolution(
  ts: MonacoTypeScriptRuntime,
): number {
  const runtimeKinds = ts.ModuleResolutionKind;
  const bundler = runtimeKinds.Bundler;
  if (typeof bundler === "number") {
    return bundler;
  }
  // Monaco's public contribution enum may omit Bundler while the bundled
  // TypeScript worker still understands the real TypeScript numeric value.
  if (runtimeKinds.NodeNext === undefined) {
    return 100;
  }
  return ts.ModuleResolutionKind.NodeJs ?? 2;
}

function getMonacoTypeScriptRuntime(monaco: MonacoApi): MonacoTypeScriptRuntime {
  const topLevel = monaco as unknown as { typescript?: MonacoTypeScriptRuntime };
  if (topLevel.typescript) return topLevel.typescript;
  const legacy = monaco.languages as unknown as { typescript?: MonacoTypeScriptRuntime };
  if (legacy.typescript) return legacy.typescript;
  throw new Error("Monaco TypeScript runtime is not available");
}

function ensureMonacoModel(monaco: MonacoApi, repositoryPath: string, relativePath: string, content: string): void {
  const uri = monaco.Uri.parse(monacoUriForRepositoryPath(relativePath, repositoryPath));
  const existing = monaco.editor.getModel(uri);
  if (existing) {
    if (existing.getValue() !== content) {
      existing.setValue(content);
    }
    return;
  }
  monaco.editor.createModel(content, monacoLanguageForTypeScriptModel(relativePath), uri);
}

function registerRepositorySource(
  monaco: MonacoApi,
  repositoryPath: string,
  source: MonacoRepositorySourceFile,
): void {
  disposeRepositoryExtraLib(monaco, repositoryPath, source.relativePath);
  if (source.modelRelativePath && source.modelRelativePath !== source.relativePath) {
    disposeRepositoryExtraLib(monaco, repositoryPath, source.modelRelativePath);
  }

  const modelPaths = new Set<string>([source.relativePath]);
  if (source.modelRelativePath) {
    modelPaths.add(source.modelRelativePath);
  }
  for (const modelPath of modelPaths) {
    ensureMonacoModel(monaco, repositoryPath, modelPath, source.content);
  }
}

function disposeRepositoryExtraLib(monaco: MonacoApi, repositoryPath: string, relativePath: string): void {
  const registered = REGISTERED_REPOSITORY_EXTRA_LIBS.get(monaco);
  if (!registered) return;
  const filePath = monacoUriForRepositoryPath(relativePath, repositoryPath);
  registered.get(filePath)?.disposable.dispose();
  registered.delete(filePath);
}

export function resolveImportSpecifierToRelativePath(fromRelativePath: string, specifier: string): string {
  const fromDir = dirname(normalizeRepositoryRelativePath(fromRelativePath));
  return normalizeRepositoryRelativePath(`${fromDir}/${specifier}`);
}

function registerAmbientModules(monaco: MonacoApi, moduleSpecifiers: string[]): void {
  let registered = REGISTERED_AMBIENT_MODULES.get(monaco);
  if (!registered) {
    registered = new Set();
    REGISTERED_AMBIENT_MODULES.set(monaco, registered);
  }

  const newSpecifiers = Array.from(new Set(moduleSpecifiers))
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier.length > 0 && !registered.has(specifier));
  if (newSpecifiers.length === 0) return;

  for (const specifier of newSpecifiers) {
    registered.add(specifier);
  }

  getMonacoTypeScriptRuntime(monaco).typescriptDefaults.addExtraLib(
    newSpecifiers.map((specifier) => `declare module ${JSON.stringify(specifier)};`).join("\n"),
    `file:///node_modules/.wise-monaco-ambient-${registered.size}.d.ts`,
  );
}

export function extractMonacoTypeScriptModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const re =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? "";
    if (specifier.trim()) {
      specifiers.push(specifier.trim());
    }
  }
  return Array.from(new Set(specifiers));
}

/** 超大依赖只注册轻量 stub，避免 Monaco TS worker 拉全量文件后仍报「找不到模块」。 */
export function buildMonacoLargeModuleStub(_relativePath: string): string {
  return [
    "// Wise: type stub for large module (omitted from Monaco dependency graph)",
    "export default {} as import(\"react\").ComponentType<Record<string, unknown>>;",
  ].join("\n");
}

async function readFirstExistingRelativeImport(
  repositoryPath: string,
  fromRelativePath: string,
  specifier: string,
): Promise<MonacoRepositorySourceFile | null> {
  const importRelativePath = resolveImportSpecifierToRelativePath(fromRelativePath, specifier);
  const candidates = resolveMonacoRepositoryRelativeImportCandidates(fromRelativePath, specifier);
  for (const candidate of candidates) {
    const content = await readProjectFileIfExists(repositoryPath, candidate);
    if (content != null) {
      return {
        relativePath: candidate,
        content,
        modelRelativePath: importRelativePath !== candidate ? importRelativePath : undefined,
      };
    }
  }
  return null;
}

export function resolveMonacoRepositoryRelativeImportCandidates(fromRelativePath: string, specifier: string): string[] {
  const fromDir = dirname(normalizeRepositoryRelativePath(fromRelativePath));
  const rawTarget = normalizeRepositoryRelativePath(`${fromDir}/${specifier}`);
  const ext = getPathExtension(rawTarget);
  if (ext.length > 0) {
    const candidates = MODEL_SOURCE_EXTENSIONS.has(ext) ? [rawTarget] : [];
    if (["js", "mjs", "cjs"].includes(ext)) {
      const withoutExt = rawTarget.slice(0, -(ext.length + 1));
      candidates.push(
        ...["ts", "tsx", "mts", "cts", "d.ts"].map((sourceExt) => `${withoutExt}.${sourceExt}`),
      );
    }
    return Array.from(new Set(candidates));
  }

  const candidates = [
    ...RESOLVABLE_SOURCE_EXTENSIONS.map((extension) => `${rawTarget}${extension}`),
    ...RESOLVABLE_SOURCE_EXTENSIONS.map((extension) => `${rawTarget}/index${extension}`),
  ];
  return Array.from(new Set(candidates));
}

async function readProjectFileIfExists(repositoryPath: string, relativePath: string): Promise<string | null> {
  const normalized = normalizeRepositoryRelativePath(relativePath);
  const key = `${repositoryPath}\0${normalized}`;
  const cached = DEPENDENCY_FILE_CONTENT_CACHE.get(key);
  if (cached != null) {
    return cached;
  }

  let pending = PENDING_DEPENDENCY_FILES.get(key);
  if (!pending) {
    pending = readProjectRelativeFile(repositoryPath, normalized)
      .then((content) => {
        DEPENDENCY_FILE_CONTENT_CACHE.set(key, content);
        return content;
      })
      .catch(() => null)
      .finally(() => {
        PENDING_DEPENDENCY_FILES.delete(key);
      });
    PENDING_DEPENDENCY_FILES.set(key, pending);
  }
  return pending;
}

function isRelativeModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function monacoLanguageForTypeScriptModel(relativePath: string): string {
  const ext = getPathExtension(relativePath);
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "javascript";
  if (ext === "json") return "json";
  return "typescript";
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function getPathExtension(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? "";
  const i = fileName.lastIndexOf(".");
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : "";
}

function normalizeRepositoryRelativePath(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
