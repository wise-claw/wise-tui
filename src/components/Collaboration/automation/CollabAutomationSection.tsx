import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App as AntApp, Button, InputNumber, Space, Switch, Table, Tag, Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { Repository } from "../../../types";
import type { CollabAttempt, CollabRequirementSummary, CollabRuntimeResource } from "../../../types/collaboration";
import {
  attemptStateLabel,
  COLLAB_GLOBAL_LIMIT_MAX,
  COLLAB_GLOBAL_LIMIT_MIN,
  controlCollabRequirement,
  formatCollabError,
  getCollabBridgeStatus,
  getCollabTaskDetail,
  hydrateCollabAutomationSettings,
  isCollabStopOverdue,
  listActiveCollabAttempts,
  listCollabRequirements,
  listPendingCollabRuntimeStops,
  newCollabRequestId,
  onCollabChanged,
  requestCollabStop,
  requirementProgress,
  requirementStatusLabel,
  updateCollabAutomationSettings,
  useCollabAutomationSettings,
} from "../../../services/collaboration";
import { useAutomationPause } from "../../../services/automationPauseStore";
import { openCollabRequirementDetail } from "../../../stores/collabUiStore";
import { RuntimeResourcesSection } from "../requirement/RequirementArtifactsTab";
import { formatDuration, formatTime } from "../requirement/detailContext";
import "../collaboration.css";

interface Props {
  repositories: Repository[];
}

interface State {
  attempts: CollabAttempt[];
  requirements: CollabRequirementSummary[];
  stops: CollabRuntimeResource[];
  bridge: { port: number | null; cli: string | null } | null;
}

const EMPTY: State = { attempts: [], requirements: [], stops: [], bridge: null };

function isLive(r: CollabRequirementSummary): boolean {
  return r.businessStatus !== "done" && r.controlStatus !== "cancelled";
}

