import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactsPanel } from "./index";

mock.module("../../services/repositoryFiles", () => ({
  searchRepositoryFiles: mock(async () => []),
  listRepositoryExplorerEntries: mock(async () => []),
}));

const repository = {
  id: 1,
  name: "wise",
  path: "/repo/wise",
  repositoryType: "frontend" as const,
  createdAt: "",
  updatedAt: "",
};

describe("ArtifactsPanel", () => {
  test("renders the artifact lane chips and toolbar", () => {
    const html = renderToStaticMarkup(
      <ArtifactsPanel
        repositories={[repository]}
        activeRepositoryId={repository.id}
        onOpenRepositoryFile={mock(() => {})}
      />,
    );

    expect(html).toContain("Markdown");
    expect(html).toContain("Diff");
    expect(html).toContain("Office");
  });
});
