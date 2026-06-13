import { describe, expect, test } from "bun:test";
import {
  extractMarketplaceId,
  extractPluginCliSuccess,
  formatInstalledPluginsMarkdown,
  formatPluginMarketplaceAddResult,
  formatPluginMutateResult,
  humanizePluginCliStep,
  splitPluginCliOutput,
} from "./formatComposerPluginOutput";

describe("splitPluginCliOutput", () => {
  test("splits glued progress logs into lines", () => {
    const raw =
      "Adding marketplace...Refreshing marketplace cache (timeout: 120s)... Cloning repository (timeout: 120s): https://github.com/foo/bar Clone complete, validating marketplace... ✔ Successfully added marketplace: omc (declared in user settings)";
    const lines = splitPluginCliOutput(raw);
    expect(lines.some((l) => l.includes("Cloning repository"))).toBe(true);
    expect(lines.some((l) => l.includes("Successfully added marketplace"))).toBe(true);
  });
});

describe("formatPluginMarketplaceAddResult", () => {
  test("renders friendly markdown summary", () => {
    const result = formatPluginMarketplaceAddResult({
      source: "https://github.com/Yeachan-Heo/oh-my-claudecode",
      cliOutput:
        "Adding marketplace...Refreshing marketplace cache (timeout: 120s)... Cloning repository (timeout: 120s): https://github.com/Yeachan-Heo/oh-my-claudecode.git Clone complete, validating marketplace... ✔ Successfully added marketplace: omc (declared in user settings)",
      installed: [
        { id: "hookify@claude-code-plugins", version: "0.1.0", scope: "user", enabled: false },
      ],
    });

    expect(result).toContain("## ✅ 插件市场已添加");
    expect(result).toContain("**市场标识**：`omc`");
    expect(result).toContain("#### 执行过程");
    expect(result).toContain("**刷新市场缓存**");
    expect(result).toContain("**克隆仓库**");
    expect(result).toContain("**校验市场清单**");
    expect(result).toContain("### 已安装插件（1）");
    expect(result).toContain("**hookify@claude-code-plugins**");
    expect(result).toContain("下一步");
    expect(result).toContain("wise://author/claude-plugins?tab=installed");
    expect(result).not.toContain("<details>");
    expect(result).not.toContain("Adding marketplace...Refreshing");
  });
});

describe("humanizePluginCliStep", () => {
  test("maps cloning line to friendly step", () => {
    expect(
      humanizePluginCliStep(
        "Cloning repository (timeout: 120s): https://github.com/Yeachan-Heo/oh-my-claudecode.git",
      ),
    ).toEqual({
      label: "克隆仓库",
      detail: "`https://github.com/Yeachan-Heo/oh-my-claudecode.git` · 超时 120 秒",
    });
  });
});

describe("formatPluginMutateResult", () => {
  test("renders install result with note", () => {
    const result = formatPluginMutateResult({
      action: "install",
      installRef: "oh-my-claudecode@omc",
      scope: "user",
      cliOutput: "Successfully installed oh-my-claudecode@omc",
      installed: [{ id: "oh-my-claudecode@omc", version: "1.0.0", scope: "user", enabled: true }],
      extraNote: "新开 Claude 会话后生效。",
    });

    expect(result).toContain("## ✅ 插件安装完成");
    expect(result).toContain("**插件**：`oh-my-claudecode@omc`");
    expect(result).toContain("新开 Claude 会话后生效");
  });
});

describe("extractPluginCliSuccess", () => {
  test("extracts success line", () => {
    const lines = splitPluginCliOutput("✔ Successfully added marketplace: omc");
    expect(extractPluginCliSuccess(lines)).toContain("Successfully added marketplace");
    expect(extractMarketplaceId(extractPluginCliSuccess(lines))).toBe("omc");
  });
});

describe("formatInstalledPluginsMarkdown", () => {
  test("formats empty state", () => {
    expect(formatInstalledPluginsMarkdown([])).toContain("未安装");
  });
});
