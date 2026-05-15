import { Empty, Typography } from "antd";

interface ValidationIssueListProps {
  issues: Array<{ path: string; message: string }>;
}

export function ValidationIssueList({ issues }: ValidationIssueListProps) {
  if (issues.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无校验问题" />;
  }
  return (
    <ul className="mission-validation-list">
      {issues.map((issue, index) => (
        <li key={`${issue.path}-${index}`}>
          <Typography.Text code>{issue.path}</Typography.Text>: {issue.message}
        </li>
      ))}
    </ul>
  );
}
