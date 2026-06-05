import { Form } from "antd";
import { useCallback, useState } from "react";
import type { ClaudeHookHandler, ClaudeHookSourceScope, ClaudeHooksStatusResponse } from "../../types";
import { removeClaudeHook, setClaudeDisableAllHooks, upsertClaudeHook } from "../../services/claude";
import type { HookImportFormValues } from "./types";

interface HooksImportFeedback {
  warning: (content: string) => unknown;
  error: (content: string) => unknown;
  success: (content: string) => unknown;
}

interface HooksImportModalApi {
  confirm: (config: {
    title: string;
    content: string;
    okText: string;
    okType: "danger";
    cancelText: string;
    onOk: () => void;
    onCancel: () => void;
  }) => unknown;
}

interface UseHooksImportInput {
  data: ClaudeHooksStatusResponse;
  repositoryPath?: string;
  load: () => Promise<void>;
  message: HooksImportFeedback;
  modal: HooksImportModalApi;
}

interface ImportReport {
  validCount: number;
  invalidCount: number;
  errors: string[];
}

interface ParsedHooksImport {
  disableAllHooks?: boolean;
  hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<Record<string, unknown>> }>>;
}

function validateImportPayload(rawPayload: string): { parsed: ParsedHooksImport | null; report: ImportReport } {
  const errors: string[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    return {
      parsed: null,
      report: {
        validCount: 0,
        invalidCount: 1,
        errors: ["JSON 解析失败"],
      },
    };
  }
  const obj = parsed as ParsedHooksImport;
  if (!obj || typeof obj !== "object" || !obj.hooks || typeof obj.hooks !== "object") {
    return {
      parsed: null,
      report: {
        validCount: 0,
        invalidCount: 1,
        errors: ["结构不合法：需要 hooks 对象"],
      },
    };
  }
  const hooksObj = obj.hooks ?? {};
  for (const [eventName, groups] of Object.entries(hooksObj)) {
    if (!Array.isArray(groups)) {
      invalidCount += 1;
      errors.push(`${eventName}: group 不是数组`);
      continue;
    }
    for (const group of groups) {
      if (!Array.isArray(group.hooks)) {
        invalidCount += 1;
        errors.push(`${eventName}: hooks 不是数组`);
        continue;
      }
      for (const handler of group.hooks) {
        const type = typeof handler.type === "string" ? handler.type : "";
        if (!["command", "http", "prompt", "agent"].includes(type)) {
          invalidCount += 1;
          errors.push(`${eventName}: 无效 type(${String(handler.type)})`);
          continue;
        }
        if (type === "command" && typeof handler.command !== "string") {
          invalidCount += 1;
          errors.push(`${eventName}: command hook 缺少 command`);
          continue;
        }
        if (type === "http" && typeof handler.url !== "string") {
          invalidCount += 1;
          errors.push(`${eventName}: http hook 缺少 url`);
          continue;
        }
        if ((type === "prompt" || type === "agent") && typeof handler.prompt !== "string") {
          invalidCount += 1;
          errors.push(`${eventName}: ${type} hook 缺少 prompt`);
          continue;
        }
        validCount += 1;
      }
    }
  }
  return {
    parsed: obj,
    report: {
      validCount,
      invalidCount,
      errors: errors.slice(0, 20),
    },
  };
}

function normalizeImportHandler(handler: Record<string, unknown>, type: string): Omit<ClaudeHookHandler, "id"> {
  return {
    type: type as ClaudeHookHandler["type"],
    if: typeof handler.if === "string" ? handler.if : null,
    timeout: typeof handler.timeout === "number" ? handler.timeout : null,
    statusMessage: typeof handler.statusMessage === "string" ? handler.statusMessage : null,
    shell: typeof handler.shell === "string" ? (handler.shell as "bash" | "powershell") : null,
    async: typeof handler.async === "boolean" ? handler.async : null,
    asyncRewake: typeof handler.asyncRewake === "boolean" ? handler.asyncRewake : null,
    command: typeof handler.command === "string" ? handler.command : null,
    url: typeof handler.url === "string" ? handler.url : null,
    headers: handler.headers && typeof handler.headers === "object" ? (handler.headers as Record<string, string>) : null,
    allowedEnvVars: Array.isArray(handler.allowedEnvVars) ? (handler.allowedEnvVars as string[]) : null,
    prompt: typeof handler.prompt === "string" ? handler.prompt : null,
    model: typeof handler.model === "string" ? handler.model : null,
  };
}

function serializeHandler(handler: Omit<ClaudeHookHandler, "id">): Record<string, unknown> {
  const handlerJson: Record<string, unknown> = {
    type: handler.type,
  };
  if (handler.if) handlerJson.if = handler.if;
  if (handler.timeout) handlerJson.timeout = handler.timeout;
  if (handler.statusMessage) handlerJson.statusMessage = handler.statusMessage;
  if (handler.shell) handlerJson.shell = handler.shell;
  if (typeof handler.async === "boolean") handlerJson.async = handler.async;
  if (typeof handler.asyncRewake === "boolean") handlerJson.asyncRewake = handler.asyncRewake;
  if (handler.command) handlerJson.command = handler.command;
  if (handler.url) handlerJson.url = handler.url;
  if (handler.headers) handlerJson.headers = handler.headers;
  if (handler.allowedEnvVars) handlerJson.allowedEnvVars = handler.allowedEnvVars;
  if (handler.prompt) handlerJson.prompt = handler.prompt;
  if (handler.model) handlerJson.model = handler.model;
  return handlerJson;
}

