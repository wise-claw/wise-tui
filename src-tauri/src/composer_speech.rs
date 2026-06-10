//! Composer 语音听写：前后端共享事件名与 payload。

pub const COMPOSER_SPEECH_TRANSCRIPT_EVENT: &str = "composer-speech-transcript";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerSpeechTranscriptPayload {
    pub session_id: String,
    pub transcript: String,
    pub is_final: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
