import { readProjectRelativeFile } from "./materializePrdSnapshot";
import {
  detectRepositoryRunProfileFromFiles,
  guessIntellijRunConfigurationPaths,
  parseMavenSpringBootFromPoms,
  parseSpringActiveProfile,
  type RepositoryRunProfile,
  type RepositoryRunProfileFileBundle,
} from "../utils/detectRepositoryRunProfile";

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

async function readApplicationConfigFiles(
  repositoryPath: string,
  modulePath: string | null,
): Promise<
  Pick<
    RepositoryRunProfileFileBundle,
    "applicationYaml" | "applicationYml" | "applicationProperties" | "applicationProfileConfigs"
  >
> {
  const prefixes = modulePath
    ? [`${modulePath}/src/main/resources`, `${modulePath}/src/main/resources/config`]
    : ["src/main/resources", "src/main/resources/config"];

  let applicationYaml: string | null = null;
  let applicationYml: string | null = null;
  let applicationProperties: string | null = null;

  for (const prefix of prefixes) {
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
      prefixes.flatMap((prefix) => [
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
      modulePomXmlByPath[modulePath] = await tryReadRepositoryFile(repositoryPath, `${modulePath}/pom.xml`);
    }),
  );
  return modulePomXmlByPath;
}

async function readIntellijSpringBootRunConfiguration(
  repositoryPath: string,
  rootPomXml: string | null,
  modulePomXmlByPath: Record<string, string | null>,
): Promise<string | null> {
  const directCandidates = [".idea/runConfigurations.xml"];
  if (rootPomXml) {
    const module = parseMavenSpringBootFromPoms(rootPomXml, modulePomXmlByPath);
    directCandidates.push(
      ...guessIntellijRunConfigurationPaths(module?.mainClass ?? null, module?.artifactId ?? null),
    );
  }

  for (const relativePath of directCandidates) {
    const xml = await tryReadRepositoryFile(repositoryPath, relativePath);
    if (xml && /SpringBootApplicationConfigurationType/i.test(xml)) {
      return xml;
    }
  }
  return null;
}

async function readNodeSupportFiles(
  repositoryPath: string,
): Promise<Pick<RepositoryRunProfileFileBundle, "viteConfig" | "nextConfig" | "envFile">> {
  const viteCandidates = ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"];
  let viteConfig: string | null = null;
  for (const path of viteCandidates) {
    viteConfig = await tryReadRepositoryFile(repositoryPath, path);
    if (viteConfig) break;
  }

  const nextCandidates = ["next.config.ts", "next.config.js", "next.config.mjs"];
  let nextConfig: string | null = null;
  for (const path of nextCandidates) {
    nextConfig = await tryReadRepositoryFile(repositoryPath, path);
    if (nextConfig) break;
  }

  const envFile =
    (await tryReadRepositoryFile(repositoryPath, ".env.local")) ??
    (await tryReadRepositoryFile(repositoryPath, ".env.development")) ??
    (await tryReadRepositoryFile(repositoryPath, ".env"));

  return { viteConfig, nextConfig, envFile };
}

export async function detectRepositoryRunProfile(repositoryPath: string): Promise<RepositoryRunProfile | null> {
  const trimmed = repositoryPath.trim();
  if (!trimmed) return null;

  const rootPomXml = await tryReadRepositoryFile(trimmed, "pom.xml");
  const modulePomXmlByPath = rootPomXml ? await readMavenModulePoms(trimmed, rootPomXml) : {};
  const mavenModule = rootPomXml ? parseMavenSpringBootFromPoms(rootPomXml, modulePomXmlByPath) : null;

  const [
    buildGradle,
    buildGradleKts,
    packageJson,
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
    tryReadRepositoryFile(trimmed, "build.gradle"),
    tryReadRepositoryFile(trimmed, "build.gradle.kts"),
    tryReadRepositoryFile(trimmed, "package.json"),
    tryReadRepositoryFileExists(trimmed, "mvnw"),
    tryReadRepositoryFileExists(trimmed, "gradlew"),
    tryReadRepositoryFileExists(trimmed, "bun.lock"),
    tryReadRepositoryFileExists(trimmed, "pnpm-lock.yaml"),
    tryReadRepositoryFileExists(trimmed, "yarn.lock"),
    tryReadRepositoryFileExists(trimmed, "package-lock.json"),
    readApplicationConfigFiles(trimmed, mavenModule?.modulePath ?? null),
    readIntellijSpringBootRunConfiguration(trimmed, rootPomXml, modulePomXmlByPath),
    readNodeSupportFiles(trimmed),
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

  return detectRepositoryRunProfileFromFiles(bundle);
}
