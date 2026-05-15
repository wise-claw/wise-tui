import { Collapse, Tag, Typography } from "antd";
import type { TaskEvidenceVM } from "../presenter/types";

interface EngineeringFoldoutProps {
  evidence: TaskEvidenceVM;
}

export function EngineeringFoldout({ evidence }: EngineeringFoldoutProps) {
  return (
    <Collapse
      size="small"
      className="mission-engineering-foldout"
      items={[
        {
          key: "details",
          label: "工程细节",
          children: (
            <div className="mission-engineering-foldout__body">
              <Typography.Text code>{evidence.technical.clusterId}</Typography.Text>
              <Typography.Text>{evidence.technical.clusterTitle}</Typography.Text>
              {evidence.technical.parentTaskLabel ? <Tag>{evidence.technical.parentTaskLabel}</Tag> : null}
              {evidence.technical.taskPath ? (
                <Typography.Text className="mission-engineering-foldout__path">
                  {evidence.technical.taskPath}
                </Typography.Text>
              ) : null}
              {evidence.technical.validationIssues.length > 0 ? (
                <ul>
                  {evidence.technical.validationIssues.map((issue, index) => (
                    <li key={`${issue.path}-${index}`}>
                      <Typography.Text code>{issue.path}</Typography.Text>: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ),
        },
      ]}
    />
  );
}
