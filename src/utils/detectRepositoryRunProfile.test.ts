import { describe, expect, test } from "bun:test";
import {
  dedupeRunProfiles,
  deriveDebugCommandFromRunCommand,
  detectRepositoryRunProfileFromFiles,
  inferNodeDefaultPort,
  isRunCommandStale,
  parseApplicationServerPort,
  parseIntellijSpringBootRunConfiguration,
  parseMavenSpringBootFromPoms,
  parsePackageJsonRunProfile,
  parseSpringActiveProfile,
  parseViteConfigPort,
  pickPrimaryRunProfile,
  resolveNodePackageManager,
} from "./detectRepositoryRunProfile";

const YUDAO_ROOT_POM = `
<project>
  <modules>
    <module>yudao-module-ai</module>
    <module>yudao-server</module>
  </modules>
</project>
`;

const YUDAO_AI_MODULE_POM = `
<project>
  <artifactId>yudao-module-ai</artifactId>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
</project>
`;

const YUDAO_SERVER_POM = `
<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
  </parent>
  <artifactId>yudao-server</artifactId>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
        <configuration>
          <mainClass>cn.iocoder.yudao.server.YudaoServerApplication</mainClass>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
`;

const IDEA_RUN_CONFIG = `
<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="YudaoServerApplication" type="SpringBootApplicationConfigurationType" factoryName="Spring Boot">
    <module name="yudao-server.main" />
    <option name="ACTIVE_PROFILES" value="local" />
    <option name="MAIN_CLASS_NAME" value="cn.iocoder.yudao.server.YudaoServerApplication" />
  </configuration>
</component>
`;

