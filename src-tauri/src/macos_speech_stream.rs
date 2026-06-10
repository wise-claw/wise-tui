//! macOS：SFSpeechAudioBufferRecognitionRequest 流式 partial 转写。

use std::collections::HashMap;
use std::sync::Mutex;

use base64::Engine;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::AnyThread;
use objc2_avf_audio::{AVAudioCommonFormat, AVAudioFormat, AVAudioPCMBuffer};
use objc2_speech::{
    SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionRequest,
    SFSpeechRecognitionResult, SFSpeechRecognitionTask, SFSpeechRecognizer,
    SFSpeechRecognizerAuthorizationStatus,
};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::macos_speech::{ensure_speech_authorization, locale_for_bcp47, run_on_main_thread};

pub use crate::composer_speech::{ComposerSpeechTranscriptPayload, COMPOSER_SPEECH_TRANSCRIPT_EVENT};

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
    /// 用户点击停止并 `endAudio` 后为 true；仅此时句段 final 才销毁会话。
    end_audio_requested: bool,
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

fn f32_sample_to_i16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    if clamped < 0.0 {
        (clamped * 32_768.0).round() as i16
    } else {
        (clamped * 32_767.0).round() as i16
    }
}

fn f32_sample_to_i32(sample: f32) -> i32 {
    let clamped = sample.clamp(-1.0, 1.0);
    if clamped < 0.0 {
        (clamped * 2_147_483_648.0).round() as i32
    } else {
        (clamped * 2_147_483_647.0).round() as i32
    }
}

fn write_f32_samples_to_pcm_buffer(
    buffer: &AVAudioPCMBuffer,
    samples: &[f32],
    format: &AVAudioFormat,
) -> Result<(), String> {
    let channels_ptr = unsafe { buffer.floatChannelData() };
    if channels_ptr.is_null() {
        return Err("PCM 缓冲不可用（非 Float32 格式）".to_string());
    }
    let channel_count = usize::max(unsafe { format.channelCount() } as usize, 1);
    let stride = usize::max(unsafe { buffer.stride() } as usize, 1);
    let interleaved = unsafe { format.isInterleaved() };

    if interleaved {
        let base = unsafe { (*channels_ptr).as_ptr() };
        if base.is_null() {
            return Err("PCM 通道不可用".to_string());
        }
        for (frame, &sample) in samples.iter().enumerate() {
            let v = sample;
            for ch in 0..channel_count {
                unsafe {
                    base.add(frame * stride + ch).write(v);
                }
            }
        }
        return Ok(());
    }

    for ch in 0..channel_count {
        let ch_ptr = unsafe { *channels_ptr.add(ch) };
        let dst = ch_ptr.as_ptr();
        if dst.is_null() {
            return Err("PCM 通道不可用".to_string());
        }
        for (frame, &sample) in samples.iter().enumerate() {
            unsafe {
                dst.add(frame).write(sample);
            }
        }
    }
    Ok(())
}

fn write_i16_samples_to_pcm_buffer(
    buffer: &AVAudioPCMBuffer,
    samples: &[f32],
    format: &AVAudioFormat,
) -> Result<(), String> {
    let channels_ptr = unsafe { buffer.int16ChannelData() };
    if channels_ptr.is_null() {
        return Err("PCM 缓冲不可用（非 Int16 格式）".to_string());
    }
    let channel_count = usize::max(unsafe { format.channelCount() } as usize, 1);
    let stride = usize::max(unsafe { buffer.stride() } as usize, 1);
    let interleaved = unsafe { format.isInterleaved() };

    if interleaved {
        let base = unsafe { (*channels_ptr).as_ptr() };
        if base.is_null() {
            return Err("PCM 通道不可用".to_string());
        }
        for (frame, &sample) in samples.iter().enumerate() {
            let v = f32_sample_to_i16(sample);
            for ch in 0..channel_count {
                unsafe {
                    base.add(frame * stride + ch).write(v);
                }
            }
        }
        return Ok(());
    }

    for ch in 0..channel_count {
        let ch_ptr = unsafe { *channels_ptr.add(ch) };
        let dst = ch_ptr.as_ptr();
        if dst.is_null() {
            return Err("PCM 通道不可用".to_string());
        }
        for (frame, &sample) in samples.iter().enumerate() {
            unsafe {
                dst.add(frame).write(f32_sample_to_i16(sample));
            }
        }
    }
    Ok(())
}