export function useHooksImport({ data, repositoryPath, load, message, modal }: UseHooksImportInput) {
  const [importForm] = Form.useForm<HookImportFormValues>();
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importDryRun, setImportDryRun] = useState<{
    addCount: number;
    deleteCount: number;
  } | null>(null);
  const [importExecutionLog, setImportExecutionLog] = useState<string[]>([]);
  const [importFailedItems, setImportFailedItems] = useState<Array<{
    eventName: string;
    matcher: string | null;
    handler: Omit<ClaudeHookHandler, "id">;
    error: string;
  }>>([]);
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);

  const onPreviewImport = useCallback(async () => {
    const payload = importForm.getFieldValue("payload");
    const mode = importForm.getFieldValue("mode") as "append" | "overwrite_event" | undefined;
    const scope = (importForm.getFieldValue("scope") as ClaudeHookSourceScope | undefined) ?? "user";
    if (!payload || !String(payload).trim()) {
      message.warning("请先粘贴 JSON");
      return;
    }
    const { report, parsed } = validateImportPayload(String(payload));
    setImportReport(report);
    if (parsed) {
      const addCount = report.validCount;
      let deleteCount = 0;
      if ((mode ?? "append") === "overwrite_event") {
        const scopeData = data[scope];
        for (const eventName of Object.keys(parsed.hooks ?? {})) {
          const groups = scopeData.hooks[eventName] ?? [];
          deleteCount += groups.reduce((acc, g) => acc + g.hooks.length, 0);
        }
      }
      setImportDryRun({ addCount, deleteCount });
      setImportStep(2);
    } else {
      setImportDryRun(null);
      setImportStep(1);
    }
  }, [data, importForm, message]);

  const onImportHooks = useCallback(async () => {
    const v = await importForm.validateFields();
    const { parsed, report } = validateImportPayload(v.payload);
    setImportReport(report);
    if (!parsed) {
      message.error("导入 JSON 不合法");
      setImportStep(1);
      return;
    }
    if (report.validCount <= 0) {
      message.error("没有可导入的有效 hooks");
      setImportStep(1);
      return;
    }
    const obj = parsed;
    let deleteCount = 0;
    if (v.mode === "overwrite_event") {
      const scopeData = data[v.scope];
      for (const eventName of Object.keys(obj.hooks ?? {})) {
        const groups = scopeData.hooks[eventName] ?? [];
        deleteCount += groups.reduce((acc, g) => acc + g.hooks.length, 0);
      }
    }
    setImportDryRun({ addCount: report.validCount, deleteCount });

    if (v.mode === "overwrite_event" && deleteCount > 0) {
      const confirmed = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: "确认覆盖导入？",
          content: `将删除 ${deleteCount} 条同事件现有 hooks，并新增 ${report.validCount} 条。`,
          okText: "确认覆盖",
          okType: "danger",
          cancelText: "取消",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) {
        return;
      }
    }

    setImportExecutionLog([]);
    setImportFailedItems([]);
    setImportStep(3);
    setImporting(true);
    try {
      if (v.mode === "overwrite_event") {
        const scopeData = data[v.scope];
        for (const eventName of Object.keys(obj.hooks ?? {})) {
          const groups = scopeData.hooks[eventName] ?? [];
          setImportExecutionLog((prev) => [...prev, `[${eventName}] 覆盖模式：准备删除 ${groups.reduce((acc, g) => acc + g.hooks.length, 0)} 条`]);
          for (const group of groups) {
            for (const handler of group.hooks) {
              await removeClaudeHook({
                scope: v.scope,
                eventName,
                groupId: group.id,
                handlerId: handler.id,
                repositoryPath: repositoryPath ?? null,
              });
              setImportExecutionLog((prev) => [...prev, `[${eventName}] 已删除 ${handler.id}`]);
            }
          }
        }
      }
      if (typeof obj.disableAllHooks === "boolean") {
        await setClaudeDisableAllHooks({
          scope: v.scope,
          disableAllHooks: obj.disableAllHooks,
          repositoryPath: repositoryPath ?? null,
        });
      }
      for (const [eventName, groups] of Object.entries(obj.hooks ?? {})) {
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
          const matcher = typeof group.matcher === "string" ? group.matcher : null;
          if (!Array.isArray(group.hooks)) continue;
          for (const handler of group.hooks) {
            const type = typeof handler.type === "string" ? handler.type : "";
            if (!type) continue;
            const normalizedHandler = normalizeImportHandler(handler, type);
            try {
              await upsertClaudeHook({
                scope: v.scope,
                repositoryPath: repositoryPath ?? null,
                eventName,
                matcher,
                handler: normalizedHandler,
              });
              setImportExecutionLog((prev) => [...prev, `[${eventName}] 导入成功 type=${type} matcher=${matcher ?? "*"}`]);
            } catch (e) {
              const errorText = e instanceof Error ? e.message : String(e);
              setImportFailedItems((prev) => [
                ...prev,
                {
                  eventName,
                  matcher,
                  handler: normalizedHandler,
                  error: errorText,
                },
              ]);
              setImportExecutionLog((prev) => [
                ...prev,
                `[${eventName}] 导入失败 type=${type} matcher=${matcher ?? "*"}: ${errorText}`,
              ]);
            }
          }
        }
      }
      setImportOpen(false);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }, [data, importForm, load, message, modal, repositoryPath]);

  const onCopyImportLog = useCallback(async () => {
    if (importExecutionLog.length === 0) {
      message.warning("暂无可复制的执行日志");
      return;
    }
    const scope = importForm.getFieldValue("scope") as ClaudeHookSourceScope | undefined;
    const mode = importForm.getFieldValue("mode") as "append" | "overwrite_event" | undefined;
    const text = [
      "Hooks 导入日志",
      `time: ${new Date().toISOString()}`,
      `scope: ${scope ?? "-"}`,
      `mode: ${mode ?? "-"}`,
      "",
      ...importExecutionLog,
    ].join("\n");
    await navigator.clipboard.writeText(text);
  }, [importExecutionLog, importForm, message]);

  const onRetryFailedImports = useCallback(async () => {
    const scope = importForm.getFieldValue("scope") as ClaudeHookSourceScope | undefined;
    if (!scope) {
      message.error("缺少导入 scope，无法重试");
      return;
    }
    if (importFailedItems.length === 0) {
      message.warning("当前没有失败项");
      return;
    }
    const current = [...importFailedItems];
    setImporting(true);
    setImportFailedItems([]);
    try {
      for (const item of current) {
        try {
          await upsertClaudeHook({
            scope,
            repositoryPath: repositoryPath ?? null,
            eventName: item.eventName,
            matcher: item.matcher,
            handler: item.handler,
          });
          setImportExecutionLog((prev) => [
            ...prev,
            `[${item.eventName}] 重试成功 type=${item.handler.type} matcher=${item.matcher ?? "*"}`,
          ]);
        } catch (e) {
          const errorText = e instanceof Error ? e.message : String(e);
          setImportFailedItems((prev) => [
            ...prev,
            { ...item, error: errorText },
          ]);
          setImportExecutionLog((prev) => [
            ...prev,
            `[${item.eventName}] 重试失败 type=${item.handler.type} matcher=${item.matcher ?? "*"}: ${errorText}`,
          ]);
        }
      }
      await load();
    } finally {
      setImporting(false);
    }
  }, [importFailedItems, importForm, load, message, repositoryPath]);

  const onCopyFailedAsReplayJson = useCallback(async () => {
    const scope = importForm.getFieldValue("scope") as ClaudeHookSourceScope | undefined;
    if (!scope) {
      message.error("缺少 scope，无法导出失败项");
      return;
    }
    if (importFailedItems.length === 0) {
      message.warning("当前没有失败项");
      return;
    }
    const grouped: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>> = {};
    for (const item of importFailedItems) {
      if (!grouped[item.eventName]) grouped[item.eventName] = [];
      grouped[item.eventName].push({
        matcher: item.matcher ?? undefined,
        hooks: [serializeHandler(item.handler)],
      });
    }
    const replayJson = {
      scope,
      mode: "append",
      hooks: grouped,
      meta: {
        exportedAt: new Date().toISOString(),
        failedCount: importFailedItems.length,
      },
    };
    await navigator.clipboard.writeText(JSON.stringify(replayJson, null, 2));
  }, [importFailedItems, importForm, message]);

  const onFillFailedAsReplayJson = useCallback(() => {
    const scope = (importForm.getFieldValue("scope") as ClaudeHookSourceScope | undefined) ?? "user";
    if (importFailedItems.length === 0) {
      message.warning("当前没有失败项");
      return;
    }
    const grouped: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>> = {};
    for (const item of importFailedItems) {
      if (!grouped[item.eventName]) grouped[item.eventName] = [];
      grouped[item.eventName].push({
        matcher: item.matcher ?? undefined,
        hooks: [serializeHandler(item.handler)],
      });
    }
    const replayJson = {
      disableAllHooks: undefined,
      hooks: grouped,
      meta: {
        generatedFromFailedItems: true,
        generatedAt: new Date().toISOString(),
        failedCount: importFailedItems.length,
      },
    };
    importForm.setFieldsValue({
      scope,
      mode: "append",
      payload: JSON.stringify(replayJson, null, 2),
    });
    setImportReport(null);
    setImportDryRun(null);
  }, [importFailedItems, importForm, message]);

  return {
    importForm,
    importOpen,
    setImportOpen,
    importing,
    importReport,
    importDryRun,
    importExecutionLog,
    importFailedCount: importFailedItems.length,
    importStep,
    onPreviewImport,
    onImportHooks,
    onCopyImportLog,
    onRetryFailedImports,
    onCopyFailedAsReplayJson,
    onFillFailedAsReplayJson,
  };
}
