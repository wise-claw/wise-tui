import { useEffect, useState, type ComponentProps } from "react";
import { RightOutlined } from "@ant-design/icons";
import { useInViewActive } from "../../hooks/useInView";
import { GitRepoSection } from "./GitRepoSection";
import { GIT_MULTI_REPO_LAZY_UNMOUNT_MS } from "./gitPanelUtils";

type GitRepoSectionProps = ComponentProps<typeof GitRepoSection>;

interface Props extends Omit<GitRepoSectionProps, "externalInView" | "externalSectionRef"> {
  entry: GitRepoSectionProps["entry"];
  /** 多仓列表滚动容器，作为 IntersectionObserver root（侧栏内 lazy 挂载必需）。 */
  scrollRoot?: Element | null;
}

/** 多仓列表 lazy 挂载：离屏仓库仅保留占位行，进入视口后再挂载完整 Git 区块。 */
export function GitMultiRepoLazySection({ entry, scrollRoot = null, ...sectionProps }: Props) {
  const [sectionRef, inView] = useInViewActive("240px", true, scrollRoot);
  const [mounted, setMounted] = useState(inView);

  useEffect(() => {
    if (inView) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setMounted(false);
    }, GIT_MULTI_REPO_LAZY_UNMOUNT_MS);
    return () => window.clearTimeout(timer);
  }, [inView]);

  if (!mounted) {
    return (
      <section
        ref={sectionRef}
        className="git-repo-section git-repo-section--placeholder"
        data-repository-path={entry.path}
        aria-label={entry.name}
      >
        <div className="git-repo-section__header git-repo-section__header--placeholder">
          <span className="git-repo-section__chevron" aria-hidden>
            <RightOutlined />
          </span>
          <span className="git-repo-section__name" title={entry.name}>
            {entry.name}
          </span>
        </div>
      </section>
    );
  }

  return (
    <GitRepoSection
      {...sectionProps}
      entry={entry}
      externalInView={inView}
      externalSectionRef={sectionRef}
    />
  );
}
