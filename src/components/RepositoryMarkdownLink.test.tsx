import { expect, mock, test } from "bun:test";
import { createRepositoryMarkdownLinkComponent } from "./RepositoryMarkdownLink";

type LinkProps = { href: string; children: string };

function renderLink(fromRelativePath: string, props: LinkProps, onNavigate = mock((_) => {})) {
  const Component = createRepositoryMarkdownLinkComponent(
    fromRelativePath,
    onNavigate,
  ) as unknown as (props: LinkProps) => {
    props: { href: string; title?: string; target?: string; onClick: (event: unknown) => void };
  };
  return { element: Component(props), onNavigate };
}

test("relative markdown links resolve against the repository file and open in the editor", () => {
  const { element, onNavigate } = renderLink("docs/guide.md", { href: "../README.md", children: "README" });
  let prevented = false;
  element.props.onClick({ preventDefault: () => { prevented = true; }, stopPropagation: () => {} });
  expect(prevented).toBe(true);
  expect(onNavigate).toHaveBeenCalledWith("README.md");
  expect(element.props.title).toBe("打开 README.md");
  expect(element.props.target).toBeUndefined();
});

test("external markdown links still open in the system browser", () => {
  const { element } = renderLink("README.md", { href: "https://example.com", children: "site" });
  expect(element.props.target).toBe("_blank");
  expect(element.props.title).toBeUndefined();
});
