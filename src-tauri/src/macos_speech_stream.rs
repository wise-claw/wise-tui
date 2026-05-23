//! macOS：SFSpeechAudioBufferRecognitionRequest 流式 partial 转写。

use std::collections::HashMap;
use std::sync::Mutex;

use base64::Engine;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::AnyThread;
use objc2_avf_audio::{AVAudioFormat, AVAudioPCMBuffer};
use objc2_speech::{
    SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionRequest,
    SFSpeechRecognitionResult, SFSpeechRecognitionTask, SFSpeechRecognizer,
    SFSpeechRecognizerAuthorizationStatus,
};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::macos_speech::{ensure_speech_authorization, locale_for_bcp47, run_on_main_thread};

pub const COMPOSER_SPEECH_TRANSCRIPT_EVENT: &str = "composer-speech-transcript";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerSpeechTranscriptPayload {
    pub session_id: String,
    pub transcript: String,
    pub is_final: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamingSpeechStartResponse {
    pub session_id: String,
    pub sample_rate: f64,
}

struct StreamingSpeechSession {
    #[allow(dead_code)]
    recognizer: Retained<SFSpeechRecognizer>,
    request: Retained<SFSpeechAudioBufferRecognitionRequest>,
    task: Retained<SFSpeechRecognitionTask>,
    format: Retained<AVAudioFormat>,
}

// SAFETY: Speech / AVFoundation 对象仅在主线程通过 `run_on_main_thread` 访问。
unsafe impl Send for StreamingSpeechSession {}
unsafe impl Sync for StreamingSpeechSession {}

pub struct MacosStreamingSpeechState {
    sessions: Mutex<HashMap<String, StreamingSpeechSession>>,
}

unsafe impl Send for MacosStreamingSpeechState {}
unsafe impl Sync for MacosStreamingSpeechState {}

impl Default for MacosStreamingSpeechState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl MacosStreamingSpeechState {
    fn remove_session(&self, session_id: &str) {
        if let Ok(mut guard) = self.sessions.lock() {
            guard.remove(session_id);
        }
    }
}

fn decode_pcm_f32_base64(pcm_base64: &str) -> Result<Vec<f32>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pcm_base64.trim())
        .map_err(|e| format!("PCM 数据无效: {e}"))?;
    if bytes.len() % 4 != 0 {
        return Err("PCM 样本长度无效".to_string());
    }
    let mut out = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(out)
}

fn pcm_buffer_from_f32(
    samples: &[f32],
    format: &AVAudioFormat,
) -> Result<Retained<AVAudioPCMBuffer>, String> {
    if samples.is_empty() {
        return Err("空音频块".to_string());
    }
    let frame_count = samples.len() as u32;
    let allocated = AVAudioPCMBuffer::alloc();
    let buffer = unsafe {
        AVAudioPCMBuffer::initWithPCMFormat_frameCapacity(allocated, format, frame_count)
    }
    .ok_or_else(|| "无法创建 PCM 缓冲".to_string())?;
    unsafe { buffer.setFrameLength(frame_count) };
    let channels = unsafe { buffer.floatChannelData() };
    if channels.is_null() {
        return Err("PCM 缓冲不可用".to_string());
    }
    let ch0 = unsafe { *channels };
    let dst = ch0.as_ptr();
    if dst.is_null() {
        return Err("PCM 通道不可用".to_string());
    }
    unsafe {
        std::ptr::copy_nonoverlapping(samples.as_ptr(), dst, samples.len());
    }
    Ok(buffer)
}

