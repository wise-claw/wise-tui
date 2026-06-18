import { listProjectRelativeDirectory, readProjectRelativeFile } from "./projectRelativeFiles";
import {
  adaptProfileToScanRoot,
  dedupeRunProfiles,
  detectRepositoryRunProfileFromFiles,
  guessIntellijRunConfigurationPaths,
  parseIntellijSpringBootRunConfiguration,
  parseMavenSpringBootFromPoms,
  pickPrimaryRunProfile,
  parseSpringActiveProfile,
  type RepositoryRunProfile,
  type RepositoryRunProfileFileBundle,
} from "../utils/detectRepositoryRunProfile";

export type RepositoryRunProfileDetectionResult = {
  profiles: RepositoryRunProfile[];
  primary: RepositoryRunProfile | null;
};

const NODE_SCAN_ROOTS = ["frontend", "web", "client"] as const;
const JAVA_SCAN_ROOTS = ["backend", "server", "api"] as const;

async function tryReadRepositoryFile(repositoryPath: string, relativePath: string): Promise<string | null> {
  try {
    return await readProjectRelativeFile(repositoryPath, relativePath);
  } catch {
    return null;
  }
}

async function tryReadRepositoryFileExists(repositoryPath: string, relativePath: string): Promise<boolean> {
  const content = await tryReadRepositoryFile(repositoryPath, relativePath);
  return content != null;
}

function relPath(scanRoot: string, path: string): string {
  return scanRoot ? `${scanRoot}/${path}` : path;
}

async function readApplicationConfigFiles(
  repositoryPath: string,
  scanRoot: string,
  modulePath: string | null,
): Promise<
  Pick<
    RepositoryRunProfileFileBundle,
    "applicationYaml" | "applicationYml" | "applicationProperties" | "applicationProfileConfigs"
  >
> {
  const resourceRoots = modulePath
    ? [
        relPath(scanRoot, `${modulePath}/src/main/resources`),
        relPath(scanRoot, `${modulePath}/src/main/resources/config`),
      ]
    : [relPath(scanRoot, "src/main/resources"), relPath(scanRoot, "src/main/resources/config")];

  let applicationYaml: string | null = null;
  let applicationYml: string | null = null;
  let applicationProperties: string | null = null;

  for (const prefix of resourceRoots) {
    applicationYaml ??= await tryReadRepositoryFile(repositoryPath, `${prefix}/application.yaml`);
    applicationYml ??= await tryReadRepositoryFile(repositoryPath, `${prefix}/application.yml`);
    applicationProperties ??= await tryReadRepositoryFile(repositoryPath, `${prefix}/application.properties`);
  }

  const activeProfile =
    parseSpringActiveProfile(applicationYml ?? "") ??
    parseSpringActiveProfile(applicationYaml ?? "") ??
    parseSpringActiveProfile(applicationProperties ?? "");

  const profileNames = new Set<string>();
  if (activeProfile) profileNames.add(activeProfile);
  for (const fallback of ["local", "dev", "development", "test"]) {
    profileNames.add(fallback);
  }

  const applicationProfileConfigs: Record<string, string | null> = {};
  await Promise.all(
    [...profileNames].flatMap((profile) =>
      resourceRoots.flatMap((prefix) => [
        (async () => {
          applicationProfileConfigs[profile] ??= await tryReadRepositoryFile(
            repositoryPath,
            `${prefix}/application-${profile}.yml`,
          );
        })(),
        (async () => {
          if (applicationProfileConfigs[profile]) return;
          applicationProfileConfigs[profile] = await tryReadRepositoryFile(
            repositoryPath,
            `${prefix}/application-${profile}.yaml`,
          );
        })(),
        (async () => {
          if (applicationProfileConfigs[profile]) return;
          applicationProfileConfigs[profile] = await tryReadRepositoryFile(
            repositoryPath,
            `${prefix}/application-${profile}.properties`,
          );
        })(),
      ]),
    ),
  );

  return { applicationYaml, applicationYml, applicationProperties, applicationProfileConfigs };
}

