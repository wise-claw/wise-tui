import { Input } from "antd";
import { Children, isValidElement, useRef, useState, type ReactNode } from "react";
import { DEFAULT_CONFIG_CATEGORIES, matchesConfigSearch } from "./configNavigation";

interface ConfigSection {
  key: string;
  title: string;
  content: ReactNode;
  keywords?: string;
}

/** 只索引可读标签和说明，不读取 JSON 编辑器或用户配置值。 */
function settingLabels(node: ReactNode): string {
  return Children.toArray(node).map((child): string => {
    if (!isValidElement<{ title?: string; hint?: string; detail?: string; children?: ReactNode }>(child)) return "";
    return [child.props.title, child.props.hint, child.props.detail, settingLabels(child.props.children)].filter(Boolean).join(" ");
  }).join(" ");
}

export function DefaultConfigBrowser({ sections }: { sections: ConfigSection[] }) {
  const [activeKey, setActiveKey] = useState<string>("session");
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const searching = query.trim().length > 0;
  const activeCategory = DEFAULT_CONFIG_CATEGORIES.find((category) => category.key === activeKey)!;
  const visibleSections = searching
    ? sections.filter((section) => {
      const category = DEFAULT_CONFIG_CATEGORIES.find((item) => item.sections.some((key) => key === section.key));
      return matchesConfigSearch(query, `${category?.title ?? ""} ${section.title} ${section.keywords ?? ""} ${settingLabels(section.content)}`);
    })
    : activeCategory.sections.flatMap((key) => sections.filter((section) => section.key === key));

  function selectCategory(key: string) {
    setActiveKey(key);
    setQuery("");
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }

  return (
    <div className="app-default-config-panel">
      <header className="app-default-config-browser__header">
        <div>
          <h2>默认配置</h2>
          <p>按场景管理偏好，修改后自动保存</p>
        </div>
        <Input.Search
          aria-label="搜索默认配置"
          placeholder="搜索设置，如权限、文件树"
          allowClear
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (contentRef.current) contentRef.current.scrollTop = 0;
          }}
        />
      </header>
      <div className="app-default-config-browser__body">
        <nav className="app-default-config-browser__nav" aria-label="默认配置分类">
          {DEFAULT_CONFIG_CATEGORIES.map((category) => (
            <button
              key={category.key}
              type="button"
              aria-current={!searching && activeKey === category.key ? "page" : undefined}
              onClick={() => selectCategory(category.key)}
            >
              {category.title}
            </button>
          ))}
        </nav>
        <div ref={contentRef} className="app-default-config-browser__content" tabIndex={0} aria-label="配置内容">
          <div className="app-default-config-browser__intro" aria-live="polite">
            <h3>{searching ? "搜索结果" : activeCategory.title}</h3>
            <p>{searching ? `找到 ${visibleSections.length} 个相关设置分组` : activeCategory.description}</p>
          </div>
          {visibleSections.length === 0 ? (
            <div className="app-default-config-browser__empty">
              <p>没有找到相关设置，试试“终端”“语言”或“通知”。</p>
              <button type="button" onClick={() => setQuery("")}>清除搜索</button>
            </div>
          ) : visibleSections.map((section) => (
            <section className="app-default-config-section" key={section.key} aria-label={section.title}>
              <h3 className="app-default-config-section__title">{section.title}</h3>
              <div className="app-default-config-panel__settings">{section.content}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
