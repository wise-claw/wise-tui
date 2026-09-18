import { MarkdownBody } from "./ClaudeSessions/MarkdownElements";
import { RepositoryCanvasPreview } from "./RepositoryCanvasPreview";

export function DocumentCanvasPreview({ content, path }: { content: string; path: string }) {
  return (
    <RepositoryCanvasPreview content={content} path={path}>
      <article className="app-markdown app-markdown--file-doc app-canvas__paper" aria-label="产品方案正文">
        <MarkdownBody source={content} />
      </article>
    </RepositoryCanvasPreview>
  );
}