async function readMavenModulePoms(
  repositoryPath: string,
  scanRoot: string,
  rootPomXml: string,
): Promise<Record<string, string | null>> {
  const block = rootPomXml.match(/<modules>([\s\S]*?)<\/modules>/i)?.[1];
  if (!block) return {};
  const modulePaths = [...block.matchAll(/<module>([^<]+)<\/module>/gi)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  const modulePomXmlByPath: Record<string, string | null> = {};
  await Promise.all(
    modulePaths.map(async (modulePath) => {
      modulePomXmlByPath[modulePath] = await tryReadRepositoryFile(
        repositoryPath,
        relPath(scanRoot, `${modulePath}/pom.xml`),
      );
    }),
  );
  return modulePomXmlByPath;
}

async function readIntellijSpringBootRunConfiguration(
  repositoryPath: string,
  rootPomXml: string | null,
  modulePomXmlByPath: Record<string, string | null>,
): Promise<string | null> {
  const candidates: string[] = [];

  try {
    const files = await listProjectRelativeDirectory(repositoryPath, ".idea/runConfigurations");
    for (const fileName of files) {
      if (fileName.endsWith(".xml")) {
        candidates.push(`.idea/runConfigurations/${fileName}`);
      }
    }
  } catch {
    /* directory may not exist */
  }

  candidates.push(".idea/runConfigurations.xml");
  if (rootPomXml) {
    const module = parseMavenSpringBootFromPoms(rootPomXml, modulePomXmlByPath);
    candidates.push(...guessIntellijRunConfigurationPaths(module?.mainClass ?? null, module?.artifactId ?? null));
  }

  let bestXml: string | null = null;
  let bestScore = -1;
  const preferredModule = rootPomXml ? parseMavenSpringBootFromPoms(rootPomXml, modulePomXmlByPath)?.modulePath : null;

  for (const relativePath of candidates) {
    const xml = await tryReadRepositoryFile(repositoryPath, relativePath);
    if (!xml || !/SpringBootApplicationConfigurationType/i.test(xml)) continue;
    const parsed = parseIntellijSpringBootRunConfiguration(xml, relativePath);
    if (!parsed) continue;
    let score = 0;
    if (preferredModule && parsed.modulePath === preferredModule) score += 100;
    if (parsed.mainClass) score += 20;
    if (parsed.activeProfiles) score += 5;
    if (score > bestScore) {
      bestScore = score;
      bestXml = xml;
    }
  }

  return bestXml;
}

async function readNodeSupportFiles(
  repositoryPath: string,
  scanRoot: string,
): Promise<Pick<RepositoryRunProfileFileBundle, "viteConfig" | "nextConfig" | "envFile">> {
  const viteCandidates = ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"];
  let viteConfig: string | null = null;
  for (const path of viteCandidates) {
    viteConfig = await tryReadRepositoryFile(repositoryPath, relPath(scanRoot, path));
    if (viteConfig) break;
  }

  const nextCandidates = ["next.config.ts", "next.config.js", "next.config.mjs"];
  let nextConfig: string | null = null;
  for (const path of nextCandidates) {
    nextConfig = await tryReadRepositoryFile(repositoryPath, relPath(scanRoot, path));
    if (nextConfig) break;
  }

  const envFile =
    (await tryReadRepositoryFile(repositoryPath, relPath(scanRoot, ".env.local"))) ??
    (await tryReadRepositoryFile(repositoryPath, relPath(scanRoot, ".env.development"))) ??
    (await tryReadRepositoryFile(repositoryPath, relPath(scanRoot, ".env")));

  return { viteConfig, nextConfig, envFile };
}

async function detectRepositoryRunProfileAtScanRoot(
  repositoryPath: string,
  scanRoot: string,
): Promise<RepositoryRunProfile | null> {
  const rootPomXml = await tryReadRepositoryFile(repositoryPath, relPath(scanRoot, "pom.xml"));
  const packageJson = await tryReadRepositoryFile(repositoryPath, relPath(scanRoot, "package.json"));
  const buildGradle = await tryReadRepositoryFile(repositoryPath, relPath(scanRoot, "build.gradle"));
  const buildGradleKts = await tryReadRepositoryFile(repositoryPath, relPath(scanRoot, "build.gradle.kts"));

  if (scanRoot) {
    const hasMarker = Boolean(rootPomXml || packageJson || buildGradle || buildGradleKts);
    if (!hasMarker) return null;
  }

  const modulePomXmlByPath = rootPomXml ? await readMavenModulePoms(repositoryPath, scanRoot, rootPomXml) : {};
  const mavenModule = rootPomXml ? parseMavenSpringBootFromPoms(rootPomXml, modulePomXmlByPath) : null;

  const [
    hasMvnw,
    hasGradlew,
    hasBunLock,
    hasPnpmLock,
    hasYarnLock,
    hasPackageLock,
    applicationFiles,
    intellijRunConfigurationXml,
    nodeSupportFiles,
  ] = await Promise.all([
    tryReadRepositoryFileExists(repositoryPath, "mvnw"),
    tryReadRepositoryFileExists(repositoryPath, "gradlew"),
    tryReadRepositoryFileExists(repositoryPath, relPath(scanRoot, "bun.lock")),
    tryReadRepositoryFileExists(repositoryPath, relPath(scanRoot, "pnpm-lock.yaml")),
    tryReadRepositoryFileExists(repositoryPath, relPath(scanRoot, "yarn.lock")),
    tryReadRepositoryFileExists(repositoryPath, relPath(scanRoot, "package-lock.json")),
    readApplicationConfigFiles(repositoryPath, scanRoot, mavenModule?.modulePath ?? null),
    scanRoot === "" ? readIntellijSpringBootRunConfiguration(repositoryPath, rootPomXml, modulePomXmlByPath) : Promise.resolve(null),
    readNodeSupportFiles(repositoryPath, scanRoot),
  ]);

  const bundle: RepositoryRunProfileFileBundle = {
    intellijRunConfigurationXml,
    rootPomXml,
    modulePomXmlByPath,
    buildGradle,
    buildGradleKts,
    packageJson,
    hasMvnw,
    hasGradlew,
    hasBunLock,
    hasPnpmLock,
    hasYarnLock,
    hasPackageLock,
    ...applicationFiles,
    ...nodeSupportFiles,
  };

  const profile = detectRepositoryRunProfileFromFiles(bundle);
  if (!profile) return null;
  return scanRoot ? adaptProfileToScanRoot(profile, scanRoot) : profile;
}

export async function detectRepositoryRunProfiles(
  repositoryPath: string,
  savedRunCommand?: string | null,
): Promise<RepositoryRunProfileDetectionResult> {
  const trimmed = repositoryPath.trim();
  if (!trimmed) {
    return { profiles: [], primary: null };
  }

  const rootProfile = await detectRepositoryRunProfileAtScanRoot(trimmed, "");
  const profiles: RepositoryRunProfile[] = rootProfile ? [rootProfile] : [];

  const rootHasJava = rootProfile?.stack === "java";
  const rootHasNode = rootProfile?.stack === "node";

  const extraRoots = [
    ...(!rootHasNode ? NODE_SCAN_ROOTS : []),
    ...(!rootHasJava ? JAVA_SCAN_ROOTS : []),
  ];

  const nestedProfiles = await Promise.all(
    extraRoots.map(async (scanRoot) => detectRepositoryRunProfileAtScanRoot(trimmed, scanRoot)),
  );
  for (const profile of nestedProfiles) {
    if (profile) profiles.push(profile);
  }

  const deduped = dedupeRunProfiles(profiles);
  return {
    profiles: deduped,
    primary: pickPrimaryRunProfile(deduped, savedRunCommand),
  };
}

export async function detectRepositoryRunProfile(repositoryPath: string): Promise<RepositoryRunProfile | null> {
  const result = await detectRepositoryRunProfiles(repositoryPath);
  return result.primary;
}
