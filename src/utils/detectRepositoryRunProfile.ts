export type RepositoryRunProfileKind =
  | "intellij-spring-boot"
  | "maven-spring-boot"
  | "gradle-spring-boot"
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun";

export type RepositoryRunProfileStack = "java" | "node";

export type RepositoryRunProfile = {
  kind: RepositoryRunProfileKind;
  stack: RepositoryRunProfileStack;
  label: string;
  runCommand: string;
  debugCommand: string | null;
  defaultUrl: string | null;
  activeProfiles: string | null;
  mainClass: string | null;
  modulePath: string | null;
  scanRoot?: string | null;
  source: string;
};

export type RepositoryRunProfileFileBundle = {
  intellijRunConfigurationXml?: string | null;
  rootPomXml?: string | null;
  modulePomXmlByPath?: Record<string, string | null>;
  buildGradle?: string | null;
  buildGradleKts?: string | null;
  packageJson?: string | null;
  viteConfig?: string | null;
  nextConfig?: string | null;
  envFile?: string | null;
  applicationYaml?: string | null;
  applicationYml?: string | null;
  applicationProperties?: string | null;
  applicationProfileConfigs?: Record<string, string | null>;
  hasMvnw?: boolean;
  hasGradlew?: boolean;
  hasBunLock?: boolean;
  hasPnpmLock?: boolean;
  hasYarnLock?: boolean;
  hasPackageLock?: boolean;
};

const DEFAULT_SPRING_BOOT_PORT = 8080;
const DEFAULT_VITE_PORT = 5173;
const DEFAULT_NEXT_PORT = 3000;
const JDWP_DEBUG_PORT = 5005;
const NODE_INSPECT_PORT = 9229;

const NODE_SCRIPT_PRIORITY = ["dev", "start:dev", "serve", "preview", "start"] as const;

export function getRunProfileStack(kind: RepositoryRunProfileKind): RepositoryRunProfileStack {
  if (kind === "npm" || kind === "pnpm" || kind === "yarn" || kind === "bun") return "node";
  return "java";
}

function readXmlOptionValue(xml: string, optionName: string): string | null {
  const pattern = new RegExp(
    `<option\\s+name="${optionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s+value="([^"]*)"`,
    "i",
  );
  return xml.match(pattern)?.[1]?.trim() || null;
}

function readIdeaModuleName(xml: string): string | null {
  const moduleTag = xml.match(/<module\s+name="([^"]+)"/i)?.[1]?.trim();
  if (moduleTag) {
    return moduleTag.replace(/\.main$/i, "");
  }
  return readXmlOptionValue(xml, "MODULE_NAME");
}

export function parseIntellijSpringBootRunConfiguration(
  xml: string,
  source = ".idea/runConfigurations",
): RepositoryRunProfile | null {
  if (!/SpringBootApplicationConfigurationType/i.test(xml)) return null;
  const mainClass =
    readXmlOptionValue(xml, "SPRING_BOOT_MAIN_CLASS") ??
    readXmlOptionValue(xml, "MAIN_CLASS_NAME");
  if (!mainClass) return null;
  const activeProfiles = readXmlOptionValue(xml, "ACTIVE_PROFILES");
  const modulePath = readIdeaModuleName(xml);
  const configName = xml.match(/<configuration[^>]*name="([^"]+)"/i)?.[1]?.trim() ?? mainClass;
  return buildJavaSpringBootProfile({
    kind: "intellij-spring-boot",
    label: `Spring Boot · ${configName}`,
    source,
    hasMvnw: true,
    hasGradlew: false,
    modulePath,
    mainClass,
    activeProfiles,
    applicationYaml: null,
    applicationYml: null,
    applicationProperties: null,
    applicationProfileConfigs: {},
  });
}

type MavenSpringBootModule = {
  modulePath: string | null;
  mainClass: string | null;
  artifactId: string | null;
  score: number;
};

