import { Alert, Button, Form, Input, Modal, Select, Space, Tag } from "antd";
import type { FormInstance } from "antd";
import type { HookImportFormValues } from "./types";

interface HooksImportModalProps {
  open: boolean;
  form: FormInstance<HookImportFormValues>;
  importing: boolean;
  importStep: 1 | 2 | 3;
  importReport: {
    validCount: number;
    invalidCount: number;
    errors: string[];
  } | null;
  importDryRun: {
    addCount: number;
    deleteCount: number;
  } | null;
  importExecutionLog: string[];
  importFailedCount: number;
  onClose: () => void;
  onPreview: () => void;
  onImport: () => void;
  onCopyLog: () => void;
  onCopyFailedAsReplayJson: () => void;
  onFillFailedAsReplayJson: () => void;
  onRetryFailedImports: () => void;
}

export function HooksImportModal({
  open,
  form,
  importing,
  importStep,
  importReport,
  importDryRun,
  importExecutionLog,
  importFailedCount,
  onClose,
  onPreview,
  onImport,
  onCopyLog,
  onCopyFailedAsReplayJson,
  onFillFailedAsReplayJson,
  onRetryFailedImports,
}: HooksImportModalProps) {
  return (
    <Modal
      title="导入 Hooks（追加）"
      open={open}
      onCancel={onClose}
      onOk={onImport}
      confirmLoading={importing}
      width={520}
      destroyOnHidden
      okButtonProps={{ style: { display: "none" } }}
    >
      <Form form={form} layout="vertical" size="small" colon={false}>
        <Form.Item>
          <Alert
            type="info"
            showIcon
            message="导入步骤"
            description={
              importStep === 1
                ? "Step 1/3：粘贴 JSON 并点击「预校验」"
                : importStep === 2
                  ? "Step 2/3：确认预校验与 Dry-run 结果"
                  : "Step 3/3：执行导入并查看执行日志/失败重试"
            }
          />
        </Form.Item>
        <Form.Item name="scope" label="导入到范围" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "user", label: "user" },
              { value: "project", label: "project" },
              { value: "local", label: "local" },
            ]}
          />
        </Form.Item>
        <Form.Item name="mode" label="导入模式" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "append", label: "追加（保留现有）" },
              { value: "overwrite_event", label: "覆盖同事件（先删后导）" },
            ]}
          />
        </Form.Item>
        <Form.Item name="payload" label="JSON 内容" rules={[{ required: true, message: "请粘贴 JSON" }]}>
          <Input.TextArea rows={12} placeholder='{"disableAllHooks":false,"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"echo hi"}]}]}}' />
        </Form.Item>
        <Form.Item>
          <Space size={8}>
            <Button onClick={onPreview}>预校验</Button>
            <Button type="primary" onClick={onImport} disabled={!importReport || importReport.validCount <= 0} loading={importing}>
              执行导入
            </Button>
            {importReport ? (
              <>
                <Tag variant="filled" color={importReport.validCount > 0 ? "success" : "default"}>
                  可导入: {importReport.validCount}
                </Tag>
                <Tag variant="filled" color={importReport.invalidCount > 0 ? "warning" : "default"}>
                  无效: {importReport.invalidCount}
                </Tag>
              </>
            ) : null}
          </Space>
        </Form.Item>
        {importDryRun ? (
          <Form.Item label="Dry-run 影响">
            <Space size={8}>
              <Tag variant="filled" color="success">
                预计新增: {importDryRun.addCount}
              </Tag>
              <Tag variant="filled" color={importDryRun.deleteCount > 0 ? "warning" : "default"}>
                预计删除: {importDryRun.deleteCount}
              </Tag>
            </Space>
          </Form.Item>
        ) : null}
        {importReport?.errors?.length ? (
          <Form.Item label="预校验问题（最多显示 20 条）">
            <div className="app-hooks-import-errors">
              {importReport.errors.map((err) => (
                <div key={err}>{err}</div>
              ))}
            </div>
          </Form.Item>
        ) : null}
        {importExecutionLog.length > 0 ? (
          <Form.Item label="执行日志">
            <div className="app-hooks-import-log-head">
              <Button size="small" onClick={onCopyLog}>
                复制日志
              </Button>
              <Button size="small" onClick={onCopyFailedAsReplayJson} disabled={importFailedCount === 0}>
                复制失败项 JSON
              </Button>
              <Button size="small" onClick={onFillFailedAsReplayJson} disabled={importFailedCount === 0}>
                回填失败项 JSON
              </Button>
              <Button size="small" onClick={onRetryFailedImports} disabled={importFailedCount === 0} loading={importing}>
                重试失败项（{importFailedCount}）
              </Button>
            </div>
            <div className="app-hooks-import-errors">
              {importExecutionLog.map((line, idx) => (
                <div key={`${idx}-${line}`}>{line}</div>
              ))}
            </div>
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
}
