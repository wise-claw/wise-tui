import { describe, expect, test } from "bun:test";
import { gitRemoteUrlToBrowseUrl } from "./gitRemoteBrowseUrl";

describe("gitRemoteUrlToBrowseUrl", () => {
  test("https with .git suffix", () => {
    expect(gitRemoteUrlToBrowseUrl("https://github.com/org/wise.git")).toBe(
      "https://github.com/org/wise",
    );
  });

  test("scp-style ssh", () => {
    expect(gitRemoteUrlToBrowseUrl("git@github.com:org/wise.git")).toBe(
      "https://github.com/org/wise",
    );
  });

  test("ssh:// URL", () => {
    expect(gitRemoteUrlToBrowseUrl("ssh://git@gitlab.com/org/wise.git")).toBe(
      "https://gitlab.com/org/wise",
    );
  });

  test("https without .git", () => {
    expect(gitRemoteUrlToBrowseUrl("https://gitee.com/user/repo")).toBe(
      "https://gitee.com/user/repo",
    );
  });

  test("unsupported scheme", () => {
    expect(gitRemoteUrlToBrowseUrl("file:///tmp/repo")).toBeNull();
    expect(gitRemoteUrlToBrowseUrl("")).toBeNull();
  });
});
