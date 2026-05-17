import type { MissionPhase, TaskUserStatus } from "./presenter/types";
import type { TaskRole } from "../../types";

export const PHASE_LABEL: Record<MissionPhase, string> = {
  drafting: "PRD 编写",
  planning: "需求分析",
  executing: "任务派发",
  verifying: "任务确认",
  done: "编排完成",
};

export const USER_STATUS_LABEL: Record<TaskUserStatus, string> = {
  queued: "就绪",
  preparing: "准备中",
  running: "执行中",
  completed: "已完成",
  blocked: "阻塞",
  cancelled: "已中断",
  stale: "疑似断连",
};

export const ROLE_LABEL: Record<TaskRole, string> = {
  frontend: "前端",
  backend: "后端",
  document: "文档",
};

export const COPY = {
  titleFallback: "未命名任务",
  emptyTarget: "未选定目标",
  primaryCta: {
    openSetup: "编写需求",
    parsePrd: "解析需求",
    generateTasks: "派发子代理",
    writeTrellis: "写入 Trellis",
    writing: "写入中…",
    openWorkflow: "启动工作流",
  },
  header: {
    engineering: "工程视图",
    restart: "重新编辑",
    close: "关闭",
  },
  columns: {
    requirements: "需求中枢",
    graph: "任务编排",
  },
  engineeringDrawer: {
    title: "需求拆分诊断",
    clustersHeading: "任务分组诊断",
    graphHeading: "Legacy workflow graph",
    diagnosticsHeading: "诊断",
  },
  inlinePrd: {
    title: "编写 PRD",
    hint: "粘贴或撰写产品需求文档。支持 Markdown，以 # 标题分隔需求条目。",
    submit: "解析需求",
    importLegacy: "导入历史",
    charCount: (n: number) => `${n} 字符`,
  },
  /** @deprecated Legacy setup drawer — replaced by inline PRD editor */
  setupDrawer: {
    title: "任务配置",
    submit: "确认并继续",
    targetProject: "目标项目",
    targetRepository: "目标仓库",
    participatingRepos: "关联仓库",
    prdEditor: "PRD",
    importLegacy: "从历史导入",
  },
};
