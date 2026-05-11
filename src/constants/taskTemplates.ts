export const DEFAULT_REPOSITORY_SPLIT_TEMPLATE =
  "请先把需求拆分为可执行的子任务清单，再逐步推进。\n仓库：{repoName}\n类型：{repoType}\n地址：{repoPath}\n\n输出格式：\n1) 任务拆分\n2) 执行顺序\n3) 风险与依赖";

export const DEFAULT_PROJECT_SPLIT_TEMPLATE =
  "这是一个跨仓库任务，请先进行任务拆分。\n\n项目：{projectName}\n仓库地址列表：\n{repoList}\n\n请输出：\n1) 子任务清单（按仓库归类）\n2) 执行顺序\n3) 每步产物与验证方式";

export const LEGACY_APP_SETTING_KEY_REPOSITORY_SPLIT_TEMPLATE = "wise.taskTemplate.repositorySplit";
export const LEGACY_APP_SETTING_KEY_PROJECT_SPLIT_TEMPLATE = "wise.taskTemplate.projectSplit";
