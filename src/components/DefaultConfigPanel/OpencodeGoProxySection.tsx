import { QuestionCircleOutlined } from "@ant-design/icons";
import {
  Alert,
  AutoComplete,
  Button,
  Collapse,
  Input,
  InputNumber,
  Select,
  Spin,
  Switch,
  Typography,
} from "antd";
import { useMemo } from "react";
import { HoverHint } from "../shared/HoverHint";
import {
  OPENCODE_GO_PROXY_REF_URL,
  OPENCODE_GO_PROXY_DEFAULT_PORT,
  OPENCODE_GO_SIGNUP_URL,
} from "../../services/opencodeGoProxy";
import { useOpencodeGoProxySetting } from "./useOpencodeGoProxySetting";
import type { OpencodeGoProxySettingController } from "./useOpencodeGoProxySetting";
import "./OpencodeGoProxySection.css";

interface Props {
  /** 顶栏 Popover 内嵌：隐藏区块标题行 */
  embedded?: boolean;
  /** 顶栏与 Section 共用同一 controller，避免重复拉状态 */
  proxy?: OpencodeGoProxySettingController;
}

function hasAdvancedDraft(
  upstreamUrlDraft: string,
  modelOverridesDraft: string,
  debugDraft: boolean,
): boolean {
  return (
    upstreamUrlDraft.trim().length > 0 ||
    modelOverridesDraft.trim().length > 0 ||
    debugDraft
  );
}

