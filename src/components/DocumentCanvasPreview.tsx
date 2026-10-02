import { useMemo } from "react";
import { MarkdownBody } from "./ClaudeSessions/MarkdownElements";
import { RepositoryCanvasPreview } from "./RepositoryCanvasPreview";
import { MARKDOWN_HTML_REHYPE_PLUGINS } from "../utils/rehypeMarkdownHtml";
import { createRepositoryMarkdownLinkComponent } from "./RepositoryMarkdownLink";

export function DocumentCanvasPreview({
  content,
  path,
  onNavigateToFile,
}: {
  content: string;
  path: string;
  /** 提供后，文档内相对链接按仓库路径解析并交给文件编辑器打开。 */
  onNavigateToFile?: (relativePath: string) => void;
}) {
  const components = useMemo(
    () => (onNavigateToFile ? { a: createRepositoryMarkdownLinkComponent(path, onNavigateToFile) } : undefined),
    [path, onNavigateToFile],
  );
  return (
    <RepositoryCanvasPreview content={content} path={path}>
      <article className="app-markdown app-markdown--file-doc app-canvas__paper" aria-label="产品方案正文">
        <MarkdownBody source={content} rehypePlugins={MARKDOWN_HTML_REHYPE_PLUGINS} components={components} />
      </article>
    </RepositoryCanvasPreview>
  );
}
