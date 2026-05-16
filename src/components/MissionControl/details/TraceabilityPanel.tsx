import { Empty, Tag, Typography } from "antd";
import {
  LinkOutlined,
  FileTextOutlined,
  CodeOutlined,
  BranchesOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import {
  WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE,
  type OpenRepositoryFileDetail,
} from "../../../constants/workflowUiEvents";
import type { TaskDetailVM } from "../presenter/types";

interface TraceabilityPanelProps {
  detail: TaskDetailVM;
  onOpenPrdAnchor: () => void;
}

export function TraceabilityPanel({ detail, onOpenPrdAnchor }: TraceabilityPanelProps) {
  const openCodeAnchor = (anchor: TaskDetailVM["codeAnchors"][number]) => {
    if (!anchor.filePath.trim()) return;
    const detail: OpenRepositoryFileDetail = {
      repositoryId: anchor.repositoryId,
      relativePath: anchor.filePath,
      line: anchor.line,
    };
    window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE, { detail }));
  };

  // Skip placeholder tasks — nothing to trace yet
  if (detail.subtasks.length === 0 && detail.dod.length === 0 && detail.role === null) {
    return (
      <section className="mission-evidence-section">
        <Typography.Text className="mission-evidence-section__title">追溯面板</Typography.Text>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="拆分完成后可查看完整追溯链路"
        />
      </section>
    );
  }

  const chain = buildChain(detail);

  return (
    <section className="mission-traceability">
      {/* Chain header */}
      <div className="mission-traceability__header">
        <Typography.Text className="mission-traceability__title">
          <BranchesOutlined />
          需求→任务→代码 追溯链路
        </Typography.Text>
      </div>

      {/* Step 1: Source requirements */}
      {chain.requirements.length > 0 ? (
        <div className="mission-traceability__step">
          <div className="mission-traceability__step-head">
            <FileTextOutlined />
            <span>需求来源</span>
            <Tag style={{ fontSize: 10 }}>{chain.requirements.length} 条</Tag>
          </div>
          <div className="mission-traceability__step-body">
            {chain.requirements.map((req) => (
              <div key={req.id} className="mission-traceability-node">
                <span className="mission-traceability-node__id">{req.id}</span>
                <Typography.Paragraph
                  className="mission-traceability-node__text"
                  ellipsis={{ rows: 3 }}
                >
                  {req.bodyPreview}
                </Typography.Paragraph>
                {req.isLinked ? (
                  <Tag color="success" style={{ fontSize: 9, lineHeight: "14px" }}>
                    已关联
                  </Tag>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Connector arrow */}
      {chain.requirements.length > 0 ? (
        <div className="mission-traceability__arrow">
          <ArrowRightOutlined />
        </div>
      ) : null}

      {/* Step 2: PRD Anchor */}
      <div className="mission-traceability__step">
        <div className="mission-traceability__step-head">
          <LinkOutlined />
          <span>PRD 锚点</span>
        </div>
        <div className="mission-traceability__step-body">
          {detail.prdAnchor ? (
            <div className="mission-traceability-node">
              <Typography.Paragraph
                className="mission-traceability-node__text"
                ellipsis={{ rows: 3 }}
              >
                {detail.prdAnchor.preview}
              </Typography.Paragraph>
              <div className="mission-traceability-node__meta">
                <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                  位置 {detail.prdAnchor.from} – {detail.prdAnchor.to}
                </Typography.Text>
                <button
                  type="button"
                  className="mission-traceability-link"
                  onClick={onOpenPrdAnchor}
                >
                  在 PRD 中查看
                </button>
              </div>
            </div>
          ) : (
            <div className="mission-traceability-node mission-traceability-node--empty">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                尚未建立 PRD 锚点
              </Typography.Text>
              <button
                type="button"
                className="mission-traceability-link"
                onClick={onOpenPrdAnchor}
              >
                建立锚点
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Connector arrow */}
      <div className="mission-traceability__arrow">
        <ArrowRightOutlined />
      </div>

      {/* Step 3: Current Task */}
      <div className="mission-traceability__step mission-traceability__step--current">
        <div className="mission-traceability__step-head">
          <BranchesOutlined />
          <span>当前任务</span>
          <Tag color="blue" style={{ fontSize: 10 }}>{detail.taskId}</Tag>
        </div>
        <div className="mission-traceability__step-body">
          <Typography.Text strong style={{ fontSize: 14 }}>
            {detail.title}
          </Typography.Text>
          {detail.description ? (
            <Typography.Paragraph
              type="secondary"
              style={{ fontSize: 12, marginTop: 4 }}
              ellipsis={{ rows: 2 }}
            >
              {detail.description}
            </Typography.Paragraph>
          ) : null}
          {detail.subtasks.length > 0 ? (
            <ul className="mission-traceability-sublist">
              {detail.subtasks.map((st, i) => (
                <li key={i}>{st}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {/* Step 4: Code anchors */}
      <div className="mission-traceability__arrow">
        <ArrowRightOutlined />
      </div>

      <div className="mission-traceability__step">
        <div className="mission-traceability__step-head">
          <CodeOutlined />
          <span>代码锚点</span>
          <Tag style={{ fontSize: 10 }}>{chain.codeAnchors.length}</Tag>
        </div>
        <div className="mission-traceability__step-body">
          {chain.codeAnchors.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              此任务未关联具体代码文件
            </Typography.Text>
          ) : (
            chain.codeAnchors.map((anchor, idx) => (
              <button
                key={idx}
                type="button"
                className="mission-traceability-code-btn"
                onClick={() => openCodeAnchor(anchor)}
              >
                <CodeOutlined />
                <span className="mission-traceability-code-btn__path">
                  {anchor.filePath}
                  {anchor.line != null ? `:${anchor.line}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

interface TraceChain {
  requirements: Array<{
    id: string;
    bodyPreview: string;
    isLinked: boolean;
  }>;
  codeAnchors: TaskDetailVM["codeAnchors"];
}

function buildChain(detail: TaskDetailVM): TraceChain {
  return {
    requirements: detail.sourceRequirements.map((req) => ({
      id: req.id,
      bodyPreview: req.bodyPreview,
      isLinked: true,
    })),
    codeAnchors: detail.codeAnchors,
  };
}
