import { Button, Input, Select, Space, Typography } from "antd";
import type { TaskApiSpec, TaskItem } from "../../types";
import {
  API_METHOD_OPTIONS,
  buildApiSpecTemplate,
  buildRequestSchemaByMethod,
  normalizeJsonText,
} from "./helpers";

const EMPTY_SPEC: TaskApiSpec = {
  endpoint: "",
  method: "POST",
  requestSchema: "",
  responseSchema: "",
  errorCodes: [],
};

interface Props {
  value: TaskApiSpec | undefined;
  draftedTask: TaskItem;
  onChange: (spec: TaskApiSpec) => void;
}

export function TaskApiSpecEditor({ value, draftedTask, onChange }: Props) {
  const current = value ?? EMPTY_SPEC;
  const method = current.method;
  const warnNoBody = method === "GET" || method === "DELETE";

  const updateField = <K extends keyof TaskApiSpec>(field: K, fieldValue: TaskApiSpec[K]) => {
    onChange({ ...current, [field]: fieldValue });
  };

  return (
    <div className="app-prd-task-panel__task-api-spec-block">
      {warnNoBody ? (
        <Typography.Text type="warning">
          当前方法通常不使用请求体，建议优先使用 query/path 参数定义请求。
        </Typography.Text>
      ) : null}
      <Typography.Text type="secondary">接口协议（结构化）</Typography.Text>
      <Space direction="vertical" size={6} style={{ width: "100%", marginTop: 6 }}>
        <Space>
          <Button
            size="small"
            onClick={() => onChange(buildApiSpecTemplate(draftedTask))}
          >
            一键生成 REST 模板
          </Button>
        </Space>
        <Input
          size="small"
          placeholder="接口路径，例如 /api/tasks/split"
          value={current.endpoint ?? ""}
          onChange={(e) => updateField("endpoint", e.target.value)}
        />
        <Select
          size="small"
          value={current.method ?? "POST"}
          options={API_METHOD_OPTIONS.map((item) => ({ label: item, value: item }))}
          onChange={(nextMethod) => {
            const defaultPost = normalizeJsonText(buildRequestSchemaByMethod("POST", draftedTask.title));
            const defaultGet = normalizeJsonText(buildRequestSchemaByMethod("GET", draftedTask.title));
            const defaultDelete = normalizeJsonText(buildRequestSchemaByMethod("DELETE", draftedTask.title));
            const currentNormalized = normalizeJsonText(current.requestSchema);
            const shouldAutoUpdateRequest = currentNormalized.length === 0
              || currentNormalized === defaultPost
              || currentNormalized === defaultGet
              || currentNormalized === defaultDelete;
            onChange({
              ...current,
              method: nextMethod,
              requestSchema: shouldAutoUpdateRequest
                ? buildRequestSchemaByMethod(nextMethod, draftedTask.title)
                : current.requestSchema,
            });
          }}
        />
        <Input.TextArea
          rows={2}
          placeholder="请求定义（JSON Schema 或字段说明）"
          value={current.requestSchema ?? ""}
          onChange={(e) => updateField("requestSchema", e.target.value)}
        />
        <Input.TextArea
          rows={2}
          placeholder="响应定义（JSON Schema 或字段说明）"
          value={current.responseSchema ?? ""}
          onChange={(e) => updateField("responseSchema", e.target.value)}
        />
        <Input
          size="small"
          placeholder="错误码，逗号分隔，例如 400,401,500"
          value={(current.errorCodes ?? []).join(", ")}
          onChange={(e) =>
            updateField(
              "errorCodes",
              e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
            )
          }
        />
      </Space>
    </div>
  );
}
