import { DownloadOutlined } from "@ant-design/icons";
import { Button, Input, InputNumber, Progress, Segmented, Switch, Tag } from "antd";
import type { ComposerSpeechEngine } from "../../constants/composerSpeech";
import {
  COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_MAX,
  COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_MIN,
  type ComposerSpeechEnginePreference,
  type ComposerSpeechPreferencesV1,
  type ComposerSpeechSendMode,
  type SenseVoiceLanguagePreference,
} from "../../constants/composerSpeechPreferences";
import type { ComposerSherpaSpeechCapabilities } from "../../services/composerSherpaSpeech";
import { composerSpeechEnginePreferenceLabel } from "../../utils/composerSpeechEngine";
import { SENSE_VOICE_LANGUAGE_OPTIONS } from "../../utils/senseVoiceLang";

const SEND_MODE_OPTIONS: { label: string; value: ComposerSpeechSendMode }[] = [
  { label: "手动", value: "manual" },
  { label: "停顿", value: "silenceAutoSend" },
  { label: "结束词", value: "endingWordAutoSend" },
];

const ENGINE_OPTIONS: ComposerSpeechEnginePreference[] = [
  "auto",
  "sensevoice",
  "web",
];

function activeEngineLabel(engine: ComposerSpeechEngine | null): string {
  if (engine === "sensevoice") return "SenseVoice";
  return "Web";
}

function sherpaProviderLabel(caps: ComposerSherpaSpeechCapabilities | null): string | null {
  if (!caps?.activeProvider) return null;
  if (caps.activeProvider === "coreml") return "CoreML";
  if (caps.activeProvider === "cpu") return "CPU";
  return caps.activeProvider;
}

export interface ComposerVoiceSettingsPanelProps {
  speechPrefs: ComposerSpeechPreferencesV1;
  updateSpeechPrefs: (patch: Partial<ComposerSpeechPreferencesV1>) => Promise<ComposerSpeechPreferencesV1>;
  draftSilenceIdleSeconds: number;
  setDraftSilenceIdleSeconds: (value: number) => void;
  draftAutoSendEndingText: string;
  setDraftAutoSendEndingText: (value: string) => void;
  draftVoiceCommandClearText: string;
  setDraftVoiceCommandClearText: (value: string) => void;
  draftVoiceCommandCancelText: string;
  setDraftVoiceCommandCancelText: (value: string) => void;
  activeEngine: ComposerSpeechEngine | null;
  sherpaSpeechCaps: ComposerSherpaSpeechCapabilities | null;
  sherpaModelsDownloading: boolean;
  sherpaDownloadProgress: number | null;
  sherpaDownloadError: string | null;
  onDownloadSherpaModels: () => void;
  onCancelSherpaDownload: () => void;
}

