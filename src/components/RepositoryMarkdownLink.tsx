import type { Components } from "react-markdown";
import { isSafeExternalHref, openExternalUrl } from "../services/openExternal";
import { resolveRepositoryMarkdownPath } from "../utils/repositoryMarkdownLinks";

/**
 * 仓库文件预览里的 Markdown 链接：相对路径按当前文件所在目录解析为仓库相对路径，
 * 点击后交给文件编辑器打开；外链仍走系统默认应用。
 */
export function createRepositoryMarkdownLinkComponent(
  fromRelativePath: string,
  onNavigateToFile: (relativePath: string) => void,
): NonNullable<Components["a"]> {
  // 剥离 react-markdown 注入的 `node`，避免非法属性落到 DOM。
  return function RepositoryMarkdownLink({ href, children, node: _node, ...props }) {
    const repositoryPath = href ? resolveRepositoryMarkdownPath(fromRelativePath, href) : null;

    if (repositoryPath) {
      return (
        <a
          {...props}
          href={href}
          className="app-markdown-link"
          title={`打开 ${repositoryPath}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onNavigateToFile(repositoryPath);
          }}
        >
          {children}
        </a>
      );
    }

    return (
      <a
        {...props}
        href={href}
        className="app-markdown-link"
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (!href || !isSafeExternalHref(href)) return;
          event.preventDefault();
          event.stopPropagation();
          void openExternalUrl(href);
        }}
      >
        {children}
      </a>
    );
  };
}
