import { listProjectRelativeDirectory, readProjectRelativeFile } from "./projectRelativeFiles";

export interface ParsedTsconfigShape {
  compilerOptions?: Record<string, unknown>;
  extends?: string;
}

export interface RepositoryTypeScriptProfile {
  compilerOptions: Record<string, unknown>;
  typePackages: string[];
}

const TSCONFIG_CANDIDATES = ["tsconfig.json", "jsconfig.json"];
const MAX_NODE_TYPE_REFERENCE_FILES = 64;
const MAX_NODE_TYPE_FILE_BYTES = 512 * 1024;
const CONFIGURED_REPOSITORY_PROFILES = new Map<string, RepositoryTypeScriptProfile>();
const REGISTERED_REPOSITORY_TYPE_LIBS = new Map<
  string,
  { disposables: Array<{ dispose: () => void }> }
>();
const ACTIVE_REPOSITORY_TYPE_LIBS = new WeakMap<
  object,
  { repositoryPath: string; disposables: Array<{ dispose: () => void }> }
>();

export function stripJsonLikeComments(source: string): string {
  let out = "";
  let i = 0;
  let inString: '"' | "'" | null = null;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1] ?? "";
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length) {
        if (source[i] === "*" && source[i + 1] === "/") {
          i += 2;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function parseRepositoryTsconfigJson(source: string): ParsedTsconfigShape {
  const trimmed = source.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(stripJsonLikeComments(trimmed)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as ParsedTsconfigShape;
  } catch {
    return {};
  }
}

export async function loadRepositoryTypeScriptProfile(
  repositoryPath: string,
): Promise<RepositoryTypeScriptProfile> {
  const cached = CONFIGURED_REPOSITORY_PROFILES.get(repositoryPath);
  if (cached) return cached;

  const profile: RepositoryTypeScriptProfile = {
    compilerOptions: {},
    typePackages: [],
  };

  for (const candidate of TSCONFIG_CANDIDATES) {
    try {
      const raw = await readProjectRelativeFile(repositoryPath, candidate);
      const parsed = parseRepositoryTsconfigJson(raw);
      if (parsed.compilerOptions && typeof parsed.compilerOptions === "object") {
        profile.compilerOptions = parsed.compilerOptions;
      }
      const types = parsed.compilerOptions?.types;
      if (Array.isArray(types)) {
        profile.typePackages = types.filter((item): item is string => typeof item === "string");
      }
      break;
    } catch {
      // try next candidate
    }
  }

  if (profile.typePackages.length === 0) {
    profile.typePackages = await inferRepositoryTypePackages(repositoryPath);
  }

  CONFIGURED_REPOSITORY_PROFILES.set(repositoryPath, profile);
  return profile;
}

export function clearRepositoryTypeScriptProfileCache(repositoryPath?: string): void {
  if (repositoryPath) {
    CONFIGURED_REPOSITORY_PROFILES.delete(repositoryPath);
    return;
  }
  CONFIGURED_REPOSITORY_PROFILES.clear();
}

export function mapTsconfigCompilerOptionsToMonaco(
  tsconfigOptions: Record<string, unknown>,
  runtime: {
    ScriptTarget: Record<string, number>;
    ModuleKind: Record<string, number>;
    ModuleResolutionKind: Record<string, number | undefined>;
    JsxEmit: Record<string, number>;
  },
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  const target = mapEnumOption(tsconfigOptions.target, runtime.ScriptTarget);
  if (target != null) mapped.target = target;

  const module = mapEnumOption(tsconfigOptions.module, runtime.ModuleKind);
  if (module != null) mapped.module = module;

  const moduleResolution = mapModuleResolution(tsconfigOptions.moduleResolution, runtime.ModuleResolutionKind);
  if (moduleResolution != null) mapped.moduleResolution = moduleResolution;

  const jsx = mapEnumOption(tsconfigOptions.jsx, runtime.JsxEmit);
  if (jsx != null) mapped.jsx = jsx;

  for (const key of [
    "strict",
    "skipLibCheck",
    "resolveJsonModule",
    "allowJs",
    "checkJs",
    "esModuleInterop",
    "allowSyntheticDefaultImports",
    "useDefineForClassFields",
    "isolatedModules",
    "noEmit",
    "allowImportingTsExtensions",
    "resolvePackageJsonExports",
    "resolvePackageJsonImports",
    "noUnusedLocals",
    "noUnusedParameters",
    "noFallthroughCasesInSwitch",
    "forceConsistentCasingInFileNames",
  ] as const) {
    if (typeof tsconfigOptions[key] === "boolean") {
      mapped[key] = tsconfigOptions[key];
    }
  }

  if (typeof tsconfigOptions.baseUrl === "string" && tsconfigOptions.baseUrl.trim()) {
    mapped.baseUrl = tsconfigOptions.baseUrl;
  }
  if (tsconfigOptions.paths && typeof tsconfigOptions.paths === "object" && !Array.isArray(tsconfigOptions.paths)) {
    mapped.paths = tsconfigOptions.paths;
  }

  return mapped;
}

export async function registerRepositoryTypeScriptLibs(
  repositoryPath: string,
  typePackages: string[],
  addExtraLib: (content: string, filePath: string) => { dispose: () => void },
  owner?: object,
): Promise<void> {
  if (owner) {
    const active = ACTIVE_REPOSITORY_TYPE_LIBS.get(owner);
    if (active && active.repositoryPath !== repositoryPath) {
      for (const disposable of active.disposables) {
        disposable.dispose();
      }
      ACTIVE_REPOSITORY_TYPE_LIBS.delete(owner);
    }
  }

  const previous = REGISTERED_REPOSITORY_TYPE_LIBS.get(repositoryPath);
  if (previous) {
    for (const disposable of previous.disposables) {
      disposable.dispose();
    }
  }

  const disposables: Array<{ dispose: () => void }> = [];
  const packages = typePackages.length > 0 ? typePackages : ["node"];

  for (const packageName of packages) {
    const files = await loadTypePackageDeclarationFiles(repositoryPath, packageName);
    for (const file of files) {
      disposables.push(
        addExtraLib(file.content, `file:///node_modules/@types/${packageName}/${file.relativePath}`),
      );
    }
  }

  REGISTERED_REPOSITORY_TYPE_LIBS.set(repositoryPath, { disposables });
  if (owner) {
    ACTIVE_REPOSITORY_TYPE_LIBS.set(owner, { repositoryPath, disposables });
  }
}

function mapEnumOption(value: unknown, enumObject: Record<string, number>): number | undefined {
  if (typeof value !== "string") return undefined;
  const direct = enumObject[value];
  if (typeof direct === "number") return direct;
  const lower = value.toLowerCase();
  for (const [key, numeric] of Object.entries(enumObject)) {
    if (key.toLowerCase() === lower) return numeric;
  }
  return undefined;
}

function mapModuleResolution(
  value: unknown,
  kinds: Record<string, number | undefined>,
): number | undefined {
  if (typeof value !== "string") return undefined;
  const direct = mapEnumOption(value, kinds as Record<string, number>);
  if (direct != null) return direct;
  const normalized = value.toLowerCase();
  if (normalized === "nodenext") return kinds.NodeNext ?? 100;
  if (normalized === "node16") return kinds.Node16 ?? 100;
  if (normalized === "node" || normalized === "node10") return kinds.NodeJs ?? 2;
  if (normalized === "bundler") return kinds.Bundler ?? 100;
  return undefined;
}

async function inferRepositoryTypePackages(repositoryPath: string): Promise<string[]> {
  const packages = new Set<string>();
  try {
    const packageJsonRaw = await readProjectRelativeFile(repositoryPath, "package.json");
    const packageJson = JSON.parse(packageJsonRaw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const merged = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    for (const name of Object.keys(merged)) {
      if (name.startsWith("@types/")) {
        packages.add(name.slice("@types/".length));
      }
    }
  } catch {
    // ignore
  }

  if (packages.size === 0) {
    try {
      await readProjectRelativeFile(repositoryPath, "node_modules/@types/node/index.d.ts");
      packages.add("node");
    } catch {
      // ignore
    }
  }

  return Array.from(packages);
}

interface TypeDeclarationFile {
  relativePath: string;
  content: string;
}

async function loadTypePackageDeclarationFiles(
  repositoryPath: string,
  packageName: string,
): Promise<TypeDeclarationFile[]> {
  const baseDir = `node_modules/@types/${packageName}`;
  let entryPath = `${baseDir}/index.d.ts`;
  try {
    await readProjectRelativeFile(repositoryPath, entryPath);
  } catch {
    entryPath = `${baseDir}/index.d.cts`;
    try {
      await readProjectRelativeFile(repositoryPath, entryPath);
    } catch {
      return [];
    }
  }

  const files = new Map<string, string>();
  const queue = [entryPath.slice(baseDir.length + 1)];
  while (queue.length > 0 && files.size < MAX_NODE_TYPE_REFERENCE_FILES) {
    const relativePath = queue.shift()!;
    if (files.has(relativePath)) continue;
    const absoluteRelative = `${baseDir}/${relativePath}`;
    let content: string;
    try {
      content = await readProjectRelativeFile(repositoryPath, absoluteRelative);
    } catch {
      continue;
    }
    if (content.length > MAX_NODE_TYPE_FILE_BYTES) continue;
    files.set(relativePath, content);
    for (const reference of extractTypeScriptReferencePaths(content)) {
      const resolved = resolveTypeReferencePath(relativePath, reference);
      if (resolved && !files.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return Array.from(files.entries()).map(([relativePath, content]) => ({ relativePath, content }));
}

export function extractTypeScriptReferencePaths(source: string): string[] {
  const paths: string[] = [];
  const re = /\/\/\/\s*<reference\s+path\s*=\s*["']([^"']+)["']\s*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const value = match[1]?.trim();
    if (value) paths.push(value);
  }
  return paths;
}

function resolveTypeReferencePath(fromRelativePath: string, referencePath: string): string | null {
  const normalizedReference = referencePath.replace(/\\/g, "/");
  if (!normalizedReference || normalizedReference.startsWith("..")) {
    return null;
  }
  const fromDir = dirname(fromRelativePath);
  const joined = normalizePosixPath(fromDir ? `${fromDir}/${normalizedReference}` : normalizedReference);
  return joined.endsWith(".d.ts") || joined.endsWith(".d.cts") ? joined : null;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function normalizePosixPath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

export async function listRepositoryTypePackageFiles(
  repositoryPath: string,
  packageName: string,
): Promise<string[]> {
  try {
    const names = await listProjectRelativeDirectory(
      repositoryPath,
      `node_modules/@types/${packageName}`,
    );
    return names.filter((name) => name.endsWith(".d.ts") || name.endsWith(".d.cts"));
  } catch {
    return [];
  }
}
