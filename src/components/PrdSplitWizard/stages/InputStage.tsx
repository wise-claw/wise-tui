import { useMemo } from "react";
import { Alert, Card, Checkbox, Input, Tag, Typography } from "antd";
import type { PlannerRepo } from "../../../services/prdSplit/clusterPlanner";
import { repositoryTypeChineseLabel } from "../../../utils/repositoryType";
import type { UseSplitWizardStateApi } from "../useSplitWizardState";

interface Props {
  api: UseSplitWizardStateApi;
}

export function InputStage({ api }: Props) {
  const { state } = api;

  const reposByType = useMemo(() => {
    const groups: Record<string, PlannerRepo[]> = { frontend: [], backend: [], document: [] };
    for (const repo of state.repositories) {
      const bucket = groups[repo.type] ?? (groups[repo.type] = []);
      bucket.push(repo);
    }
    return groups;
  }, [state.repositories]);

  const projectTagLabel = state.project ? `${state.project.name}` : "（未选择项目）";

  return (
    <div className="prd-split-wizard__stage" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Alert
        type="info"
        showIcon
        message="第 1 步 · 输入 PRD"
        description={
          <Typography.Paragraph style={{ margin: 0 }}>
            将 PRD 粘贴为 Markdown，系统会自动解析「功能 / 非功能 / 验收」三类需求，按当前项目下的仓库类型与名称匹配自动归簇。
            目标项目：<Tag color="processing">{projectTagLabel}</Tag>
            {state.project?.rootPath ? <Tag>{state.project.rootPath}</Tag> : null}
          </Typography.Paragraph>
        }
      />

      <Card size="small" title="参与拆分的仓库" bordered>
        {state.repositories.length === 0 ? (
          <Typography.Text type="warning">当前项目下未识别到仓库（请在外部为项目挂载至少一个仓库再回来）。</Typography.Text>
        ) : (
          <Checkbox.Group
            value={state.selectedRepositoryIds}
            onChange={(values) => api.setSelectedRepos(values as number[])}
            style={{ display: "flex", flexWrap: "wrap", gap: 12 }}
          >
            {(["frontend", "backend", "document"] as const).map((type) => (
              <div key={type} style={{ minWidth: 200 }}>
                <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                  {repositoryTypeChineseLabel(type)}
                </Typography.Text>
                {(reposByType[type] ?? []).length === 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>—</Typography.Text>
                ) : (
                  (reposByType[type] ?? []).map((repo) => (
                    <div key={repo.id} style={{ paddingBlock: 2 }}>
                      <Checkbox value={repo.id}>
                        <Tag color={typeColor(type)} style={{ marginInlineEnd: 4 }}>
                          {repositoryTypeChineseLabel(type)}
                        </Tag>
                        {repo.name}
                      </Checkbox>
                    </div>
                  ))
                )}
              </div>
            ))}
          </Checkbox.Group>
        )}
      </Card>

      <Card size="small" title="PRD（Markdown 文本）" bordered>
        <Input.TextArea
          value={state.prdMarkdown}
          onChange={(e) => api.setPrdMarkdown(e.target.value)}
          placeholder="粘贴 PRD 全文。建议包含「## 功能需求 / ## 非功能需求 / ## 验收标准」三段。"
          autoSize={{ minRows: 10, maxRows: 24 }}
          spellCheck={false}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {state.prdMarkdown.length} 字符
        </Typography.Text>
      </Card>

      {state.globalError ? (
        <Alert type="error" showIcon message="解析或规划失败" description={state.globalError} />
      ) : null}
    </div>
  );
}

function typeColor(type: "frontend" | "backend" | "document"): string {
  if (type === "frontend") return "blue";
  if (type === "backend") return "green";
  return "purple";
}