function readXmlTagText(xml: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}[^>]*>([^<]+)</${tagName}>`, "i");
  return xml.match(pattern)?.[1]?.trim() || null;
}

function readMavenModules(pomXml: string): string[] {
  const block = pomXml.match(/<modules>([\s\S]*?)<\/modules>/i)?.[1];
  if (!block) return [];
  return [...block.matchAll(/<module>([^<]+)<\/module>/gi)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function moduleIdentity(modulePath: string | null, artifactId: string | null): string {
  return `${modulePath ?? ""} ${artifactId ?? ""}`.toLowerCase();
}

function scoreMavenSpringBootModule(module: Omit<MavenSpringBootModule, "score">): number {
  const name = moduleIdentity(module.modulePath, module.artifactId);
  let score = 0;
  if (module.mainClass) score += 120;
  if (/spring-boot-maven-plugin/i.test(name)) score += 0;
  if (/(?:^|\s|\/)(?:.*server|.*admin|.*gateway|.*bootstrap)(?:$|\s|\/)/.test(name)) score += 80;
  if (/(?:^|\s|\/)(?:.*application|.*boot|.*app)(?:$|\s|\/)/.test(name)) score += 35;
  if (/(?:module-|[-_/])(?:api|client|common|core|framework|starter|biz|infra|ai|job|mq|rpc)/.test(name)) {
    score -= 70;
  }
  return score;
}

function isRunnableSpringBootMavenModule(pomXml: string, modulePath: string | null, artifactId: string | null): boolean {
  const hasPlugin = /spring-boot-maven-plugin/i.test(pomXml);
  const pluginBlock = pomXml.match(
    /<plugin>\s*[\s\S]*?<artifactId>\s*spring-boot-maven-plugin\s*<\/artifactId>[\s\S]*?<\/plugin>/i,
  )?.[0];
  const mainClassFromTag =
    pluginBlock?.match(/<mainClass>\s*([^<]+)\s*<\/mainClass>/i)?.[1]?.trim() ??
    readXmlTagText(pomXml, "start-class");
  if (hasPlugin || mainClassFromTag) return true;

  const name = moduleIdentity(modulePath, artifactId);
  const hasWebStarter = /spring-boot-starter-web/i.test(pomXml);
  const serverLike = /server|admin|gateway|bootstrap/.test(name);
  return serverLike && hasWebStarter;
}

function parseMavenSpringBootModulePom(pomXml: string, modulePath: string | null): MavenSpringBootModule | null {
  const artifactId = readXmlTagText(pomXml, "artifactId");
  if (!isRunnableSpringBootMavenModule(pomXml, modulePath, artifactId)) return null;

  const pluginBlock = pomXml.match(
    /<plugin>\s*[\s\S]*?<artifactId>\s*spring-boot-maven-plugin\s*<\/artifactId>[\s\S]*?<\/plugin>/i,
  )?.[0];
  const mainClassFromTag =
    pluginBlock?.match(/<mainClass>\s*([^<]+)\s*<\/mainClass>/i)?.[1]?.trim() ?? null;
  const mainClass =
    mainClassFromTag ??
    (pluginBlock && readXmlOptionValue(pluginBlock, "mainClass")) ??
    readXmlTagText(pomXml, "start-class");

  const base = { modulePath, mainClass, artifactId };
  return { ...base, score: scoreMavenSpringBootModule(base) };
}

export function parseMavenSpringBootFromPoms(
  rootPomXml: string,
  modulePomXmlByPath: Record<string, string | null> = {},
): MavenSpringBootModule | null {
  const candidates: MavenSpringBootModule[] = [];

  const rootModule = parseMavenSpringBootModulePom(rootPomXml, null);
  if (rootModule) candidates.push(rootModule);

  for (const modulePath of readMavenModules(rootPomXml)) {
    const pomXml = modulePomXmlByPath[modulePath];
    if (!pomXml) continue;
    const parsed = parseMavenSpringBootModulePom(pomXml, modulePath);
    if (parsed) candidates.push(parsed);
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score || (a.modulePath ?? "").localeCompare(b.modulePath ?? ""));
  return candidates[0] ?? null;
}

function buildMavenSpringBootRunCommand(input: {
  hasMvnw: boolean;
  modulePath: string | null;
  activeProfiles: string | null;
  mainClass: string | null;
  debug?: boolean;
}): string {
  const mvn = input.hasMvnw ? "./mvnw" : "mvn";
  const parts = [mvn];
  if (input.modulePath) {
    parts.push("-pl", input.modulePath, "-am");
  }
  parts.push("spring-boot:run");
  if (input.debug) {
    const jvmArgs = `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:${JDWP_DEBUG_PORT}`;
    parts.push(`-Dspring-boot.run.jvmArguments="${jvmArgs}"`);
  }
  if (input.mainClass) {
    parts.push(`-Dspring-boot.run.mainClass=${input.mainClass}`);
  }
  if (input.activeProfiles) {
    parts.push(`-Dspring-boot.run.profiles=${input.activeProfiles}`);
  }
  return parts.join(" ");
}

function buildGradleSpringBootRunCommand(input: {
  hasGradlew: boolean;
  debug?: boolean;
}): string {
  const gradle = input.hasGradlew ? "./gradlew" : "gradle";
  return input.debug ? `${gradle} bootRun --debug-jvm` : `${gradle} bootRun`;
}

export function parseSpringActiveProfile(content: string): string | null {
  if (!content.trim()) return null;
  const propertiesMatch = content.match(/(?:^|\n)\s*spring\.profiles\.active\s*=\s*([^\n#]+)/im);
  if (propertiesMatch?.[1]) {
    return propertiesMatch[1].split(",")[0]?.trim() || null;
  }
  const yamlMatch = content.match(
    /(?:^|\n)\s*spring:\s*\n(?:[^\n]*\n)*?\s*profiles:\s*\n(?:[^\n]*\n)*?\s*active:\s*([^\n#]+)/im,
  );
  if (yamlMatch?.[1]) {
    return yamlMatch[1].split(",")[0]?.trim().replace(/['"]/g, "") || null;
  }
  return null;
}

export function parseApplicationServerPort(content: string): number | null {
  if (!content.trim()) return null;
  const propertiesMatch = content.match(/(?:^|\n)\s*server\.port\s*=\s*(\d{2,5})/im);
  if (propertiesMatch?.[1]) return Number(propertiesMatch[1]);
  const yamlMatch = content.match(/(?:^|\n)\s*server:\s*\n(?:[^\n]*\n)*?\s*port:\s*(\d{2,5})/im);
  if (yamlMatch?.[1]) return Number(yamlMatch[1]);
  const inlineYamlMatch = content.match(/(?:^|\n)\s*server:\s*\n[^\n]*\n\s*port:\s*(\d{2,5})/im);
  if (inlineYamlMatch?.[1]) return Number(inlineYamlMatch[1]);
  return null;
}

export function resolveSpringBootPort(input: {
  activeProfiles: string | null;
  applicationYaml?: string | null;
  applicationYml?: string | null;
  applicationProperties?: string | null;
  applicationProfileConfigs?: Record<string, string | null>;
}): number | null {
  const profile =
    input.activeProfiles?.split(",")[0]?.trim() ||
    parseSpringActiveProfile(input.applicationYml ?? "") ||
    parseSpringActiveProfile(input.applicationYaml ?? "") ||
    parseSpringActiveProfile(input.applicationProperties ?? "");

  if (profile && input.applicationProfileConfigs) {
    const profileConfig = input.applicationProfileConfigs[profile];
    const profilePort = parseApplicationServerPort(profileConfig ?? "");
    if (profilePort) return profilePort;
  }

  return (
    parseApplicationServerPort(input.applicationYaml ?? "") ??
    parseApplicationServerPort(input.applicationYml ?? "") ??
    parseApplicationServerPort(input.applicationProperties ?? "")
  );
}

function buildJavaSpringBootProfile(input: {
  kind: Extract<RepositoryRunProfileKind, "intellij-spring-boot" | "maven-spring-boot" | "gradle-spring-boot">;
  label: string;
  source: string;
  hasMvnw: boolean;
  hasGradlew: boolean;
  modulePath: string | null;
  mainClass: string | null;
  activeProfiles: string | null;
  applicationYaml: string | null;
  applicationYml: string | null;
  applicationProperties: string | null;
  applicationProfileConfigs: Record<string, string | null>;
}): RepositoryRunProfile {
  const activeProfiles =
    input.activeProfiles ??
    parseSpringActiveProfile(input.applicationYml ?? "") ??
    parseSpringActiveProfile(input.applicationYaml ?? "") ??
    parseSpringActiveProfile(input.applicationProperties ?? "");

  const port = resolveSpringBootPort({
    activeProfiles,
    applicationYaml: input.applicationYaml,
    applicationYml: input.applicationYml,
    applicationProperties: input.applicationProperties,
    applicationProfileConfigs: input.applicationProfileConfigs,
  });

  const runCommand =
    input.kind === "gradle-spring-boot"
      ? buildGradleSpringBootRunCommand({ hasGradlew: input.hasGradlew })
      : buildMavenSpringBootRunCommand({
          hasMvnw: input.hasMvnw,
          modulePath: input.modulePath,
          activeProfiles,
          mainClass: input.mainClass,
        });

  const debugCommand =
    input.kind === "gradle-spring-boot"
      ? buildGradleSpringBootRunCommand({ hasGradlew: input.hasGradlew, debug: true })
      : buildMavenSpringBootRunCommand({
          hasMvnw: input.hasMvnw,
          modulePath: input.modulePath,
          activeProfiles,
          mainClass: input.mainClass,
          debug: true,
        });

  return {
    kind: input.kind,
    stack: "java",
    label: input.label,
    runCommand,
    debugCommand,
    defaultUrl: port ? `http://localhost:${port}` : `http://localhost:${DEFAULT_SPRING_BOOT_PORT}`,
    activeProfiles,
    mainClass: input.mainClass,
    modulePath: input.modulePath,
    source: input.source,
  };
}