fn write_i32_samples_to_pcm_buffer(
    buffer: &AVAudioPCMBuffer,
    samples: &[f32],
    format: &AVAudioFormat,
) -> Result<(), String> {
    let channels_ptr = unsafe { buffer.int32ChannelData() };
    if channels_ptr.is_null() {
        return Err("PCM 缓冲不可用（非 Int32 格式）".to_string());
    }
    let channel_count = usize::max(unsafe { format.channelCount() } as usize, 1);
    let stride = usize::max(unsafe { buffer.stride() } as usize, 1);
    let interleaved = unsafe { format.isInterleaved() };

    if interleaved {
        let base = unsafe { (*channels_ptr).as_ptr() };
        if base.is_null() {
            return Err("PCM 通道不可用".to_string());
        }
        for (frame, &sample) in samples.iter().enumerate() {
            let v = f32_sample_to_i32(sample);
            for ch in 0..channel_count {
                unsafe {
                    base.add(frame * stride + ch).write(v);
                }
            }
        }
        return Ok(());
    }

    for ch in 0..channel_count {
        let ch_ptr = unsafe { *channels_ptr.add(ch) };
        let dst = ch_ptr.as_ptr();
        if dst.is_null() {
            return Err("PCM 通道不可用".to_string());
        }
        for (frame, &sample) in samples.iter().enumerate() {
            unsafe {
                dst.add(frame).write(f32_sample_to_i32(sample));
            }
        }
    }
    Ok(())
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

    let common = unsafe { format.commonFormat() };
    let write_result = if common == AVAudioCommonFormat::PCMFormatFloat32 {
        write_f32_samples_to_pcm_buffer(&buffer, samples, format)
    } else if common == AVAudioCommonFormat::PCMFormatInt16 {
        write_i16_samples_to_pcm_buffer(&buffer, samples, format)
    } else if common == AVAudioCommonFormat::PCMFormatInt32 {
        write_i32_samples_to_pcm_buffer(&buffer, samples, format)
    } else if common == AVAudioCommonFormat::PCMFormatFloat64 {
        Err("暂不支持 Float64 PCM，请关闭本地听写或更新 Wise。".to_string())
    } else {
        write_f32_samples_to_pcm_buffer(&buffer, samples, format)
            .or_else(|_| write_i16_samples_to_pcm_buffer(&buffer, samples, format))
            .or_else(|_| write_i32_samples_to_pcm_buffer(&buffer, samples, format))
    };

    write_result.map_err(|e| {
        format!(
            "无法写入 PCM 样本（format={common:?}, rate={}, ch={}, interleaved={}）: {e}",
            unsafe { format.sampleRate() },
            unsafe { format.channelCount() },
            unsafe { format.isInterleaved() }
        )
    })?;
    Ok(buffer)
}

#[cfg(test)]
mod tests {
    use super::f32_sample_to_i16;

    #[test]
    fn f32_to_i16_clamps() {
        assert_eq!(f32_sample_to_i16(0.0), 0);
        assert_eq!(f32_sample_to_i16(1.0), 32_767);
        assert_eq!(f32_sample_to_i16(-1.0), -32_768);
    }
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

    let request_allocated = SFSpeechAudioBufferRecognitionRequest::alloc();
    let request = unsafe { SFSpeechAudioBufferRecognitionRequest::init(request_allocated) };
    unsafe {
        request.setAddsPunctuation(true);
        request.setShouldReportPartialResults(true);
        // 流式听写不 setRequiresOnDeviceRecognition：语言包未就绪时会导致无 partial / 无 final 文本。
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
                let msg = unsafe { &*error }
                    .localizedDescription()
                    .to_string();
                let _ = app_for_handler.emit(
                    COMPOSER_SPEECH_TRANSCRIPT_EVENT,
                    ComposerSpeechTranscriptPayload {
                        session_id: session_id_for_handler.clone(),
                        transcript: String::new(),
                        is_final: true,
                        error: Some(if msg.is_empty() {
                            "语音识别失败".to_string()
                        } else {
                            msg
                        }),
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
                    error: None,
                },
            );
            if is_final {
                let should_cleanup = app_for_handler
                    .try_state::<MacosStreamingSpeechState>()
                    .and_then(|st| {
                        st.sessions
                            .lock()
                            .ok()
                            .and_then(|guard| {
                                guard
                                    .get(&session_id_for_handler)
                                    .map(|session| session.end_audio_requested)
                            })
                    })
                    .unwrap_or(true);
                if should_cleanup {
                    cleanup();
                }
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
        end_audio_requested: false,
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
        let mut guard = state
            .sessions
            .lock()
            .map_err(|_| "流式语音识别状态锁失败".to_string())?;
        let session = guard
            .get_mut(session_id)
            .ok_or_else(|| "流式语音识别会话已结束".to_string())?;
        session.end_audio_requested = true;
        session.request.clone()
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