#[cfg(target_os = "macos")]
fn start_streaming_on_main_thread(
    app: AppHandle,
    state: &MacosStreamingSpeechState,
    lang: String,
) -> Result<StreamingSpeechStartResponse, String> {
    let auth = ensure_speech_authorization()?;
    if auth != SFSpeechRecognizerAuthorizationStatus::Authorized {
        return Err(match auth {
            SFSpeechRecognizerAuthorizationStatus::Denied => {
                "未获得语音识别权限。请在「系统设置 → 隐私与安全性 → 语音识别」中允许 Wise。"
            }
            SFSpeechRecognizerAuthorizationStatus::Restricted => "系统限制了语音识别功能。",
            _ => "请先允许 Wise 使用语音识别。",
        }
        .to_string());
    }

    let locale = locale_for_bcp47(&lang);
    let recognizer_allocated = SFSpeechRecognizer::alloc();
    let recognizer = unsafe { SFSpeechRecognizer::initWithLocale(recognizer_allocated, &locale) }
        .ok_or_else(|| format!("当前语言「{lang}」不支持语音识别"))?;
    if !unsafe { recognizer.isAvailable() } {
        return Err("语音识别服务暂不可用，请稍后重试。".to_string());
    }

    let on_device = unsafe { recognizer.supportsOnDeviceRecognition() };
    let request_allocated = SFSpeechAudioBufferRecognitionRequest::alloc();
    let request = unsafe { SFSpeechAudioBufferRecognitionRequest::init(request_allocated) };
    unsafe {
        request.setAddsPunctuation(true);
        request.setShouldReportPartialResults(true);
        if on_device {
            request.setRequiresOnDeviceRecognition(true);
        }
    }

    let format = unsafe { request.nativeAudioFormat() };
    let sample_rate = unsafe { format.sampleRate() };
    if sample_rate < 8_000.0 || sample_rate > 96_000.0 {
        return Err(format!("Speech 原生采样率无效: {sample_rate}"));
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let session_id_for_handler = session_id.clone();

    let app_for_handler = app.clone();
    let block = RcBlock::new(
        move |result: *mut SFSpeechRecognitionResult, error: *mut objc2_foundation::NSError| {
            let cleanup = || {
                if let Some(st) = app_for_handler.try_state::<MacosStreamingSpeechState>() {
                    st.remove_session(&session_id_for_handler);
                }
            };

            if !error.is_null() {
                let _ = app_for_handler.emit(
                    COMPOSER_SPEECH_TRANSCRIPT_EVENT,
                    ComposerSpeechTranscriptPayload {
                        session_id: session_id_for_handler.clone(),
                        transcript: String::new(),
                        is_final: true,
                    },
                );
                cleanup();
                return;
            }
            if result.is_null() {
                return;
            }
            let result = unsafe { &*result };
            let transcript = unsafe { result.bestTranscription().formattedString() }
                .to_string()
                .trim()
                .to_string();
            let is_final = unsafe { result.isFinal() };
            let _ = app_for_handler.emit(
                COMPOSER_SPEECH_TRANSCRIPT_EVENT,
                ComposerSpeechTranscriptPayload {
                    session_id: session_id_for_handler.clone(),
                    transcript,
                    is_final,
                },
            );
            if is_final {
                cleanup();
            }
        },
    );

    let req_ref: &SFSpeechRecognitionRequest = request.as_ref();
    let task =
        unsafe { recognizer.recognitionTaskWithRequest_resultHandler(req_ref, &block) };

    let session = StreamingSpeechSession {
        recognizer,
        request,
        task,
        format,
    };

    state
        .sessions
        .lock()
        .map_err(|_| "流式语音识别状态锁失败".to_string())?
        .insert(session_id.clone(), session);

    Ok(StreamingSpeechStartResponse {
        session_id,
        sample_rate,
    })
}

#[cfg(target_os = "macos")]
fn append_pcm_on_main_thread(
    state: &MacosStreamingSpeechState,
    session_id: &str,
    pcm_base64: &str,
) -> Result<(), String> {
    let samples = decode_pcm_f32_base64(pcm_base64)?;
    let (request, format) = {
        let guard = state
            .sessions
            .lock()
            .map_err(|_| "流式语音识别状态锁失败".to_string())?;
        let session = guard
            .get(session_id)
            .ok_or_else(|| "流式语音识别会话已结束".to_string())?;
        (session.request.clone(), session.format.clone())
    };
    let buffer = pcm_buffer_from_f32(&samples, &format)?;
    unsafe { request.appendAudioPCMBuffer(&buffer) };
    Ok(())
}

#[cfg(target_os = "macos")]
fn finish_stream_on_main_thread(
    state: &MacosStreamingSpeechState,
    session_id: &str,
) -> Result<(), String> {
    let request = {
        let guard = state
            .sessions
            .lock()
            .map_err(|_| "流式语音识别状态锁失败".to_string())?;
        guard
            .get(session_id)
            .ok_or_else(|| "流式语音识别会话已结束".to_string())?
            .request
            .clone()
    };
    unsafe { request.endAudio() };
    Ok(())
}

#[cfg(target_os = "macos")]
fn cancel_stream_on_main_thread(
    state: &MacosStreamingSpeechState,
    session_id: &str,
) -> Result<(), String> {
    let mut guard = state
        .sessions
        .lock()
        .map_err(|_| "流式语音识别状态锁失败".to_string())?;
    if let Some(session) = guard.remove(session_id) {
        unsafe { session.task.cancel() };
    }
    Ok(())
}

/// 开始流式语音识别，通过 `composer-speech-transcript` 事件推送 partial / final。
#[tauri::command]
pub fn macos_streaming_speech_start(
    app: AppHandle,
    _state: State<'_, MacosStreamingSpeechState>,
    lang: Option<String>,
) -> Result<StreamingSpeechStartResponse, String> {
    #[cfg(target_os = "macos")]
    {
        let lang = lang.unwrap_or_else(|| "zh-CN".to_string());
        return run_on_main_thread(&app, {
            let app = app.clone();
            move || {
                let state = app.state::<MacosStreamingSpeechState>();
                start_streaming_on_main_thread(app.clone(), state.inner(), lang)
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state, lang);
        Err("仅 macOS 支持".to_string())
    }
}

/// 追加 float32 PCM（little-endian base64）到流式识别会话。
#[tauri::command]
pub fn macos_streaming_speech_append_pcm(
    app: AppHandle,
    _state: State<'_, MacosStreamingSpeechState>,
    session_id: String,
    pcm_base64: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let session_id = session_id.trim().to_string();
        if session_id.is_empty() {
            return Err("sessionId 无效".to_string());
        }
        return run_on_main_thread(&app, {
            let app = app.clone();
            move || {
                let state = app.state::<MacosStreamingSpeechState>();
                append_pcm_on_main_thread(state.inner(), &session_id, &pcm_base64)
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state, session_id, pcm_base64);
        Err("仅 macOS 支持".to_string())
    }
}

/// 结束音频输入，等待 final 回调。
#[tauri::command]
pub fn macos_streaming_speech_finish(
    app: AppHandle,
    _state: State<'_, MacosStreamingSpeechState>,
    session_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let session_id = session_id.trim().to_string();
        return run_on_main_thread(&app, {
            let app = app.clone();
            move || {
                let state = app.state::<MacosStreamingSpeechState>();
                finish_stream_on_main_thread(state.inner(), &session_id)
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state, session_id);
        Err("仅 macOS 支持".to_string())
    }
}

/// 取消流式识别会话。
#[tauri::command]
pub fn macos_streaming_speech_cancel(
    app: AppHandle,
    _state: State<'_, MacosStreamingSpeechState>,
    session_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let session_id = session_id.trim().to_string();
        return run_on_main_thread(&app, {
            let app = app.clone();
            move || {
                let state = app.state::<MacosStreamingSpeechState>();
                cancel_stream_on_main_thread(state.inner(), &session_id)
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state, session_id);
        Err("仅 macOS 支持".to_string())
    }
}
