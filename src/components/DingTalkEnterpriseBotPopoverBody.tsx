import { Button, Collapse, Divider, Input, Space, Typography, message } from "antd";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { openExternalUrl } from "../services/openExternal";
import {
  dingtalkEnterpriseBotOtoSendMarkdown,
  dingtalkEnterpriseBotPing,
  loadDingTalkEnterpriseBotConfig,
  saveDingTalkEnterpriseBotConfig,
  type DingTalkEnterpriseBotStoredConfig,
} from "../services/dingtalkEnterpriseBot";
import { WISE_AUTOMATION_MARKER_DINGTALK_V1 } from "../constants/dingtalkWiseAutomation";
import { wiseNotificationIngest, wisePushStart, wisePushStop } from "../services/wiseMascot";
import "./DingTalkEnterpriseBotPopoverBody.css";

const DOC_CREATE = "https://open.dingtalk.com/document/orgapp/the-creation-and-installation-of-the-application-robot-in-the.md";
const DOC_ACCESS_TOKEN = "https://open.dingtalk.com/document/orgapp/obtain-the-access_token-of-an-internal-app";
const DOC_ROBOT_OVERVIEW = "https://open.dingtalk.com/document/orgapp/robot-overview";
const DOC_QUERY_USER = "https://developers.dingtalk.com/document/orgapp/query-user-details";
const URL_DEV_CONSOLE = "https://open-dev.dingtalk.com/";
const URL_ADMIN_CONTACT = "https://oa.dingtalk.com/#/contacts";
/** 钉钉推荐：Stream 模式推送服务端 */
const DOC_DINGTALK_STREAM_PUSH = "https://open.dingtalk.com/document/orgapp/develop-stream-mode-push-server";
/** 机器人接收消息（事件字段说明） */
const DOC_ROBOT_RECEIVE_MESSAGE = "https://developers.dingtalk.com/document/orgapp/robot-receive-message";

function FieldGuide({ children }: { children: ReactNode }) {
  return <div className="app-dingtalk-ebot-popover__field-guide">{children}</div>;
}

function buildDingTalkAutomationIngestSampleBody(dingTalkUserIdPlaceholder: string): string {
  return JSON.stringify(
    {
      wiseAutomation: WISE_AUTOMATION_MARKER_DINGTALK_V1,
      dingTalkUserId: dingTalkUserIdPlaceholder,
      prompt: "用一句话回复「收到」即可。",
      repositoryName: "",
    },
    null,
    2,
  );
}

