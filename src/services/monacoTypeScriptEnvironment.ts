import type * as Monaco from "monaco-editor";
import { readProjectRelativeFile } from "./materializePrdSnapshot";

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
  relativePath: string;
  content: string;
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

export async function syncMonacoRepositoryTypeScriptModels({
  monaco,
  repositoryPath,
  sourceFiles,
}: SyncMonacoTypeScriptModelsInput): Promise<void> {
  configureWiseMonacoTypeScript(monaco);

  const normalizedSources = sourceFiles
    .filter((file) => isTypeScriptLikeRepositoryPath(file.relativePath))
    .map((file) => ({
      relativePath: normalizeRepositoryRelativePath(file.relativePath),
      content: file.content,
    }))
    .filter((file) => file.relativePath.length > 0);

  for (const source of normalizedSources) {
    registerRepositorySource(monaco, repositoryPath, source, true);
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
      registerRepositorySource(monaco, repositoryPath, dependency, false);
      if (isTypeScriptLikeRepositoryPath(dependency.relativePath)) {
        queue.push({ ...dependency, depth: current.depth + 1 });
      }
      if (loadedCount >= MAX_DEPENDENCY_MODEL_COUNT) break;
    }
  }
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
  openInEditor: boolean,
): void {
  if (openInEditor || !isExtraLibSupportedRepositoryPath(source.relativePath)) {
    disposeRepositoryExtraLib(monaco, repositoryPath, source.relativePath);
    ensureMonacoModel(monaco, repositoryPath, source.relativePath, source.content);
    return;
  }

  const filePath = monacoUriForRepositoryPath(source.relativePath, repositoryPath);
  let registered = REGISTERED_REPOSITORY_EXTRA_LIBS.get(monaco);
  if (!registered) {
    registered = new Map();
    REGISTERED_REPOSITORY_EXTRA_LIBS.set(monaco, registered);
  }
  const existing = registered.get(filePath);
  if (existing?.content === source.content) {
    return;
  }
  existing?.disposable.dispose();
  const ts = getMonacoTypeScriptRuntime(monaco);
  registered.set(filePath, {
    content: source.content,
    disposable: ts.typescriptDefaults.addExtraLib(source.content, filePath),
  });
}

function disposeRepositoryExtraLib(monaco: MonacoApi, repositoryPath: string, relativePath: string): void {
  const registered = REGISTERED_REPOSITORY_EXTRA_LIBS.get(monaco);
  if (!registered) return;
  const filePath = monacoUriForRepositoryPath(relativePath, repositoryPath);
  registered.get(filePath)?.disposable.dispose();
  registered.delete(filePath);
}

function isExtraLibSupportedRepositoryPath(relativePath: string): boolean {
  return isTypeScriptLikeRepositoryPath(relativePath);
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

async function readFirstExistingRelativeImport(
  repositoryPath: string,
  fromRelativePath: string,
  specifier: string,
): Promise<MonacoRepositorySourceFile | null> {
  const candidates = resolveMonacoRepositoryRelativeImportCandidates(fromRelativePath, specifier);
  for (const candidate of candidates) {
    const content = await readProjectFileIfExists(repositoryPath, candidate);
    if (content != null) {
      return { relativePath: candidate, content };
    }
  }
  return null;
}

export function resolveMonacoRepositoryRelativeImportCandidates(fromRelativePath: string, specifier: string): string[] {
  const fromDir = dirname(normalizeRepositoryRelativePath(fromRelativePath));
  const rawTarget = normalizeRepositoryRelativePath(`${fromDir}/${specifier}`);
  const ext = getPathExtension(rawTarget);
  if (ext.length > 0) {
    return MODEL_SOURCE_EXTENSIONS.has(ext) ? [rawTarget] : [];
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
