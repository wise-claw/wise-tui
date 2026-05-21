export interface RecommendedMcpEnvVar {
  name: string;
  label: string;
  placeholder: string;
  required?: boolean;
  isPath?: boolean;
  isArg?: boolean; // If true, appended as a command-line argument rather than an environment variable
}

export interface RecommendedMcp {
  name: string;
  category: "开发与数据" | "搜索与信息" | "办公与写作" | "智能辅助";
  description: string;
  command: string;
  args: string[];
  tools: string[];
  envVars?: RecommendedMcpEnvVar[];
}

export const RECOMMENDED_MCP_SERVERS: RecommendedMcp[] = [
  {
    name: "filesystem",
    category: "开发与数据",
    description: "提供安全的文件系统读取与写入能力。支持列出目录、检索文件信息、写入/修改文本文件等，是 AI 进行本地代码重构的绝对核心。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    tools: ["read_file", "write_to_file", "list_directory", "get_file_info"],
    envVars: [
      {
        name: "PATH",
        label: "授权访问的文件夹路径",
        placeholder: "请输入您希望授权 AI 读写的绝对路径，例如工作区路径",
        required: true,
        isPath: true,
        isArg: true,
      },
    ],
  },
  {
    name: "sequential-thinking",
    category: "智能辅助",
    description: "官方首推！动态长思考推理工具，能够在面临复杂架构或 Debug 难题时开启顺序的思维树，模拟人类不断修正、求证的深度思考过程。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    tools: ["sequentialthinking"],
  },
  {
    name: "memory",
    category: "智能辅助",
    description: "基于知识图谱构建的长期记忆组件。智能体可通过其自主建立实体、属性和关系，跨会话、跨项目记录关键事实，使 AI 越用越聪明。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    tools: ["create_entities", "create_relations", "read_graph", "search_nodes"],
  },
  {
    name: "brave-search",
    category: "搜索与信息",
    description: "通过 Brave 官方搜索引擎为 AI 带来实时检索能力。特别适用于查找最新的第三方依赖版本、API 变更说明或者热点事实。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    tools: ["brave_web_search", "brave_local_search"],
    envVars: [
      {
        name: "BRAVE_API_KEY",
        label: "Brave API Key",
        placeholder: "请输入以 bs- 开头的 Brave API Key",
        required: true,
      },
    ],
  },
  {
    name: "google-search",
    category: "搜索与信息",
    description: "通过 SerpAPI 深度桥接 Google 全球网页搜索引擎，支持获取最新时事新闻、技术问答、文献检索与网络资讯。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gsearch"],
    tools: ["google_search", "google_news", "google_academic"],
    envVars: [
      {
        name: "SERPAPI_API_KEY",
        label: "SerpAPI Key",
        placeholder: "请输入您的 SerpAPI Key",
        required: true,
      },
    ],
  },
  {
    name: "fetch",
    category: "搜索与信息",
    description: "强大的网页内容抓取与降噪利器。只要输入任意网页链接，它就能为您高速拉取完整内容，并智能过滤多余干扰、渲染成清爽的 Markdown 格式。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    tools: ["fetch_url", "web_to_markdown"],
  },
  {
    name: "puppeteer",
    category: "开发与数据",
    description: "集成无头 Chrome 浏览器控制。支持对目标网页进行交互式操作（点击、输入、滚动等）以及一键抓取渲染后的 DOM 和高清页面截图。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    tools: ["puppeteer_navigate", "puppeteer_click", "puppeteer_screenshot"],
  },
  {
    name: "github",
    category: "开发与数据",
    description: "与 GitHub 进行深度交互。使智能体可以直接检索代码库、拉取 PR 列表、处理/新建 Issue、提交代码库变更，实现全链路的远程代码库托管协作。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    tools: ["get_repository", "create_pull_request", "search_issues", "push_commits"],
    envVars: [
      {
        name: "GITHUB_TOKEN",
        label: "GitHub Personal Access Token",
        placeholder: "请输入以 ghp_ 或 github_pat_ 开头的 GitHub Token",
        required: true,
      },
    ],
  },
  {
    name: "postgres",
    category: "开发与数据",
    description: "连接您的 PostgreSQL 数据库。允许 AI 安全地获取表结构定义（Schema）、执行只读查询、解释索引以及调优复杂 SQL 语句性能。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    tools: ["pg_get_schema", "pg_query", "pg_list_tables"],
    envVars: [
      {
        name: "CONNECTION_STRING",
        label: "连接字符串 / 连接参数 (参数形式)",
        placeholder: "例如 postgresql://username:password@localhost:5432/dbname",
        required: true,
        isArg: true,
      },
    ],
  },
  {
    name: "sqlite",
    category: "开发与数据",
    description: "本地 SQLite 数据库直连工具。让 AI 可直接加载 .sqlite / .db 文件，执行高精度的表格元数据分析、记录存取、插入与检索分析。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    tools: ["sqlite_query", "sqlite_schema", "sqlite_list_tables"],
    envVars: [
      {
        name: "DB_PATH",
        label: "SQLite 数据库绝对路径 (参数形式)",
        placeholder: "请输入您的本地 SQLite 文件绝对路径",
        required: true,
        isPath: true,
        isArg: true,
      },
    ],
  },
  {
    name: "mysql",
    category: "开发与数据",
    description: "集成 MySQL 数据库存取通道。在取得授权后，可列出当前所有库与表、查询分析数据记录并自动生成 Schema 文档。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-mysql"],
    tools: ["mysql_get_schema", "mysql_query", "mysql_list_tables"],
    envVars: [
      {
        name: "CONNECTION_STRING",
        label: "MySQL 连接字符串 (参数形式)",
        placeholder: "例如 mysql://root:password@127.0.0.1:3306/dbname",
        required: true,
        isArg: true,
      },
    ],
  },
  {
    name: "docker",
    category: "开发与数据",
    description: "无缝对接本地或远端 Docker 服务。AI 助手可以查询正在运行的容器镜像、检视容器健康状态、列出环境变量并实时追踪进程容器日志。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-docker"],
    tools: ["docker_list_containers", "docker_inspect_container", "docker_get_logs"],
  },
  {
    name: "slack",
    category: "办公与写作",
    description: "通过 Slack 官方 API 实现与团队对话的无缝沟通。支持让 AI 列出公开频道、向指定频道发送警报消息，或跨群组历史进行聊天信息检索。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    tools: ["slack_post_message", "slack_list_channels", "slack_search_messages"],
    envVars: [
      {
        name: "SLACK_BOT_TOKEN",
        label: "Slack Bot Token",
        placeholder: "以 xoxb- 开头的 Slack 机器人凭证",
        required: true,
      },
      {
        name: "SLACK_TEAM_ID",
        label: "Slack 团队 ID (可选)",
        placeholder: "例如 T12345678",
      },
    ],
  },
  {
    name: "notion",
    category: "办公与写作",
    description: "双向联动 Notion 个人/企业知识图谱。支持对 Notion 中的页面与块结构进行精准的目录枚举、正文抓取、新增段落或构建全新页面。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-notion"],
    tools: ["notion_search", "notion_retrieve_page", "notion_append_block"],
    envVars: [
      {
        name: "NOTION_API_KEY",
        label: "Notion Integration Token",
        placeholder: "请输入以 secret_ 开头的 Notion API Key",
        required: true,
      },
    ],
  },
  {
    name: "obsidian",
    category: "办公与写作",
    description: "连通您的本地离线 Obsidian 笔记库。AI 助手可以直接读取双链 Markdown 笔记、查找特定的笔记标签或安全地写入更新新的工作日志与文档。",
    command: "npx",
    args: ["-y", "mcp-obsidian"],
    tools: ["obsidian_search", "obsidian_read_note", "obsidian_write_note"],
    envVars: [
      {
        name: "OBSIDIAN_VAULT_PATH",
        label: "Obsidian Vault 文件夹绝对路径",
        placeholder: "请输入您的本地 Obsidian Vault 文件夹物理绝对路径",
        required: true,
        isPath: true,
      },
    ],
  },
  {
    name: "git",
    category: "开发与数据",
    description: "极度实用的本地 Git 信息流。支持查询当前仓库的分支列表、跟踪未暂存的修改 diff、自创优雅专业的 Commit 提交信息等。",
    command: "npx",
    args: ["-y", "mcp-server-git"],
    tools: ["git_status", "git_diff", "git_commit", "git_log"],
  },
  {
    name: "sentry",
    category: "开发与数据",
    description: "连接 Sentry 线上监控系统。支持让 AI 直接查询崩溃日志详情、定位最频繁触发的运行时异常，并辅助推导具体的线上修复建议。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sentry"],
    tools: ["sentry_get_issues", "sentry_get_events", "sentry_resolve_issue"],
    envVars: [
      {
        name: "SENTRY_AUTH_TOKEN",
        label: "Sentry Auth Token",
        placeholder: "请输入您的 Sentry 授权凭证 Token",
        required: true,
      },
      {
        name: "SENTRY_ORG",
        label: "Sentry 组织 Slug 名称",
        placeholder: "请输入 Sentry 组织的 slug 缩写",
        required: true,
      },
    ],
  },
  {
    name: "airtable",
    category: "办公与写作",
    description: "对接 Airtable 多维表格系统。支持列出 Base 列表、检索 Schema，以及跨表格快速追加、修改数据记录，完美贴合低代码流转。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-airtable"],
    tools: ["airtable_list_bases", "airtable_get_records", "airtable_create_record"],
    envVars: [
      {
        name: "AIRTABLE_API_KEY",
        label: "Airtable Access Token",
        placeholder: "请输入以 pat. 开头的 Airtable API 凭证",
        required: true,
      },
    ],
  },
  {
    name: "everything",
    category: "智能辅助",
    description: "官方提供的全功能调试与演示 MCP 服务。它内置了几乎所有标准所支持的工具形态、资源格式及系统 Prompt 注册，极其适合学习和系统排错。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    tools: ["everything_echo", "everything_get_status", "everything_test"],
  },
  {
    name: "google-drive",
    category: "办公与写作",
    description: "读取和搜索云端硬碟（Google Drive）的文件内容，让 AI 能跨网盘存取参考资料。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gdrive"],
    tools: ["gdrive_list_files", "gdrive_get_file_content", "gdrive_search_files"],
  },
];