function OpencodeGoProxySectionInner({
  embedded = false,
  proxy,
}: {
  embedded?: boolean;
  proxy: OpencodeGoProxySettingController;
}) {
  const st = proxy.status;
  const disabled = proxy.loading || proxy.busy;
  const running = st?.running === true;
  const canStart = !disabled && (proxy.apiKeyDraft.trim().length > 0 || st?.hasApiKey);
  const canSave = !disabled && !running && proxy.modelOverridesValid;
  const isZen = proxy.providerDraft === "opencode-zen";
  const controlSize = "small";
  const portValue =
    proxy.portDraft > 0 ? proxy.portDraft : OPENCODE_GO_PROXY_DEFAULT_PORT;
  const advancedActive = useMemo(
    () =>
      hasAdvancedDraft(
        proxy.upstreamUrlDraft,
        proxy.modelOverridesDraft,
        proxy.debugDraft,
      ),
    [proxy.upstreamUrlDraft, proxy.modelOverridesDraft, proxy.debugDraft],
  );

  const advancedPanel = (
    <div className="app-default-config-ocgo__advanced">
      <label className="app-default-config-ocgo__field">
        <span className="app-default-config-ocgo__label">自定义上游 URL</span>
        <Input
          size={controlSize}
          placeholder={st?.defaultUpstreamUrl || "留空使用官方默认端点"}
          value={proxy.upstreamUrlDraft}
          disabled={disabled}
          onChange={(e) => proxy.setUpstreamUrlDraft(e.target.value)}
          spellCheck={false}
        />
      </label>
      <label className="app-default-config-ocgo__field">
        <span className="app-default-config-ocgo__label">模型覆盖（JSON）</span>
        <Input.TextArea
          size={controlSize}
          rows={2}
          className="app-default-config-ocgo__json"
          placeholder={'{"claude-sonnet-4-8":{"modelId":"…","provider":"opencode-zen"}}'}
          value={proxy.modelOverridesDraft}
          disabled={disabled}
          onChange={(e) => proxy.setModelOverridesDraft(e.target.value)}
          spellCheck={false}
        />
      </label>
      <div className="app-default-config-ocgo__debug-inline">
        <HoverHint title="在终端输出路由决策；HTTP 抓包见「流量」Tab。">
          <span className="app-default-config-ocgo__label">调试日志</span>
        </HoverHint>
        <Switch
          size="small"
          disabled={disabled}
          checked={proxy.debugDraft}
          onChange={(checked) => proxy.setDebugDraft(checked)}
        />
      </div>
    </div>
  );

  return (
    <div
      className={
        "app-default-config-ocgo" + (embedded ? " app-default-config-ocgo--embedded" : "")
      }
      aria-label="OpenCode 代理"
    >
      {!embedded ? (
        <div className="app-default-config-ocgo__head">
          <span className="app-default-config-ocgo__title-group">
            <span className="app-default-config-ocgo__title">OpenCode 代理</span>
            <HoverHint
              title={
                <>
                  Wise 内置 Anthropic 兼容代理，支持 OpenCode Go 与 Zen（参考{" "}
                  <Typography.Link href={OPENCODE_GO_PROXY_REF_URL} target="_blank" rel="noreferrer">
                    oc-go-cc
                  </Typography.Link>
                  ）；无需安装外部进程。
                </>
              }
            >
              <button
                type="button"
                className="app-default-config-ocgo__help"
                aria-label="OpenCode 代理说明"
              >
                <QuestionCircleOutlined />
              </button>
            </HoverHint>
          </span>
          {proxy.loading && !st ? (
            <Spin size="small" />
          ) : (
            <span
              className={
                "app-default-config-ocgo__badge" +
                (running ? " app-default-config-ocgo__badge--on" : "")
              }
            >
              {running ? "运行中" : "已停止"}
            </span>
          )}
        </div>
      ) : null}

      {!embedded ? (
        <p className="app-default-config-ocgo__hint">
          在{" "}
          <Typography.Link href={OPENCODE_GO_SIGNUP_URL} target="_blank" rel="noreferrer">
            OpenCode
          </Typography.Link>{" "}
          获取 API Key 后启动；将自动同步 Claude settings 与 Codex config（亦可手动点同步）。
          {st?.proxyBaseUrl ? ` 本地：${st.proxyBaseUrl}` : null}
        </p>
      ) : null}

      {proxy.proxyConflictMessage ? (
        <Alert
          type="warning"
          showIcon
          className="app-default-config-ocgo__conflict"
          message="Anthropic 代理路由冲突"
          description={proxy.proxyConflictMessage}
        />
      ) : null}

      <div className="app-default-config-ocgo__form">
        <label className="app-default-config-ocgo__field app-default-config-ocgo__field--api-key">
          <span className="app-default-config-ocgo__label">
            API Key
            {embedded ? (
              <>
                {" · "}
                <Typography.Link
                  href={OPENCODE_GO_SIGNUP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="app-default-config-ocgo__label-link"
                >
                  获取
                </Typography.Link>
              </>
            ) : null}
          </span>
          <Input.Password
            size={controlSize}
            placeholder={
              running
                ? "请先停止代理再修改"
                : st?.hasApiKey
                  ? "已保存（留空则不修改）"
                  : "sk-opencode-…"
            }
            value={proxy.apiKeyDraft}
            disabled={disabled || running}
            onChange={(e) => proxy.setApiKeyDraft(e.target.value)}
            autoComplete="off"
          />
        </label>

        <div className="app-default-config-ocgo__row app-default-config-ocgo__row--route">
          <label className="app-default-config-ocgo__field">
            <span className="app-default-config-ocgo__label">上游</span>
            <Select
              size={controlSize}
              disabled={disabled || running}
              value={proxy.providerDraft}
              options={[
                { value: "opencode-go", label: "OpenCode Go" },
                { value: "opencode-zen", label: "OpenCode Zen" },
              ]}
              onChange={(v) => {
                proxy.setProviderDraft(v);
                if (st?.hasApiKey || proxy.apiKeyDraft.trim()) {
                  void proxy.fetchRemoteModels(v);
                }
              }}
              style={{ width: "100%" }}
            />
          </label>
          <label className="app-default-config-ocgo__field">
            <span className="app-default-config-ocgo__label">
              默认模型
              <Button
                type="link"
                size={controlSize}
                className="app-default-config-ocgo__inline-action"
                disabled={disabled || (!st?.hasApiKey && !proxy.apiKeyDraft.trim())}
                loading={proxy.remoteModelsLoading}
                onClick={() => void proxy.fetchRemoteModels()}
              >
                刷新
              </Button>
            </span>
            <AutoComplete
              size={controlSize}
              className="app-default-config-ocgo__model-autocomplete"
              placeholder={isZen ? "claude-sonnet-4-8" : "kimi-k2.6"}
              value={proxy.defaultModelDraft}
              disabled={disabled}
              options={proxy.defaultModelOptions}
              filterOption={false}
              onChange={(value) => proxy.setDefaultModelDraft(value)}
              onSelect={(value) => void proxy.switchDefaultModel(String(value))}
              onBlur={() => proxy.commitDefaultModelIfRunning()}
            />
          </label>
          <label className="app-default-config-ocgo__field app-default-config-ocgo__field--port">
            <span className="app-default-config-ocgo__label">端口</span>
            <InputNumber
              size={controlSize}
              min={1024}
              max={65535}
              value={portValue}
              disabled={disabled || running}
              onChange={(v) =>
                proxy.setPortDraft(
                  typeof v === "number" && v > 0 ? v : OPENCODE_GO_PROXY_DEFAULT_PORT,
                )
              }
              style={{ width: "100%" }}
            />
          </label>
        </div>

        <label className="app-default-config-ocgo__field app-default-config-ocgo__field--fallback">
          <span className="app-default-config-ocgo__label">备用模型</span>
          <Select
            mode="multiple"
            size={controlSize}
            className="app-default-config-ocgo__fallback-select"
            placeholder={
              proxy.fallbackModelOptions.length > 0 ? "熔断时按序尝试" : "请先刷新模型列表"
            }
            value={proxy.fallbackModelsDraft}
            disabled={disabled}
            options={proxy.fallbackModelOptions}
            maxTagCount="responsive"
            optionFilterProp="label"
            showSearch
            onChange={(values) => proxy.setFallbackModelsDraft(values)}
            style={{ width: "100%" }}
          />
        </label>

        <Collapse
          ghost
          size="small"
          className="app-default-config-ocgo__more"
          defaultActiveKey={advancedActive ? ["more"] : []}
          items={[
            {
              key: "more",
              label: "更多选项",
              children: advancedPanel,
            },
          ]}
        />
      </div>

      <div
        className={
          "app-default-config-ocgo__actions" +
          (embedded ? " app-default-config-ocgo__actions--embedded" : "")
        }
      >
        <Button
          type="primary"
          size={controlSize}
          disabled={!canStart || running}
          onClick={() => void proxy.saveAndStart()}
        >
          启动
        </Button>
        <Button size={controlSize} disabled={disabled || !running} onClick={() => void proxy.stop()}>
          停止
        </Button>
        <Button size={controlSize} disabled={!canSave} onClick={() => void proxy.saveConfig()}>
          保存
        </Button>
        <Button
          size={controlSize}
          disabled={disabled || !running}
          onClick={() => void proxy.applyClientSettings()}
        >
          同步全部
        </Button>
        <Button
          size={controlSize}
          disabled={disabled || !running}
          onClick={() => void proxy.applyClaudeSettings()}
        >
          仅 Claude
        </Button>
        <Button
          size={controlSize}
          disabled={disabled || !running}
          onClick={() => void proxy.applyCodexSettings()}
        >
          仅 Codex
        </Button>
        <Button
          size={controlSize}
          disabled={disabled || (!st?.hasApiKey && !proxy.apiKeyDraft.trim())}
          onClick={() => void proxy.validateConfig()}
        >
          校验
        </Button>
        {!embedded ? (
          <Button size={controlSize} disabled={disabled} onClick={() => void proxy.refresh()}>
            刷新
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function OpencodeGoProxySectionWithHook({ embedded = false }: { embedded?: boolean }) {
  const proxy = useOpencodeGoProxySetting();
  return <OpencodeGoProxySectionInner embedded={embedded} proxy={proxy} />;
}

/** 默认配置 / 顶栏：Wise 内置 OpenCode Go / Zen 代理。 */
export function OpencodeGoProxySection({ embedded = false, proxy: proxyProp }: Props = {}) {
  if (proxyProp) {
    return <OpencodeGoProxySectionInner embedded={embedded} proxy={proxyProp} />;
  }
  return <OpencodeGoProxySectionWithHook embedded={embedded} />;
}
