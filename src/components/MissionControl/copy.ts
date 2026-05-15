import type { MissionPhase, TaskUserStatus } from "./presenter/types";
import type { TaskRole } from "../../types";

export const PHASE_LABEL: Record<MissionPhase, string> = {
  drafting: "编辑需求",
  planning: "需求分析",
  executing: "执行中",
  verifying: "任务确认",
  done: "已完成",
};

export const USER_STATUS_LABEL: Record<TaskUserStatus, string> = {
  queued: "等待中",
  preparing: "准备中",
  running: "进行中",
  completed: "已完成",
  blocked: "阻塞",
};

export const ROLE_LABEL: Record<TaskRole, string> = {
  frontend: "前端",
  backend: "后端",
  document: "文档",
};

export const COPY = {
  titleFallback: "新需求",
  emptyTarget: "未关联仓库",
  primaryCta: {
    openSetup: "编写需求",
    parsePrd: "分析需求",
    generateTasks: "拆分任务",
    writeTrellis: "保存任务",
    writing: "保存中…",
    openWorkflow: "查看执行编排",
  },
  header: {
    engineering: "技术详情",
    restart: "重新开始",
    close: "关闭",
  },
  columns: {
    requirements: "需求列表",
    graph: "任务编排",
  },
  engineeringDrawer: {
    title: "技术详情",
    clustersHeading: "任务分组",
    graphHeading: "工作流",
  },
  inlinePrd: {
    title: "编写 PRD",
    hint: "在此粘贴或编写产品需求文档，支持 Markdown 格式。",
    submit: "分析需求",
    importLegacy: "从历史导入",
    charCount: (n: number) => `${n} 字符`,
  },
  /** @deprecated Legacy setup drawer — replaced by inline PRD editor */
  setupDrawer: {
    title: "起草使命",
    submit: "确认 PRD，进入规划",
    targetProject: "目标项目",
    targetRepository: "目标仓库",
    participatingRepos: "参与仓位",
    prdEditor: "PRD",
    importLegacy: "从历史 PRD 导入",
  },
};