describe("detectRepositoryRunProfile", () => {
  test("parseApplicationServerPort reads yaml and properties", () => {
    expect(parseApplicationServerPort("server:\n  port: 48080\n")).toBe(48080);
    expect(parseApplicationServerPort("server.port=8081\n")).toBe(8081);
  });

  test("parseSpringActiveProfile reads yaml profile", () => {
    expect(parseSpringActiveProfile("spring:\n  profiles:\n    active: local\n")).toBe("local");
  });

  test("parseIntellijSpringBootRunConfiguration builds maven run/debug commands", () => {
    const profile = parseIntellijSpringBootRunConfiguration(
      IDEA_RUN_CONFIG,
      ".idea/runConfigurations/YudaoServerApplication.xml",
    );
    expect(profile?.kind).toBe("intellij-spring-boot");
    expect(profile?.stack).toBe("java");
    expect(profile?.modulePath).toBe("yudao-server");
    expect(profile?.runCommand).toContain("spring-boot:run");
    expect(profile?.runCommand).toContain("-Dspring-boot.run.profiles=local");
    expect(profile?.debugCommand).toContain("jdwp");
    expect(profile?.debugCommand).toContain("5005");
  });

  test("parseMavenSpringBootFromPoms prefers server module over ai module", () => {
    const module = parseMavenSpringBootFromPoms(YUDAO_ROOT_POM, {
      "yudao-module-ai": YUDAO_AI_MODULE_POM,
      "yudao-server": YUDAO_SERVER_POM,
    });
    expect(module?.modulePath).toBe("yudao-server");
    expect(module?.mainClass).toBe("cn.iocoder.yudao.server.YudaoServerApplication");
  });

  test("detectRepositoryRunProfileFromFiles prefers IntelliJ config and profile port", () => {
    const profile = detectRepositoryRunProfileFromFiles({
      intellijRunConfigurationXml: IDEA_RUN_CONFIG,
      rootPomXml: YUDAO_ROOT_POM,
      modulePomXmlByPath: {
        "yudao-module-ai": YUDAO_AI_MODULE_POM,
        "yudao-server": YUDAO_SERVER_POM,
      },
      hasMvnw: true,
      applicationYml: "spring:\n  profiles:\n    active: local\n",
      applicationProfileConfigs: {
        local: "server:\n  port: 48080\n",
      },
    });
    expect(profile?.kind).toBe("intellij-spring-boot");
    expect(profile?.defaultUrl).toBe("http://localhost:48080");
    expect(profile?.runCommand).toContain("-pl yudao-server -am");
    expect(profile?.runCommand.startsWith("./mvnw")).toBe(true);
  });

  test("detectRepositoryRunProfileFromFiles falls back to package.json with bun", () => {
    const profile = detectRepositoryRunProfileFromFiles({
      packageJson: JSON.stringify({
        name: "wise",
        scripts: { dev: "vite" },
        packageManager: "bun@1.3.5",
      }),
      hasBunLock: true,
      viteConfig: "export default { server: { port: 16088 } }",
    });
    expect(profile?.runCommand).toBe("bun run dev");
    expect(profile?.stack).toBe("node");
    expect(profile?.defaultUrl).toBe("http://localhost:16088");
    expect(profile?.debugCommand).toContain("9229");
  });

  test("parsePackageJsonRunProfile uses pnpm and vite port", () => {
    const profile = parsePackageJsonRunProfile(
      JSON.stringify({ scripts: { dev: "vite" } }),
      {
        hasBunLock: false,
        hasPnpmLock: true,
        hasYarnLock: false,
        hasPackageLock: false,
        viteConfig: "export default { server: { port: 3000 } }",
      },
    );
    expect(profile?.kind).toBe("pnpm");
    expect(profile?.runCommand).toBe("pnpm run dev");
    expect(profile?.defaultUrl).toBe("http://localhost:3000");
  });

  test("resolveNodePackageManager prefers lockfiles", () => {
    expect(
      resolveNodePackageManager(JSON.stringify({}), {
        hasBunLock: false,
        hasPnpmLock: false,
        hasYarnLock: true,
        hasPackageLock: true,
      }),
    ).toBe("yarn");
  });

  test("parseViteConfigPort and inferNodeDefaultPort", () => {
    expect(parseViteConfigPort("export default { server: { port: 16088 } }")).toBe(16088);
    expect(
      inferNodeDefaultPort({
        scriptName: "dev",
        scriptBody: "vite",
        viteConfig: "export default { server: { port: 16088 } }",
      }),
    ).toBe(16088);
  });

  test("deriveDebugCommandFromRunCommand injects jdwp and inspect", () => {
    expect(
      deriveDebugCommandFromRunCommand("./mvnw -pl yudao-server -am spring-boot:run", null)?.includes("jdwp"),
    ).toBe(true);
    expect(
      deriveDebugCommandFromRunCommand("bun run dev", null)?.includes("9229"),
    ).toBe(true);
  });

  test("isRunCommandStale detects wrong java module", () => {
    expect(
      isRunCommandStale("mvn -pl yudao-module-ai spring-boot:run", {
        kind: "maven-spring-boot",
        stack: "java",
        label: "Maven Spring Boot · yudao-server",
        runCommand: "./mvnw -pl yudao-server -am spring-boot:run",
        debugCommand: null,
        defaultUrl: "http://localhost:48080",
        activeProfiles: null,
        mainClass: null,
        modulePath: "yudao-server",
        source: "pom.xml",
      }),
    ).toBe(true);
  });

  test("pickPrimaryRunProfile prefers saved stack", () => {
    const profiles = [
      {
        kind: "maven-spring-boot" as const,
        stack: "java" as const,
        label: "Java",
        runCommand: "./mvnw spring-boot:run",
        debugCommand: null,
        defaultUrl: null,
        activeProfiles: null,
        mainClass: null,
        modulePath: null,
        source: "pom.xml",
      },
      {
        kind: "bun" as const,
        stack: "node" as const,
        label: "Node",
        runCommand: "bun run dev",
        debugCommand: null,
        defaultUrl: null,
        activeProfiles: null,
        mainClass: null,
        modulePath: null,
        source: "package.json",
      },
    ];
    expect(pickPrimaryRunProfile(profiles, "bun run dev")?.stack).toBe("node");
    expect(pickPrimaryRunProfile(profiles, null)?.stack).toBe("java");
    expect(dedupeRunProfiles([...profiles, profiles[1]])).toHaveLength(2);
  });
});