/** Automation 中的多仓库协作调度：并发、暂停/继续、自动恢复、停止超时与环境资源回收。 */
export function CollabAutomationSection({ repositories }: Props) {
  const { message } = AntApp.useApp();
  const settings = useCollabAutomationSettings();
  const automationPause = useAutomationPause();
  const [state, setState] = useState<State>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const stopSeenRef = useRef(new Map<string, number>());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [attempts, requirements, stops, bridge] = await Promise.all([
        listActiveCollabAttempts(),
        listCollabRequirements(null, false),
        listPendingCollabRuntimeStops(),
        getCollabBridgeStatus().catch(() => null),
      ]);
      const seen = stopSeenRef.current;
      const ts = Date.now();
      for (const a of attempts) {
        if (a.state === "stop_requested" || a.state === "stop_pending") {
          if (!seen.has(a.id)) seen.set(a.id, ts);
        } else seen.delete(a.id);
      }
      setState({ attempts, requirements, stops, bridge });
      setNow(ts);
    } catch (e) {
      message.error(formatCollabError(e));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void hydrateCollabAutomationSettings();
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    let timer: number | null = null;
    void reload();
    void onCollabChanged(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 400);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      disposed = true;
      unlisten?.();
      if (timer != null) window.clearTimeout(timer);
      window.clearInterval(tick);
    };
  }, [reload]);

  const reqById = useMemo(() => new Map(state.requirements.map((r) => [r.id, r])), [state.requirements]);
  const liveRequirements = useMemo(() => state.requirements.filter(isLive), [state.requirements]);
  const overdue = state.attempts.filter((a) =>
    isCollabStopOverdue(a.state, stopSeenRef.current.get(a.id), now, settings.stopReminderMinutes),
  );

  const save = async (patch: Parameters<typeof updateCollabAutomationSettings>[0]) => {
    try {
      await updateCollabAutomationSettings(patch);
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  const control = async (r: CollabRequirementSummary, action: "pause" | "resume") => {
    try {
      await controlCollabRequirement({
        requestId: newCollabRequestId(action),
        requirementId: r.id,
        action,
        expectedRevision: r.revision,
      });
      void reload();
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  const stopAttempt = async (a: CollabAttempt) => {
    try {
      await requestCollabStop(a.id, "Automation 手动停止");
      void reload();
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  const resolveCwd = useCallback(
    async (r: CollabRuntimeResource): Promise<string | null> => {
      if (!r.ownerTaskId) return null;
      const detail = await getCollabTaskDetail(r.ownerTaskId);
      const task = detail.task as { repositoryId?: number | null } | undefined;
      const repo = repositories.find((x) => x.id === task?.repositoryId);
      return repo?.path?.trim() || null;
    },
    [repositories],
  );

  return (
    <section className="collab-automation" aria-label="多仓库协作调度">
      <div className="collab-automation__head">
        <strong>多仓库协作调度</strong>
        <Space size={12} wrap>
          <label className="collab-automation__field">
            <Switch size="small" checked={settings.paused} onChange={(v) => void save({ paused: v })} />
            <span>暂停领取</span>
          </label>
          <label className="collab-automation__field">
            <span>全局并发</span>
            <InputNumber
              size="small"
              min={COLLAB_GLOBAL_LIMIT_MIN}
              max={COLLAB_GLOBAL_LIMIT_MAX}
              value={settings.globalLimit}
              onChange={(v) => typeof v === "number" && void save({ globalLimit: v })}
            />
          </label>
          <label className="collab-automation__field">
            <span>停止确认提醒</span>
            <InputNumber
              size="small"
              min={1}
              max={240}
              addonAfter="分钟"
              value={settings.stopReminderMinutes}
              onChange={(v) => typeof v === "number" && void save({ stopReminderMinutes: v })}
            />
          </label>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void reload()}>
            刷新
          </Button>
        </Space>
      </div>

      {automationPause.global ? (
        <Alert type="warning" showIcon message="全局暂停生效中：协作不会领取新任务，运行中的任务继续执行。" />
      ) : settings.paused ? (
        <Alert type="info" showIcon message="已暂停领取：运行中的任务继续执行，新任务与自动恢复排队等待。" />
      ) : null}
      {overdue.length ? (
        <Alert
          type="error"
          showIcon
          message={`${overdue.length} 个执行停止超过 ${settings.stopReminderMinutes} 分钟仍未确认，请检查会话或手动结束。`}
        />
      ) : null}

      <div className="collab-automation__meta">
        <span>执行桥：{state.bridge?.port ? `本机 127.0.0.1:${state.bridge.port}` : "未就绪"}</span>
        <span>运行中执行：{state.attempts.length} / {settings.globalLimit}</span>
        <span>进行中需求：{liveRequirements.length}</span>
        <Tooltip title="启动时按派发键核对遗留执行；租约过期视为失联并按执行次数预算自动重试，预算用尽转为待决策。">
          <span className="collab-automation__hint">自动恢复：已开启</span>
        </Tooltip>
      </div>

      <div className="collab-section-title">运行中的执行</div>
      <Table<CollabAttempt>
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={state.attempts}
        locale={{ emptyText: "当前没有运行中的协作执行" }}
        columns={[
          {
            title: "需求",
            render: (_, a) => (
              <Button type="link" size="small" onClick={() => openCollabRequirementDetail(a.requirementId, "tasks")}>
                {reqById.get(a.requirementId)?.title ?? a.requirementId}
              </Button>
            ),
          },
          { title: "动作", width: 90, dataIndex: "action" },
          {
            title: "状态",
            width: 130,
            render: (_, a) => {
              const l = attemptStateLabel(a.state);
              const late = overdue.some((o) => o.id === a.id);
              return (
                <Space size={4}>
                  <Tag color={l.tone}>{l.label}</Tag>
                  {late ? <Tag color="error">停止超时</Tag> : null}
                </Space>
              );
            },
          },
          { title: "已运行", width: 110, render: (_, a) => formatDuration(a.startedAt ? now - a.startedAt : null) },
          { title: "租约到期", width: 170, render: (_, a) => formatTime(a.leaseExpiry) },
          {
            title: "",
            width: 80,
            render: (_, a) =>
              a.state === "running" || a.state === "claimed" ? (
                <Button size="small" type="link" danger onClick={() => void stopAttempt(a)}>
                  停止
                </Button>
              ) : null,
          },
        ]}
      />

      <div className="collab-section-title">进行中的需求</div>
      <Table<CollabRequirementSummary>
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={liveRequirements}
        locale={{ emptyText: "没有进行中的协作需求" }}
        columns={[
          {
            title: "需求",
            render: (_, r) => (
              <Button type="link" size="small" onClick={() => openCollabRequirementDetail(r.id)}>
                {r.title}
              </Button>
            ),
          },
          {
            title: "状态",
            width: 110,
            render: (_, r) => {
              const l = requirementStatusLabel(r);
              return <Tag color={l.tone}>{l.label}</Tag>;
            },
          },
          { title: "进度", width: 70, render: (_, r) => `${requirementProgress(r.counts)}%` },
          {
            title: "并发 / 执行次数 / 修复轮次",
            width: 190,
            render: (_, r) => `${r.maxConcurrentAttempts} / ${r.executionAttemptBudget} / ${r.repairRoundBudget}`,
          },
          { title: "待决策", width: 70, render: (_, r) => r.counts.openDecisions || "—" },
          {
            title: "",
            width: 80,
            render: (_, r) =>
              r.controlStatus === "paused" || r.controlStatus === "pausing" ? (
                <Button size="small" type="link" onClick={() => void control(r, "resume")}>
                  继续
                </Button>
              ) : r.controlStatus === "active" ? (
                <Button size="small" type="link" onClick={() => void control(r, "pause")}>
                  暂停
                </Button>
              ) : null,
          },
        ]}
      />

      <RuntimeResourcesSection
        title="待确认停止的环境资源"
        resources={state.stops}
        ctx={null}
        resolveCwd={resolveCwd}
        onChanged={() => void reload()}
      />
    </section>
  );
}
