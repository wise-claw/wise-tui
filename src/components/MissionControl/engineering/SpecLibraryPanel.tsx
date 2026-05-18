import { Alert, Button, Empty, Input, Space, Spin, Tag, Typography } from "antd";
import { BookOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listTrellisSpecAreas,
  readTrellisSpecIndex,
  writeTrellisSpecIndex,
  type TrellisSpecArea,
  type TrellisSpecIndex,
} from "../../../services/trellisSpecBridge";

interface SpecLibraryPanelProps {
  rootPath?: string | null;
  enabled?: boolean;
  onOpenProjectSession?: () => void | Promise<void>;
  onRequestAgentUpdate?: (area: string) => void | Promise<void>;
}

export function SpecLibraryPanel({
  rootPath,
  enabled = true,
  onOpenProjectSession,
  onRequestAgentUpdate,
}: SpecLibraryPanelProps) {
  const [areas, setAreas] = useState<TrellisSpecArea[]>([]);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [index, setIndex] = useState<TrellisSpecIndex | null>(null);
  const [draft, setDraft] = useState("");
  const [loadingAreas, setLoadingAreas] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [saving, setSaving] = useState(false);
  const [agentArea, setAgentArea] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const selectedMeta = useMemo(
    () => areas.find((area) => area.area === selectedArea) ?? null,
    [areas, selectedArea],
  );

  const dirty = selectedArea != null && draft !== (index?.content ?? "");

  const loadAreas = useCallback(() => {
    if (!enabled || !rootPath) {
      setAreas([]);
      setSelectedArea(null);
      setIndex(null);
      setDraft("");
      setError(null);
      return;
    }
    let cancelled = false;
    setLoadingAreas(true);
    setError(null);
    listTrellisSpecAreas(rootPath)
      .then((nextAreas) => {
        if (cancelled) return;
        setAreas(nextAreas);
        setSelectedArea((current) => {
          if (current && nextAreas.some((area) => area.area === current)) {
            return current;
          }
          return nextAreas.find((area) => area.hasIndex)?.area ?? nextAreas[0]?.area ?? null;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setAreas([]);
        setSelectedArea(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingAreas(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, rootPath]);

  useEffect(() => loadAreas(), [loadAreas]);

  useEffect(() => {
    if (!enabled || !rootPath || !selectedArea) {
      setIndex(null);
      setDraft("");
      setSavedAt(null);
      return;
    }
    let cancelled = false;
    setLoadingIndex(true);
    setError(null);
    setSavedAt(null);
    readTrellisSpecIndex(rootPath, selectedArea)
      .then((nextIndex) => {
        if (cancelled) return;
        setIndex(nextIndex);
        setDraft(nextIndex.content);
      })
      .catch((err) => {
        if (cancelled) return;
        setIndex(null);
        setDraft("");
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingIndex(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, rootPath, selectedArea]);

  const handleSave = useCallback(async () => {
    if (!rootPath || !selectedArea) return;
    setSaving(true);
    setError(null);
    try {
      await writeTrellisSpecIndex(rootPath, selectedArea, draft);
      const nextIndex = await readTrellisSpecIndex(rootPath, selectedArea);
      setIndex(nextIndex);
      setDraft(nextIndex.content);
      setSavedAt(Date.now());
      void listTrellisSpecAreas(rootPath).then(setAreas).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [draft, rootPath, selectedArea]);

  const handleAgentUpdate = useCallback(async () => {
    if (!selectedArea || !onRequestAgentUpdate) return;
    setAgentArea(selectedArea);
    setError(null);
    try {
      await onRequestAgentUpdate(selectedArea);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAgentArea(null);
    }
  }, [onRequestAgentUpdate, selectedArea]);

  if (!rootPath) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="当前项目没有 Trellis rootPath，无法读取 .trellis/spec"
      />
    );
  }

  return (
    <section className="mission-spec-library">
      <div className="mission-spec-library__header">
        <div className="mission-spec-library__title">
          <BookOutlined />
          <div>
            <Typography.Text strong>Spec Library</Typography.Text>
            <Typography.Text type="secondary">
              项目级 .trellis/spec 规范入口；建议让项目会话里的 Agent 更新，手写保存仅用于小修正。
            </Typography.Text>
          </div>
        </div>
        <Space size={6} wrap>
          <Tag>{areas.length} areas</Tag>
          {onOpenProjectSession ? (
            <Button size="small" onClick={() => void onOpenProjectSession()}>
              打开项目会话
            </Button>
          ) : null}
          <Button size="small" icon={<ReloadOutlined />} loading={loadingAreas} onClick={loadAreas}>
            刷新
          </Button>
        </Space>
      </div>

      {error ? (
        <Alert className="mission-spec-library__error" type="error" showIcon message={error} />
      ) : null}

      {loadingAreas && areas.length === 0 ? (
        <div className="mission-spec-library__loading">
          <Spin size="small" />
        </div>
      ) : areas.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description=".trellis/spec 尚未初始化，暂无可视化规范区"
        />
      ) : (
        <div className="mission-spec-library__body">
          <aside className="mission-spec-library__areas" aria-label="Spec areas">
            {areas.map((area) => (
              <button
                key={area.area}
                type="button"
                className={`mission-spec-library-area ${
                  selectedArea === area.area ? "mission-spec-library-area--active" : ""
                }`}
                onClick={() => setSelectedArea(area.area)}
              >
                <span className="mission-spec-library-area__name">{area.area}</span>
                <span className="mission-spec-library-area__meta">
                  {area.mdFileCount} md · {area.hasIndex ? "index ready" : "no index"}
                </span>
              </button>
            ))}
          </aside>

          <div className="mission-spec-library__editor">
            <div className="mission-spec-library__editor-head">
              <Space size={6} wrap>
                <Typography.Text strong>{selectedArea ? `${selectedArea}/index.md` : "index.md"}</Typography.Text>
                {selectedMeta ? <Tag>{selectedMeta.mdFileCount} docs</Tag> : null}
                {selectedMeta?.hasIndex ? <Tag color="success">tracked</Tag> : <Tag color="warning">new index</Tag>}
                {dirty ? <Tag color="processing">unsaved</Tag> : null}
                {savedAt ? <Tag color="success">saved {new Date(savedAt).toLocaleTimeString("zh-CN")}</Tag> : null}
              </Space>
              <Space size={6} wrap>
                {onRequestAgentUpdate ? (
                  <Button
                    type="primary"
                    size="small"
                    disabled={!selectedArea}
                    loading={agentArea === selectedArea}
                    onClick={handleAgentUpdate}
                  >
                    用 Agent 更新
                  </Button>
                ) : null}
                <Button
                  size="small"
                  icon={<SaveOutlined />}
                  disabled={!dirty || !selectedArea}
                  loading={saving}
                  onClick={handleSave}
                >
                  高级保存 index
                </Button>
              </Space>
            </div>

            {loadingIndex ? (
              <div className="mission-spec-library__loading">
                <Spin size="small" />
              </div>
            ) : (
              <Input.TextArea
                className="mission-spec-library__textarea"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write the spec index for this area..."
                autoSize={false}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