export function DingTalkEnterpriseBotPopoverBody() {
  const loadedRef = useRef<DingTalkEnterpriseBotStoredConfig | null>(null);
  const [appKey, setAppKey] = useState("");
  const [appSecretInput, setAppSecretInput] = useState("");
  const [robotCode, setRobotCode] = useState("");
  const [defaultUserId, setDefaultUserId] = useState("");
  const [testUserId, setTestUserId] = useState("");
  const [testTitle, setTestTitle] = useState("Wise 通知");
  const [testText, setTestText] = useState("这是一条来自 Wise 的测试 Markdown。\n\n处理完成后可由你的业务逻辑调用本接口将结果发回钉钉。");
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [debugIngestJson, setDebugIngestJson] = useState("");
  const [pushWsUrl, setPushWsUrl] = useState("");
  const [pushBearerToken, setPushBearerToken] = useState("");
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const cfg = await loadDingTalkEnterpriseBotConfig();
      loadedRef.current = cfg;
      if (cfg) {
        setAppKey(cfg.appKey ?? "");
        setRobotCode(cfg.robotCode ?? "");
        setDefaultUserId(cfg.defaultUserId ?? "");
        setTestUserId(cfg.defaultUserId ?? "");
      }
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setDebugIngestJson((prev) => {
      if (prev.trim() !== "") return prev;
      const uid = defaultUserId.trim() || testUserId.trim() || "你的钉钉userid";
      return buildDingTalkAutomationIngestSampleBody(uid);
    });
  }, [hydrated, defaultUserId, testUserId]);

  const handleSave = useCallback(async () => {
    const secret =
      appSecretInput.trim().length > 0 ? appSecretInput.trim() : loadedRef.current?.appSecret?.trim() ?? "";
    if (!appKey.trim()) {
      message.warning("请填写 AppKey");
      return;
    }
    if (!secret) {
      message.warning("请填写 AppSecret，或沿用已保存密钥（本次不改密钥时留空）");
      return;
    }
    if (!robotCode.trim()) {
      message.warning("请填写 robotCode");
      return;
    }
    const next: DingTalkEnterpriseBotStoredConfig = {
      appKey: appKey.trim(),
      appSecret: secret,
      robotCode: robotCode.trim(),
      defaultUserId: defaultUserId.trim() || undefined,
    };
    setLoading(true);
    try {
      await saveDingTalkEnterpriseBotConfig(next);
      loadedRef.current = next;
      setAppSecretInput("");
      message.success("已保存（凭证存于本机 Wise 数据库）");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [appKey, appSecretInput, defaultUserId, robotCode]);

  const handlePing = useCallback(async () => {
    const secret =
      appSecretInput.trim().length > 0 ? appSecretInput.trim() : loadedRef.current?.appSecret?.trim() ?? "";
    if (!appKey.trim() || !secret) {
      message.warning("请先填写 AppKey 与 AppSecret（或沿用已保存密钥）");
      return;
    }
    setLoading(true);
    try {
      await dingtalkEnterpriseBotPing(appKey, secret);
      message.success("已换取 access_token，凭证有效");
    } catch (e) {
      message.error(typeof e === "string" ? e : e instanceof Error ? e.message : "连接失败");
    } finally {
      setLoading(false);
    }
  }, [appKey, appSecretInput]);

  const handleSendTest = useCallback(async () => {
    const secret =
      appSecretInput.trim().length > 0 ? appSecretInput.trim() : loadedRef.current?.appSecret?.trim() ?? "";
    const uid = testUserId.trim() || defaultUserId.trim();
    if (!appKey.trim() || !secret || !robotCode.trim()) {
      message.warning("请先填写 AppKey、AppSecret、robotCode（或沿用已保存密钥）");
      return;
    }
    if (!uid) {
      message.warning("请填写接收人 userid");
      return;
    }
    setLoading(true);
    try {
      const r = await dingtalkEnterpriseBotOtoSendMarkdown({
        appKey,
        appSecret: secret,
        robotCode,
        userIds: [uid],
        title: testTitle.trim() || "Wise",
        text: testText.trim() || " ",
      });
      const hint = r.processQueryKey ? `processQueryKey: ${r.processQueryKey}` : "已提交";
      message.success(hint);
      if (r.invalidStaffIdList?.length) {
        message.warning(`无效 userid: ${r.invalidStaffIdList.join(", ")}`);
      }
    } catch (e) {
      message.error(typeof e === "string" ? e : e instanceof Error ? e.message : "发送失败");
    } finally {
      setLoading(false);
    }
  }, [appKey, appSecretInput, defaultUserId, robotCode, testText, testTitle, testUserId]);

  const handleSimulateGatewayIngest = useCallback(async () => {
    const body = debugIngestJson.trim();
    if (!body.startsWith("{")) {
      message.warning("body 须为 JSON 对象字符串（以 { 开头）");
      return;
    }
    setLoading(true);
    try {
      const sid =
        typeof globalThis.crypto?.randomUUID === "function"
          ? `dingtalk-debug-${globalThis.crypto.randomUUID()}`
          : `dingtalk-debug-${Date.now()}`;
      await wiseNotificationIngest({
        conversationId: "dingtalk-e2e-debug",
        body,
        serverMsgId: sid,
      });
      message.success("已调用 wise_notification_ingest；桌面端主窗应聚焦并出现钉钉自动化 loading");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [debugIngestJson]);

  const handleWisePushConnect = useCallback(async () => {
    const u = pushWsUrl.trim();
    if (!u) {
      message.warning("请填写 WebSocket 地址（wss://…）");
      return;
    }
    setPushBusy(true);
    try {
      await wisePushStart(u, pushBearerToken.trim() || null);
      message.success("已启动推送客户端（断线后内置逻辑会重试重连）");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPushBusy(false);
    }
  }, [pushBearerToken, pushWsUrl]);

  const handleWisePushStop = useCallback(async () => {
    setPushBusy(true);
    try {
      await wisePushStop();
      message.success("已停止 WebSocket 推送");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPushBusy(false);
    }
  }, []);

  if (!hydrated) {
    return <div className="app-dingtalk-ebot-popover">加载中…</div>;
  }

  const gatewayJsonSample = `{
  "wiseAutomation": "${WISE_AUTOMATION_MARKER_DINGTALK_V1}",
  "dingTalkUserId": "发送者通讯录 userid",
  "prompt": "发给 Claude Code 的指令",
  "repositoryName": "可选；与侧栏仓库名或目录名匹配"
}`;

  const guideItems = [
    {
      key: "steps",
      label: "分步配置引导（AppKey / AppSecret / robotCode / userid）",
      children: (
        <ol className="app-dingtalk-ebot-popover__steps">
          <li>
            打开{" "}
            <Typography.Link onClick={() => void openExternalUrl(URL_DEV_CONSOLE)}>钉钉开发者后台</Typography.Link>
            ，进入<strong>应用开发 → 企业内部应用</strong>，选择（或新建）你的应用。
          </li>
          <li>
            在应用内打开<strong>应用信息 / 凭证与基础信息</strong>：复制页面上的 <strong>Client ID</strong> 作为本页的{" "}
            <Typography.Text code>AppKey</Typography.Text>，复制 <strong>Client Secret</strong> 作为{" "}
            <Typography.Text code>AppSecret</Typography.Text>（若控制台仍显示「AppKey」字样，以实际字段名为准）。详见{" "}
            <Typography.Link onClick={() => void openExternalUrl(DOC_ACCESS_TOKEN)}>获取 access_token 说明</Typography.Link>。
          </li>
          <li>
            在同一应用内添加<strong>机器人</strong>能力并创建机器人，在机器人信息中复制{" "}
            <Typography.Text code>robotCode</Typography.Text>（机器人编码；与 AgentId、应用 ID 不同）。详见{" "}
            <Typography.Link onClick={() => void openExternalUrl(DOC_ROBOT_OVERVIEW)}>机器人与 robotCode</Typography.Link>
            、
            <Typography.Link onClick={() => void openExternalUrl(DOC_CREATE)}>创建与安装应用机器人</Typography.Link>。
          </li>
          <li>
            接收人需使用钉钉<strong>通讯录中的 userid</strong>：管理员可打开{" "}
            <Typography.Link onClick={() => void openExternalUrl(URL_ADMIN_CONTACT)}>管理后台通讯录</Typography.Link>
            ，点开成员后在详情中查看；也可通过{" "}
            <Typography.Link onClick={() => void openExternalUrl(DOC_QUERY_USER)}>查询用户详情</Typography.Link>{" "}
            等接口解析。勿填手机号、邮箱、<strong>unionId</strong>。
          </li>
          <li>
            使用「人与机器人单聊」发送前，接收人需在钉钉里<strong>先向该机器人发送过至少一条消息</strong>，单聊建立后再用 Wise
            测试发送。
          </li>
        </ol>
      ),
    },
    {
      key: "callback-arch",
      label: "网关与钉钉回调：从钉钉到本机 Wise",
      children: (
        <div className="app-dingtalk-ebot-popover__field-guide">
          <p>
            <strong>1. 钉钉开放平台</strong>：在「企业内部应用」里启用机器人；接收用户消息请用{" "}
            <Typography.Link onClick={() => void openExternalUrl(DOC_DINGTALK_STREAM_PUSH)}>Stream 模式推送服务端（推荐）</Typography.Link>
            或按文档配置 HTTP 回调。服务端须能访问公网（钉钉连的是你部署的域名，<strong>不能</strong>写{" "}
            <Typography.Text code>localhost</Typography.Text>，除非用内网穿透把公网 URL 指到本机）。
          </p>
          <p>
            <strong>2. 你的网关服务</strong>：在 Stream/HTTP 回调里验签后，取出用户发的文本、发送者{" "}
            <Typography.Text code>userid</Typography.Text>（勿用 unionId），拼成与下栏「网关入站」一致的{" "}
            <Typography.Text code>body</Typography.Text> JSON 字符串。事件字段可参考{" "}
            <Typography.Link onClick={() => void openExternalUrl(DOC_ROBOT_RECEIVE_MESSAGE)}>机器人接收消息</Typography.Link>。
          </p>
          <p>
            <strong>3. 送达 Wise 桌面端</strong>：钉钉<strong>不会</strong>直接调本机 HTTP。可选接法：
          </p>
          <ul className="app-dingtalk-ebot-popover__bullet-list">
            <li>
              <strong>内嵌 Stream 网关（个人/小团队）</strong>：见下方「内嵌钉钉 Stream 网关」—— Wise 用已保存的 AppKey / AppSecret 主动连钉钉
              Stream，收机器人文本后自动入库并驱动 Claude（无需公网服务器）。
            </li>
            <li>
              <strong>自建 WebSocket 中继</strong>：钉钉 HTTP/Stream 进你的云网关后，向本机 Wise 的 WS 客户端推送一行 JSON（见「可选：连接云端推送」）。
            </li>
            <li>
              <strong>联调</strong>：用「模拟网关入站」调用 <Typography.Text code>wise_notification_ingest</Typography.Text> 验证流程。
            </li>
          </ul>
        </div>
      ),
    },
    {
      key: "gateway",
      label: "网关入站：用 JSON 驱动 Claude 并发回钉钉",
      children: (
        <div className="app-dingtalk-ebot-popover__field-guide">
          <p>
            服务端收到钉钉用户消息后，调用 Wise 的{" "}
            <Typography.Text code>wise_notification_ingest</Typography.Text>，将{" "}
            <Typography.Text code>body</Typography.Text> 设为整段 JSON 字符串（示例见下）。字段合法时主窗即会执行；入库用于未读与去重（带{" "}
            <Typography.Text code>serverMsgId</Typography.Text> 且重复时仍会为自动化派发事件）。桌面端对多条自动化请求<strong>排队串行</strong>处理：上一条（含走
            Claude 的回合完全结束）完成后才会执行下一条。
          </p>
          <pre className="app-dingtalk-ebot-popover__json-sample">{gatewayJsonSample}</pre>
          <p>
            省略 <Typography.Text code>repositoryName</Typography.Text> 时，使用侧栏<strong>当前选中仓库</strong>；若当前项目下仅有一个仓库，也会默认该仓库。
          </p>
          <p>
            主窗会为匹配到的仓库打开/绑定<strong>主会话标签</strong>并执行 <Typography.Text code>prompt</Typography.Text>；处理过程中会显示全局
            loading。回发钉钉规则：<Typography.Text code>dingTalkUserId</Typography.Text> 单聊 Markdown；若本轮相对入站前新增的助手气泡数<strong>不超过
            2</strong>，则<strong>每条新助手气泡</strong>一旦有可见正文就立即发一条（不必等整轮结束）；若超过 <strong>2</strong> 条，则运行中不在钉钉侧逐条刷屏，仅在
            <strong>本轮结束后发最后一条</strong>助手总结（取最后一条助手气泡的合并可见正文，经去噪后全文发出；会话尚未写入时再用流式缓冲兜底，并与流式预览取长避免空回执）。整轮结束后关闭 loading。
          </p>
          <p>
            <strong>不入 Claude 的快捷指令</strong>（主窗在启动 Claude 前识别；可带行首 <Typography.Text code>@机器人</Typography.Text>、
            <Typography.Text code>请</Typography.Text>/<Typography.Text code>一下</Typography.Text> 等短前缀/尾缀，全文不宜过长）：
          </p>
          <ul className="app-dingtalk-ebot-popover__bullet-list">
            <li>
              <Typography.Text code>查询仓库</Typography.Text>、<Typography.Text code>查看仓库</Typography.Text>、
              <Typography.Text code>仓库列表</Typography.Text>、<Typography.Text code>列出仓库</Typography.Text>
              等 → 返回当前 Wise 已添加仓库的 Markdown 列表。
            </li>
            <li>
              <Typography.Text code>新建会话</Typography.Text> / <Typography.Text code>新开会话</Typography.Text> /{" "}
              <Typography.Text code>创建会话</Typography.Text> / <Typography.Text code>新建标签</Typography.Text>
              ：可带仓库名（同「切换仓库」写法）；仅命令时依赖侧栏默认仓库或 JSON 的{" "}
              <Typography.Text code>repositoryName</Typography.Text>；带名时在<strong>全部仓库</strong>中匹配。→
              新建空白会话、绑定为该仓库主会话并打开，钉钉回复「消息已处理完成」，不启动 Claude。
            </li>
            <li>
              <Typography.Text code>切换仓库</Typography.Text> / <Typography.Text code>换仓库</Typography.Text> /{" "}
              <Typography.Text code>切换到 xxx</Typography.Text>
              ：可 <Typography.Text code>切换仓库 my-app</Typography.Text>、<Typography.Text code>请换仓库：my-app</Typography.Text>；或首行仅命令、
              <strong>次行写仓库名</strong>（与钉钉里 @ 机器人后换行常见）；也可仅用命令并在 JSON 填{" "}
              <Typography.Text code>repositoryName</Typography.Text>。行首 <Typography.Text code>@机器人</Typography.Text> 后可无空格。
              → 在<strong>全部已添加仓库</strong>中匹配名称（可跨项目），自动选中并切换侧栏项目、打开/绑定主会话，并钉钉回复「消息已处理完成」。
            </li>
          </ul>
        </div>
      ),
    },
  ];

  const advancedItems = [
    {
      key: "debug",
      label: "联调入站",
      children: (
        <div className="app-dingtalk-ebot-popover__advanced-block">
          <Typography.Text strong className="app-dingtalk-ebot-popover__section-title">
            调试 JSON
          </Typography.Text>
          <Input.TextArea
            size="small"
            rows={8}
            value={debugIngestJson}
            onChange={(e) => setDebugIngestJson(e.target.value)}
            className="app-dingtalk-ebot-popover__debug-json"
          />
          <Button type="primary" size="small" block loading={loading} onClick={() => void handleSimulateGatewayIngest()}>
            推送到 Wise
          </Button>
          <FieldGuide>
            字段合法时主窗会聚焦并执行。<Typography.Text code>dingTalkUserId</Typography.Text> 需要和测试发送的 userid 一致。
          </FieldGuide>
        </div>
      ),
    },
    {
      key: "push",
      label: "云端中继",
      children: (
        <div className="app-dingtalk-ebot-popover__advanced-block">
          <div className="app-dingtalk-ebot-popover__field">
            <div className="app-dingtalk-ebot-popover__label">WebSocket URL</div>
            <Input
              size="small"
              value={pushWsUrl}
              onChange={(e) => setPushWsUrl(e.target.value)}
              placeholder="wss://你的域名/wise-push?user=…"
            />
          </div>
          <div className="app-dingtalk-ebot-popover__field">
            <div className="app-dingtalk-ebot-popover__label">Authorization Bearer（可选）</div>
            <Input.Password
              size="small"
              value={pushBearerToken}
              onChange={(e) => setPushBearerToken(e.target.value)}
              placeholder="可为空"
              autoComplete="new-password"
            />
          </div>
          <Space wrap className="app-dingtalk-ebot-popover__actions">
            <Button type="primary" size="small" loading={pushBusy} onClick={() => void handleWisePushConnect()}>
              开始连接
            </Button>
            <Button size="small" loading={pushBusy} onClick={() => void handleWisePushStop()}>
              停止连接
            </Button>
          </Space>
          <pre className="app-dingtalk-ebot-popover__json-sample">
            {`{"conversationId":"dingtalk-inbound","messageId":"钉钉消息唯一id","body":"{\\"wiseAutomation\\":\\"dingtalk:v1\\",\\"dingTalkUserId\\":\\"userid\\",\\"prompt\\":\\"用户原文\\"}"}`}
          </pre>
        </div>
      ),
    },
    {
      key: "docs",
      label: "配置文档",
      children: (
        <>
          <Collapse size="small" bordered={false} className="app-dingtalk-ebot-popover__collapse" items={guideItems} />
          <FieldGuide>
            入站 body 示例：
            <pre className="app-dingtalk-ebot-popover__json-sample">{gatewayJsonSample}</pre>
          </FieldGuide>
        </>
      ),
    },
  ];

  return (
    <div className="app-dingtalk-ebot-popover">
      <Typography.Text strong className="app-dingtalk-ebot-popover__section-title">
        凭证与机器人
      </Typography.Text>

      <div className="app-dingtalk-ebot-popover__field">
        <div className="app-dingtalk-ebot-popover__label-row">
          <span className="app-dingtalk-ebot-popover__label">AppKey</span>
          <Typography.Link className="app-dingtalk-ebot-popover__label-link" onClick={() => void openExternalUrl(DOC_ACCESS_TOKEN)}>
            文档：凭证与 token
          </Typography.Link>
        </div>
        <Input size="small" value={appKey} onChange={(e) => setAppKey(e.target.value)} placeholder="一般为开发者后台「Client ID」" />
        <FieldGuide>
          路径：<Typography.Text code>开发者后台 → 企业内部应用 → 你的应用 → 应用信息</Typography.Text>。与 AppSecret 成对出现，用于换取
          access_token。
        </FieldGuide>
      </div>

      <div className="app-dingtalk-ebot-popover__field">
        <div className="app-dingtalk-ebot-popover__label-row">
          <span className="app-dingtalk-ebot-popover__label">AppSecret</span>
          <Typography.Link className="app-dingtalk-ebot-popover__label-link" onClick={() => void openExternalUrl(URL_DEV_CONSOLE)}>
            打开开发者后台
          </Typography.Link>
        </div>
        <Input.Password
          size="small"
          value={appSecretInput}
          onChange={(e) => setAppSecretInput(e.target.value)}
          placeholder={loadedRef.current?.appSecret ? "留空表示沿用已保存密钥" : "一般为「Client Secret」"}
          autoComplete="new-password"
        />
        <FieldGuide>与 AppKey 同页展示；勿泄露。保存后本地加密存储于 Wise 数据库（与密钥类设置相同风险等级）。</FieldGuide>
      </div>

      <div className="app-dingtalk-ebot-popover__field">
        <div className="app-dingtalk-ebot-popover__label-row">
          <span className="app-dingtalk-ebot-popover__label">robotCode</span>
          <Typography.Link className="app-dingtalk-ebot-popover__label-link" onClick={() => void openExternalUrl(DOC_ROBOT_OVERVIEW)}>
            文档：机器人概览
          </Typography.Link>
        </div>
        <Input size="small" value={robotCode} onChange={(e) => setRobotCode(e.target.value)} placeholder="机器人编码，如 dingxxxx…" />
        <FieldGuide>
          在应用内启用「机器人」并创建后，在机器人详情中查看 <Typography.Text code>robotCode</Typography.Text>。不是 AgentId、不是应用
          Client ID。
        </FieldGuide>
      </div>

      <div className="app-dingtalk-ebot-popover__field">
        <div className="app-dingtalk-ebot-popover__label-row">
          <span className="app-dingtalk-ebot-popover__label">默认接收人 userid（可选）</span>
          <Typography.Link className="app-dingtalk-ebot-popover__label-link" onClick={() => void openExternalUrl(URL_ADMIN_CONTACT)}>
            管理后台通讯录
          </Typography.Link>
        </div>
        <Input size="small" value={defaultUserId} onChange={(e) => setDefaultUserId(e.target.value)} placeholder="测试发送时可自动填入下方接收人" />
        <FieldGuide>
          与下方「测试发送」使用同一套 userid 规则。可留空，测试时再填。
        </FieldGuide>
      </div>

      <Space wrap className="app-dingtalk-ebot-popover__actions">
        <Button type="primary" size="small" loading={loading} onClick={() => void handleSave()}>
          保存配置
        </Button>
        <Button size="small" loading={loading} onClick={() => void handlePing()}>
          测试连接
        </Button>
      </Space>

      <Divider plain style={{ margin: "12px 0 10px", fontSize: 12 }}>
        测试发回钉钉（人与机器人单聊）
      </Divider>

      <Typography.Text strong className="app-dingtalk-ebot-popover__section-title">
        接收人 userid
      </Typography.Text>

      <div className="app-dingtalk-ebot-popover__field">
        <div className="app-dingtalk-ebot-popover__label-row">
          <span className="app-dingtalk-ebot-popover__label">接收人 userid</span>
          <Typography.Link className="app-dingtalk-ebot-popover__label-link" onClick={() => void openExternalUrl(DOC_QUERY_USER)}>
            文档：查询用户
          </Typography.Link>
        </div>
        <Input
          size="small"
          value={testUserId}
          onChange={(e) => setTestUserId(e.target.value)}
          placeholder="通讯录中的 userid（勿填手机号 / unionId）"
        />
        <FieldGuide>
          若报错 <Typography.Text code>staffId.notExisted</Typography.Text>
          ：请核对 userid 是否属于<strong>当前应用所在企业</strong>，且勿与 unionId 混淆。对方需先在钉钉内向本机器人发过消息以建立单聊。
        </FieldGuide>
      </div>
      <div className="app-dingtalk-ebot-popover__field">
        <div className="app-dingtalk-ebot-popover__label">标题</div>
        <Input size="small" value={testTitle} onChange={(e) => setTestTitle(e.target.value)} />
      </div>
      <div className="app-dingtalk-ebot-popover__field">
        <div className="app-dingtalk-ebot-popover__label">Markdown 正文</div>
        <Input.TextArea size="small" rows={4} value={testText} onChange={(e) => setTestText(e.target.value)} />
      </div>
      <Button size="small" type="primary" ghost loading={loading} block onClick={() => void handleSendTest()}>
        发送测试消息
      </Button>
      <Divider plain style={{ margin: "12px 0 4px", fontSize: 12 }}>
        高级联调
      </Divider>
      <Collapse size="small" bordered={false} className="app-dingtalk-ebot-popover__collapse" items={advancedItems} />
    </div>
  );
}