export function buildMavenSpringBootProfile(
  module: Pick<MavenSpringBootModule, "modulePath" | "mainClass" | "artifactId">,
  bundle: Pick<
    RepositoryRunProfileFileBundle,
    | "hasMvnw"
    | "applicationYaml"
    | "applicationYml"
    | "applicationProperties"
    | "applicationProfileConfigs"
  >,
  source: string,
): RepositoryRunProfile {
  const labelSuffix = module.mainClass?.split(".").pop() ?? module.artifactId ?? module.modulePath ?? "Spring Boot";
  return buildJavaSpringBootProfile({
    kind: "maven-spring-boot",
    label: `Maven Spring Boot · ${labelSuffix}`,
    source,
    hasMvnw: bundle.hasMvnw ?? false,
    hasGradlew: false,
    modulePath: module.modulePath,
    mainClass: module.mainClass,
    activeProfiles: null,
    applicationYaml: bundle.applicationYaml ?? null,
    applicationYml: bundle.applicationYml ?? null,
    applicationProperties: bundle.applicationProperties ?? null,
    applicationProfileConfigs: bundle.applicationProfileConfigs ?? {},
  });
}

export function parseGradleSpringBoot(
  content: string,
  bundle: Pick<
    RepositoryRunProfileFileBundle,
    | "hasGradlew"
    | "applicationYaml"
    | "applicationYml"
    | "applicationProperties"
    | "applicationProfileConfigs"
  >,
  source: string,
): RepositoryRunProfile | null {
  const hasBootPlugin =
    /id\s*\(?["']org\.springframework\.boot["']\)?/i.test(content) ||
    /org\.springframework\.boot/i.test(content);
  if (!hasBootPlugin) return null;
  return buildJavaSpringBootProfile({
    kind: "gradle-spring-boot",
    label: "Gradle Spring Boot",
    source,
    hasMvnw: false,
    hasGradlew: bundle.hasGradlew ?? false,
    modulePath: null,
    mainClass: null,
    activeProfiles: null,
    applicationYaml: bundle.applicationYaml ?? null,
    applicationYml: bundle.applicationYml ?? null,
    applicationProperties: bundle.applicationProperties ?? null,
    applicationProfileConfigs: bundle.applicationProfileConfigs ?? {},
  });
}

export type NodePackageManager = "bun" | "pnpm" | "yarn" | "npm";

export function resolveNodePackageManager(
  packageJson: string,
  bundle: Pick<
    RepositoryRunProfileFileBundle,
    "hasBunLock" | "hasPnpmLock" | "hasYarnLock" | "hasPackageLock"
  >,
): NodePackageManager {
  let parsed: { packageManager?: string } = {};
  try {
    parsed = JSON.parse(packageJson) as { packageManager?: string };
  } catch {
    /* ignore */
  }
  if (bundle.hasBunLock || parsed.packageManager?.startsWith("bun@") || parsed.packageManager?.startsWith("bun/")) {
    return "bun";
  }
  if (bundle.hasPnpmLock || parsed.packageManager?.startsWith("pnpm@") || parsed.packageManager?.startsWith("pnpm/")) {
    return "pnpm";
  }
  if (bundle.hasYarnLock || parsed.packageManager?.startsWith("yarn@") || parsed.packageManager?.startsWith("yarn/")) {
    return "yarn";
  }
  return "npm";
}

export function pickNodeScript(scripts: Record<string, string> | undefined): string | null {
  if (!scripts) return null;
  for (const name of NODE_SCRIPT_PRIORITY) {
    if (scripts[name]?.trim()) return name;
  }
  return null;
}

export function parseViteConfigPort(content: string): number | null {
  const serverPort = content.match(/server:\s*\{[\s\S]*?\bport:\s*(\d{2,5})/i)?.[1];
  if (serverPort) return Number(serverPort);
  const rootPort = content.match(/(?:^|\n)\s*port:\s*(\d{2,5})/m)?.[1];
  if (rootPort) return Number(rootPort);
  return null;
}

export function parseNextDefaultPort(content: string): number | null {
  const envPort = content.match(/process\.env\.PORT\s*\?\?\s*(\d{2,5})/)?.[1];
  if (envPort) return Number(envPort);
  return null;
}

export function parseEnvFilePort(content: string): number | null {
  const portMatch = content.match(/(?:^|\n)\s*PORT\s*=\s*(\d{2,5})\s*(?:$|\n)/im);
  if (portMatch?.[1]) return Number(portMatch[1]);
  return null;
}

export function inferNodeDefaultPort(input: {
  scriptName: string;
  scriptBody: string;
  viteConfig?: string | null;
  nextConfig?: string | null;
  envFile?: string | null;
}): number {
  const scriptPort = input.scriptBody.match(/(?:--port|-p)\s*=?(\d{2,5})/i)?.[1];
  if (scriptPort) return Number(scriptPort);
  const envPort = parseEnvFilePort(input.envFile ?? "");
  if (envPort) return envPort;
  const vitePort = parseViteConfigPort(input.viteConfig ?? "");
  if (vitePort) return vitePort;
  const nextPort = parseNextDefaultPort(input.nextConfig ?? "");
  if (nextPort) return nextPort;
  if (/next/i.test(input.scriptBody)) return DEFAULT_NEXT_PORT;
  if (/vite|react-scripts|webpack|rsbuild|nuxt/i.test(input.scriptBody)) return DEFAULT_VITE_PORT;
  if (input.scriptName === "start") return DEFAULT_NEXT_PORT;
  return DEFAULT_VITE_PORT;
}

function buildNodeDebugCommand(runner: NodePackageManager, scriptName: string): string {
  const inspect = `NODE_OPTIONS='--inspect=127.0.0.1:${NODE_INSPECT_PORT}'`;
  if (runner === "npm") {
    return `${inspect} npm run ${scriptName}`;
  }
  return `${inspect} ${runner} run ${scriptName}`;
}

export function parsePackageJsonRunProfile(
  packageJson: string,
  bundle: Pick<
    RepositoryRunProfileFileBundle,
    "hasBunLock" | "hasPnpmLock" | "hasYarnLock" | "hasPackageLock" | "viteConfig" | "nextConfig" | "envFile"
  >,
  source = "package.json",
): RepositoryRunProfile | null {
  let parsed: { scripts?: Record<string, string>; name?: string };
  try {
    parsed = JSON.parse(packageJson) as { scripts?: Record<string, string>; name?: string };
  } catch {
    return null;
  }
  const scriptName = pickNodeScript(parsed.scripts);
  if (!scriptName) return null;

  const runner = resolveNodePackageManager(packageJson, bundle);
  const scriptBody = parsed.scripts?.[scriptName]?.trim() ?? "";
  const port = inferNodeDefaultPort({
    scriptName,
    scriptBody,
    viteConfig: bundle.viteConfig,
    nextConfig: bundle.nextConfig,
    envFile: bundle.envFile,
  });

  const kind: RepositoryRunProfileKind = runner;
  const projectName = parsed.name?.trim();
  const label = projectName ? `${runner} · ${projectName}` : `${runner} · ${scriptName}`;

  return {
    kind,
    stack: "node",
    label,
    runCommand: `${runner} run ${scriptName}`,
    debugCommand: buildNodeDebugCommand(runner, scriptName),
    defaultUrl: `http://localhost:${port}`,
    activeProfiles: null,
    mainClass: null,
    modulePath: null,
    source,
  };
}

function enrichProfileUrl(profile: RepositoryRunProfile, bundle: RepositoryRunProfileFileBundle): RepositoryRunProfile {
  if (profile.defaultUrl) return profile;
  if (profile.stack !== "java") return profile;
  const port = resolveSpringBootPort({
    activeProfiles: profile.activeProfiles,
    applicationYaml: bundle.applicationYaml,
    applicationYml: bundle.applicationYml,
    applicationProperties: bundle.applicationProperties,
    applicationProfileConfigs: bundle.applicationProfileConfigs,
  });
  if (!port) return profile;
  return { ...profile, defaultUrl: `http://localhost:${port}` };
}

export function detectRepositoryRunProfileFromFiles(
  bundle: RepositoryRunProfileFileBundle,
): RepositoryRunProfile | null {
  const mavenModule = bundle.rootPomXml
    ? parseMavenSpringBootFromPoms(bundle.rootPomXml, bundle.modulePomXmlByPath ?? {})
    : null;

  const javaConfig = {
    applicationYaml: bundle.applicationYaml ?? null,
    applicationYml: bundle.applicationYml ?? null,
    applicationProperties: bundle.applicationProperties ?? null,
    applicationProfileConfigs: bundle.applicationProfileConfigs ?? {},
  };

  if (bundle.intellijRunConfigurationXml) {
    const fromIdea = parseIntellijSpringBootRunConfiguration(
      bundle.intellijRunConfigurationXml,
      ".idea/runConfigurations",
    );
    if (fromIdea) {
      const modulePath = readIdeaModuleName(bundle.intellijRunConfigurationXml) ?? mavenModule?.modulePath ?? null;
      const mainClass = fromIdea.mainClass ?? mavenModule?.mainClass ?? null;
      const activeProfiles = fromIdea.activeProfiles;
      return enrichProfileUrl(
        buildJavaSpringBootProfile({
          kind: "intellij-spring-boot",
          label: fromIdea.label,
          source: fromIdea.source,
          hasMvnw: bundle.hasMvnw ?? false,
          hasGradlew: bundle.hasGradlew ?? false,
          modulePath,
          mainClass,
          activeProfiles,
          ...javaConfig,
        }),
        bundle,
      );
    }
  }

  if (bundle.rootPomXml && mavenModule) {
    return buildMavenSpringBootProfile(mavenModule, bundle, "pom.xml");
  }

  if (bundle.buildGradleKts) {
    const fromGradle = parseGradleSpringBoot(bundle.buildGradleKts, bundle, "build.gradle.kts");
    if (fromGradle) return fromGradle;
  }
  if (bundle.buildGradle) {
    const fromGradle = parseGradleSpringBoot(bundle.buildGradle, bundle, "build.gradle");
    if (fromGradle) return fromGradle;
  }

  if (bundle.packageJson) {
    return parsePackageJsonRunProfile(bundle.packageJson, bundle, "package.json");
  }

  return null;
}

export function guessIntellijRunConfigurationPaths(mainClass: string | null, artifactId: string | null): string[] {
  const guesses = new Set<string>();
  if (mainClass) {
    const simple = mainClass.split(".").pop();
    if (simple) guesses.add(`.idea/runConfigurations/${simple}.xml`);
  }
  if (artifactId) {
    const pascal = artifactId
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    guesses.add(`.idea/runConfigurations/${pascal}.xml`);
    guesses.add(`.idea/runConfigurations/${pascal}Application.xml`);
  }
  return [...guesses];
}

export function getRunCommandPlaceholder(profile: RepositoryRunProfile | null): string {
  if (!profile) return "bun run dev  /  ./mvnw spring-boot:run";
  if (profile.stack === "java") {
    return "./mvnw -pl <module> -am spring-boot:run";
  }
  return "bun run dev  /  pnpm run dev";
}

export function getRunDebugHint(profile: RepositoryRunProfile | null): string {
  if (!profile?.debugCommand) return "";
  if (profile.stack === "java") {
    return `以 JDWP ${JDWP_DEBUG_PORT} 启动，请在 IDE 中 Attach Remote JVM`;
  }
  return `以 Node inspect ${NODE_INSPECT_PORT} 启动，请在 IDE 中 Attach Node 调试器`;
}

export function dedupeRunProfiles(profiles: RepositoryRunProfile[]): RepositoryRunProfile[] {
  const seen = new Set<string>();
  const out: RepositoryRunProfile[] = [];
  for (const profile of profiles) {
    const key = `${profile.stack}|${profile.runCommand}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(profile);
  }
  return out;
}

export function pickPrimaryRunProfile(
  profiles: RepositoryRunProfile[],
  savedRunCommand: string | null | undefined,
): RepositoryRunProfile | null {
  if (profiles.length === 0) return null;
  if (profiles.length === 1) return profiles[0] ?? null;

  const saved = savedRunCommand?.trim();
  if (saved) {
    const exact = profiles.find((profile) => profile.runCommand.trim() === saved);
    if (exact) return exact;
    if (/spring-boot:run|bootRun|\bmvn(w)?\b|\bgradle(w)?\b/i.test(saved)) {
      return profiles.find((profile) => profile.stack === "java") ?? profiles[0] ?? null;
    }
    if (/\b(npm|pnpm|yarn|bun)\s+run\b|\bvite\b|\bnext\b/i.test(saved)) {
      return profiles.find((profile) => profile.stack === "node") ?? profiles[0] ?? null;
    }
  }

  const java = profiles.find((profile) => profile.stack === "java");
  const node = profiles.find((profile) => profile.stack === "node");
  if (java && node) return java;
  return profiles[0] ?? null;
}

export function isRunCommandStale(
  savedRunCommand: string,
  detectedProfile: RepositoryRunProfile | null,
): boolean {
  const saved = savedRunCommand.trim();
  if (!saved || !detectedProfile) return false;
  if (saved === detectedProfile.runCommand.trim()) return false;
  if (detectedProfile.stack !== "java") return false;
  if (/module-(?:api|ai|biz|infra|system)/i.test(saved) && /server|admin|gateway/i.test(detectedProfile.modulePath ?? "")) {
    return true;
  }
  if (detectedProfile.modulePath && !saved.includes(detectedProfile.modulePath)) {
    return /spring-boot:run|bootRun/i.test(saved);
  }
  return false;
}

export function deriveDebugCommandFromRunCommand(
  runCommand: string,
  profile: RepositoryRunProfile | null,
): string | null {
  const cmd = runCommand.trim();
  if (!cmd) return profile?.debugCommand ?? null;
  if (profile?.debugCommand && profile.debugCommand.trim() === cmd) return cmd;
  if (profile?.debugCommand && profile.runCommand.trim() === cmd) return profile.debugCommand;

  if (/spring-boot:run/i.test(cmd)) {
    if (/jdwp|jvmArguments/i.test(cmd)) return cmd;
    const jvmArgs = `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:${JDWP_DEBUG_PORT}`;
    return `${cmd} -Dspring-boot.run.jvmArguments="${jvmArgs}"`;
  }
  if (/\bbootRun\b/i.test(cmd)) {
    return /--debug-jvm/i.test(cmd) ? cmd : `${cmd} --debug-jvm`;
  }
  if (/\b(npm|pnpm|yarn|bun)\s+run\b/i.test(cmd)) {
    if (/inspect/i.test(cmd)) return cmd;
    return `NODE_OPTIONS='--inspect=127.0.0.1:${NODE_INSPECT_PORT}' ${cmd}`;
  }
  return profile?.debugCommand ?? null;
}

export function adaptProfileToScanRoot(profile: RepositoryRunProfile, scanRoot: string): RepositoryRunProfile {
  if (!scanRoot) return profile;
  const wrap = (command: string) => `(cd ${scanRoot} && ${command})`;
  return {
    ...profile,
    scanRoot,
    label: `${profile.label} · ${scanRoot}`,
    source: `${scanRoot}/${profile.source}`,
    runCommand: wrap(profile.runCommand),
    debugCommand: profile.debugCommand ? wrap(profile.debugCommand) : deriveDebugCommandFromRunCommand(wrap(profile.runCommand), profile),
  };
}