export function ComposerVoiceSettingsPanel({
  speechPrefs,
  updateSpeechPrefs,
  draftSilenceIdleSeconds,
  setDraftSilenceIdleSeconds,
  draftAutoSendEndingText,
  setDraftAutoSendEndingText,
  draftVoiceCommandClearText,
  setDraftVoiceCommandClearText,
  draftVoiceCommandCancelText,
  setDraftVoiceCommandCancelText,
  activeEngine,
  sherpaSpeechCaps,
  sherpaModelsDownloading,
  sherpaDownloadProgress,
  sherpaDownloadError,
  onDownloadSherpaModels,
  onCancelSherpaDownload,
}: ComposerVoiceSettingsPanelProps) {
  const sherpaDownloading =
    sherpaModelsDownloading || sherpaSpeechCaps?.downloading === true;
  const sherpaReady = sherpaSpeechCaps?.modelsInstalled === true;
  const showSenseVoiceLang =
    speechPrefs.speechEngineMode === "sensevoice" ||
    speechPrefs.speechEngineMode === "auto" ||
    activeEngine === "sensevoice";
  const providerLabel = sherpaProviderLabel(sherpaSpeechCaps);

  const persistSilenceIdleSeconds = () => {
    const nextMs = Math.round(draftSilenceIdleSeconds * 1000);
    if (nextMs === speechPrefs.silenceAutoSendIdleMs) return;
    void updateSpeechPrefs({ silenceAutoSendIdleMs: nextMs });
  };

  const persistAutoSendEndingText = () => {
    if (draftAutoSendEndingText === speechPrefs.autoSendEndingText) return;
    void updateSpeechPrefs({ autoSendEndingText: draftAutoSendEndingText });
  };

  const persistVoiceCommandClearText = () => {
    if (draftVoiceCommandClearText === speechPrefs.voiceCommandClearText) return;
    void updateSpeechPrefs({ voiceCommandClearText: draftVoiceCommandClearText });
  };

  const persistVoiceCommandCancelText = () => {
    if (draftVoiceCommandCancelText === speechPrefs.voiceCommandCancelText) return;
    void updateSpeechPrefs({ voiceCommandCancelText: draftVoiceCommandCancelText });
  };

  const handleEngineSelect = (mode: ComposerSpeechEnginePreference) => {
    void updateSpeechPrefs({ speechEngineMode: mode });
  };

  return (
    <div className="app-composer-voice-panel" onClick={(ev) => ev.stopPropagation()}>
      <header className="app-composer-voice-panel__header">
        <span className="app-composer-voice-panel__title">语音听写</span>
        <Tag bordered={false} className="app-composer-voice-panel__engine-tag">
          {activeEngineLabel(activeEngine)}
        </Tag>
      </header>

      <section className="app-composer-voice-panel__section">
        <div className="app-composer-voice-panel__section-label">发送方式</div>
        <Segmented<ComposerSpeechSendMode>
          block
          size="small"
          className="app-composer-voice-panel__segmented"
          options={SEND_MODE_OPTIONS}
          value={speechPrefs.sendMode}
          onChange={(value) => void updateSpeechPrefs({ sendMode: value })}
        />
        {speechPrefs.sendMode === "silenceAutoSend" ? (
          <div className="app-composer-voice-panel__param app-composer-voice-panel__param--inline">
            <span className="app-composer-voice-panel__param-label">停顿</span>
            <InputNumber
              size="small"
              min={COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_MIN / 1000}
              max={COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_MAX / 1000}
              step={0.1}
              value={draftSilenceIdleSeconds}
              onChange={(value) => {
                if (typeof value === "number" && Number.isFinite(value)) {
                  setDraftSilenceIdleSeconds(value);
                }
              }}
              onBlur={persistSilenceIdleSeconds}
              onPressEnter={persistSilenceIdleSeconds}
              className="app-composer-voice-panel__param-input"
            />
            <span className="app-composer-voice-panel__param-unit">秒</span>
          </div>
        ) : null}
        {speechPrefs.sendMode === "endingWordAutoSend" && !speechPrefs.voiceCommandsEnabled ? (
          <div className="app-composer-voice-panel__param">
            <span className="app-composer-voice-panel__param-label">结束词</span>
            <Input
              size="small"
              maxLength={16}
              value={draftAutoSendEndingText}
              onChange={(ev) => setDraftAutoSendEndingText(ev.target.value)}
              onBlur={persistAutoSendEndingText}
              onPressEnter={persistAutoSendEndingText}
              placeholder="发送"
              className="app-composer-voice-panel__param-input"
            />
          </div>
        ) : null}
      </section>

      <section className="app-composer-voice-panel__section">
        <div className="app-composer-voice-panel__section-label">识别引擎</div>
        <div className="app-composer-voice-panel__engine-grid">
          {ENGINE_OPTIONS.map((mode) => {
            const selected = speechPrefs.speechEngineMode === mode;
            return (
              <button
                key={mode}
                type="button"
                className={
                  selected
                    ? "app-composer-voice-panel__engine-chip app-composer-voice-panel__engine-chip--active"
                    : "app-composer-voice-panel__engine-chip"
                }
                onClick={() => handleEngineSelect(mode)}
              >
                {composerSpeechEnginePreferenceLabel(mode)}
              </button>
            );
          })}
        </div>

        {showSenseVoiceLang ? (
          <div className="app-composer-voice-panel__subsection">
            <div className="app-composer-voice-panel__section-label">语言</div>
            <Segmented<SenseVoiceLanguagePreference>
              block
              size="small"
              className="app-composer-voice-panel__segmented app-composer-voice-panel__lang-segmented"
              options={SENSE_VOICE_LANGUAGE_OPTIONS}
              value={speechPrefs.senseVoiceLang}
              onChange={(value) => void updateSpeechPrefs({ senseVoiceLang: value })}
            />
          </div>
        ) : null}

        {sherpaReady ? (
          <div className="app-composer-voice-panel__hint app-composer-voice-panel__hint--ok app-composer-voice-panel__hint--inline">
            已就绪{sherpaSpeechCaps?.modelVariant === "int8" ? " · INT8" : null}
            {providerLabel ? ` · ${providerLabel}` : null}
          </div>
        ) : sherpaDownloading ? (
          <div className="app-composer-voice-panel__download-progress">
            <Progress
              size="small"
              percent={sherpaDownloadProgress ?? undefined}
              status="active"
              showInfo={sherpaDownloadProgress != null}
            />
            <div className="app-composer-voice-panel__download-row">
              <span className="app-composer-voice-panel__hint">正在下载 SenseVoice 模型…</span>
              <Button
                type="link"
                size="small"
                danger
                className="app-composer-voice-panel__download-stop"
                onClick={onCancelSherpaDownload}
              >
                停止
              </Button>
            </div>
          </div>
        ) : sherpaDownloadError ? (
          <div className="app-composer-voice-panel__download-error">
            <span className="app-composer-voice-panel__hint app-composer-voice-panel__hint--error">
              {sherpaDownloadError}
            </span>
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              className="app-composer-voice-panel__download"
              onClick={onDownloadSherpaModels}
            >
              重试下载
            </Button>
          </div>
        ) : (
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            className="app-composer-voice-panel__download"
            onClick={onDownloadSherpaModels}
          >
            下载 SenseVoice 模型
          </Button>
        )}
      </section>

      <section className="app-composer-voice-panel__section app-composer-voice-panel__section--switches">
        <div className="app-composer-voice-panel__switch-row">
          <span>口播命令</span>
          <Switch
            size="small"
            checked={speechPrefs.voiceCommandsEnabled}
            onChange={(checked) => void updateSpeechPrefs({ voiceCommandsEnabled: checked })}
          />
        </div>
        {speechPrefs.voiceCommandsEnabled ? (
          <div className="app-composer-voice-panel__voice-commands">
            <div className="app-composer-voice-panel__voice-commands-grid">
              <label className="app-composer-voice-panel__voice-cmd" title="口播后发送输入框内容">
                <span className="app-composer-voice-panel__voice-cmd-label">发送</span>
                <Input
                  size="small"
                  maxLength={16}
                  value={draftAutoSendEndingText}
                  onChange={(ev) => setDraftAutoSendEndingText(ev.target.value)}
                  onBlur={persistAutoSendEndingText}
                  onPressEnter={persistAutoSendEndingText}
                  placeholder="发送"
                />
              </label>
              <label className="app-composer-voice-panel__voice-cmd" title="口播后清空会话输入框内容">
                <span className="app-composer-voice-panel__voice-cmd-label">清除</span>
                <Input
                  size="small"
                  maxLength={16}
                  value={draftVoiceCommandClearText}
                  onChange={(ev) => setDraftVoiceCommandClearText(ev.target.value)}
                  onBlur={persistVoiceCommandClearText}
                  onPressEnter={persistVoiceCommandClearText}
                  placeholder="清除"
                />
              </label>
              <label className="app-composer-voice-panel__voice-cmd" title="口播后结束当前会话执行">
                <span className="app-composer-voice-panel__voice-cmd-label">取消</span>
                <Input
                  size="small"
                  maxLength={16}
                  value={draftVoiceCommandCancelText}
                  onChange={(ev) => setDraftVoiceCommandCancelText(ev.target.value)}
                  onBlur={persistVoiceCommandCancelText}
                  onPressEnter={persistVoiceCommandCancelText}
                  placeholder="取消"
                />
              </label>
            </div>
          </div>
        ) : null}
        <div className="app-composer-voice-panel__switch-grid">
          <div className="app-composer-voice-panel__switch-row">
            <span>录音转需求</span>
            <Switch
              size="small"
              checked={speechPrefs.speechToRequirementEnabled}
              onChange={(checked) => void updateSpeechPrefs({ speechToRequirementEnabled: checked })}
            />
          </div>
          <div
            className="app-composer-voice-panel__switch-row"
            title="开启：用 AI 智能整理（纠错字、去口头语、补标点，保留全部原意）后再入框；关闭：仅本地整理。语音结果始终经过整理，不会写入原始转写。"
          >
            <span>AI 智能整理</span>
            <Switch
              size="small"
              checked={speechPrefs.speechPolishEnabled}
              onChange={(checked) => void updateSpeechPrefs({ speechPolishEnabled: checked })}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
