//! Sherpa-ONNX + SenseVoice：VAD 分段 + 离线识别模拟流式听写（跨平台桌面）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use bzip2::read::BzDecoder;
use futures_util::StreamExt;
use serde::Serialize;
use sherpa_onnx::{
    OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig, VadModelConfig,
    VoiceActivityDetector,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tar::Archive;
use tokio::io::AsyncWriteExt;

use crate::composer_speech::{
    ComposerSpeechTranscriptPayload, COMPOSER_SPEECH_TRANSCRIPT_EVENT,
};

const SAMPLE_RATE: i32 = 16_000;
const VAD_WINDOW_SIZE: usize = 512;
const INTERIM_DECODE_INTERVAL_SECS: f32 = 0.2;

const SENSEVOICE_ARCHIVE_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2";
const SENSEVOICE_ARCHIVE_FALLBACK_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2";
const SILERO_VAD_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx";

const COMPOSER_SHERPA_MODELS_STATUS_EVENT: &str = "composer-sherpa-models-status";
const DOWNLOAD_CANCELLED_MSG: &str = "下载已取消";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerSherpaSpeechCapabilities {
    pub models_installed: bool,
    pub model_dir: String,
    pub ready: bool,
    pub downloading: bool,
    pub active_provider: Option<String>,
    pub model_variant: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamingSpeechStartResponse {
    pub session_id: String,
    pub sample_rate: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SherpaModelsStatusPayload {
    phase: &'static str,
    message: String,
    models_installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress_percent: Option<u8>,
}

struct CachedRecognizer {
    lang: String,
    provider: String,
    inner: OfflineRecognizer,
}

struct SherpaSpeechSession {
    lang: String,
    vad: VoiceActivityDetector,
    buffer: Vec<f32>,
    offset: usize,
    speech_started: bool,
    last_interim_at: Instant,
    committed_text: String,
}

pub struct SherpaSenseVoiceState {
    recognizer: Mutex<Option<CachedRecognizer>>,
    sessions: Mutex<HashMap<String, SherpaSpeechSession>>,
    download_in_progress: AtomicBool,
    download_cancel_requested: AtomicBool,
}

impl Default for SherpaSenseVoiceState {
    fn default() -> Self {
        Self {
            recognizer: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
            download_in_progress: AtomicBool::new(false),
            download_cancel_requested: AtomicBool::new(false),
        }
    }
}

fn check_download_cancelled(state: &SherpaSenseVoiceState) -> Result<(), String> {
    if state
        .download_cancel_requested
        .load(Ordering::SeqCst)
    {
        return Err(DOWNLOAD_CANCELLED_MSG.to_string());
    }
    Ok(())
}

fn is_download_cancelled_err(err: &str) -> bool {
    err == DOWNLOAD_CANCELLED_MSG
}

pub fn sherpa_sensevoice_model_dir() -> Result<PathBuf, String> {
    Ok(crate::wise_paths::wise_dir()?
        .join("models")
        .join("sherpa-sensevoice"))
}

fn sensevoice_model_path(dir: &Path) -> PathBuf {
    let int8 = dir.join("model.int8.onnx");
    if int8.is_file() {
        return int8;
    }
    dir.join("model.onnx")
}

fn sensevoice_tokens_path(dir: &Path) -> PathBuf {
    dir.join("tokens.txt")
}

fn silero_vad_path(dir: &Path) -> PathBuf {
    dir.join("silero_vad.onnx")
}

fn sensevoice_model_variant(dir: &Path) -> &'static str {
    if dir.join("model.int8.onnx").is_file() {
        "int8"
    } else {
        "fp32"
    }
}

pub fn sherpa_sensevoice_models_installed() -> Result<bool, String> {
    let dir = sherpa_sensevoice_model_dir()?;
    Ok(sensevoice_model_path(&dir).is_file()
        && sensevoice_tokens_path(&dir).is_file()
        && silero_vad_path(&dir).is_file())
}

pub fn map_bcp47_to_sensevoice_lang(lang: &str) -> String {
    let lower = lang.trim().to_lowercase();
    match lower.as_str() {
        "auto" => return "auto".to_string(),
        "zh" | "zh-cn" | "zh-tw" | "zh-hans" | "zh-hant" => return "zh".to_string(),
        "en" | "en-us" | "en-gb" => return "en".to_string(),
        "ja" | "ja-jp" => return "ja".to_string(),
        "ko" | "ko-kr" => return "ko".to_string(),
        "yue" | "cantonese" => return "yue".to_string(),
        _ => {}
    }
    if lower.starts_with("zh") {
        return "zh".to_string();
    }
    if lower.starts_with("en") {
        return "en".to_string();
    }
    if lower.starts_with("ja") {
        return "ja".to_string();
    }
    if lower.starts_with("ko") {
        return "ko".to_string();
    }
    if lower.contains("yue") || lower.contains("cantonese") {
        return "yue".to_string();
    }
    "auto".to_string()
}

pub fn strip_sensevoice_rich_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '<' {
            while let Some(&next) = chars.peek() {
                chars.next();
                if next == '>' {
                    break;
                }
            }
            continue;
        }
        out.push(ch);
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_pcm_f32_base64(pcm_base64: &str) -> Result<Vec<f32>, String> {
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        pcm_base64.trim(),
    )
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

fn default_num_threads() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get().min(8) as i32)
        .unwrap_or(2)
        .max(1)
}

fn create_vad(silero_vad: &Path) -> Result<VoiceActivityDetector, String> {
    let mut config = VadModelConfig::default();
    config.silero_vad.model = Some(
        silero_vad
            .to_str()
            .ok_or_else(|| "VAD 模型路径无效".to_string())?
            .to_string(),
    );
    config.silero_vad.threshold = 0.5;
    config.silero_vad.min_silence_duration = 0.1;
    config.silero_vad.min_speech_duration = 0.25;
    config.silero_vad.max_speech_duration = 8.0;
    config.silero_vad.window_size = VAD_WINDOW_SIZE as i32;
    config.sample_rate = SAMPLE_RATE;
    config.debug = false;
    VoiceActivityDetector::create(&config, 20.0)
        .ok_or_else(|| "创建 VAD 失败".to_string())
}

fn try_create_recognizer_with_provider(
    model_dir: &Path,
    lang: &str,
    provider: &str,
) -> Result<OfflineRecognizer, String> {
    let model = sensevoice_model_path(model_dir);
    let tokens = sensevoice_tokens_path(model_dir);
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
        model: Some(
            model
                .to_str()
                .ok_or_else(|| "SenseVoice 模型路径无效".to_string())?
                .to_string(),
        ),
        language: Some(map_bcp47_to_sensevoice_lang(lang)),
        use_itn: true,
    };
    config.model_config.tokens = Some(
        tokens
            .to_str()
            .ok_or_else(|| "tokens 路径无效".to_string())?
            .to_string(),
    );
    config.model_config.num_threads = default_num_threads();
    config.model_config.provider = Some(provider.to_string());
    config.model_config.debug = false;
    OfflineRecognizer::create(&config).ok_or_else(|| {
        format!("加载 SenseVoice 失败（provider={provider}）")
    })
}

fn create_recognizer(model_dir: &Path, lang: &str) -> Result<(OfflineRecognizer, String), String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(recognizer) = try_create_recognizer_with_provider(model_dir, lang, "coreml") {
            return Ok((recognizer, "coreml".to_string()));
        }
    }
    let recognizer = try_create_recognizer_with_provider(model_dir, lang, "cpu")?;
    Ok((recognizer, "cpu".to_string()))
}

fn ensure_recognizer(state: &SherpaSenseVoiceState, lang: &str) -> Result<(), String> {
    let mapped = map_bcp47_to_sensevoice_lang(lang);
    let mut guard = state
        .recognizer
        .lock()
        .map_err(|_| "SenseVoice 识别器锁失败".to_string())?;
    if let Some(cached) = guard.as_ref() {
        if cached.lang == mapped {
            return Ok(());
        }
    }
    let model_dir = sherpa_sensevoice_model_dir()?;
    if !sherpa_sensevoice_models_installed()? {
        return Err("SenseVoice 模型未安装，请先在语音菜单中下载。".to_string());
    }
    let (inner, provider) = create_recognizer(&model_dir, lang)?;
    *guard = Some(CachedRecognizer {
        lang: mapped,
        provider,
        inner,
    });
    Ok(())
}

fn decode_buffer(recognizer: &OfflineRecognizer, samples: &[f32]) -> Option<String> {
    if samples.is_empty() {
        return None;
    }
    let stream = recognizer.create_stream();
    stream.accept_waveform(SAMPLE_RATE, samples);
    recognizer.decode(&stream);
    stream
        .get_result()
        .map(|r| strip_sensevoice_rich_tags(&r.text))
        .filter(|t| !t.is_empty())
}

fn emit_transcript(
    app: &AppHandle,
    session_id: &str,
    transcript: String,
    is_final: bool,
    error: Option<String>,
) {
    let _ = app.emit(
        COMPOSER_SPEECH_TRANSCRIPT_EVENT,
        ComposerSpeechTranscriptPayload {
            session_id: session_id.to_string(),
            transcript,
            is_final,
            error,
        },
    );
}

fn join_committed_and_interim(committed: &str, interim: &str) -> String {
    let committed = committed.trim();
    let interim = interim.trim();
    match (committed.is_empty(), interim.is_empty()) {
        (true, true) => String::new(),
        (true, false) => interim.to_string(),
        (false, true) => committed.to_string(),
        (false, false) => format!("{committed} {interim}"),
    }
}

fn append_segment_text(committed: &mut String, segment_text: &str) {
    if committed.is_empty() {
        *committed = segment_text.to_string();
    } else {
        *committed = format!("{committed} {segment_text}");
    }
}

fn drain_vad_segments(
    session: &mut SherpaSpeechSession,
    recognizer: &OfflineRecognizer,
    app: &AppHandle,
    session_id: &str,
    emit_updates: bool,
) {
    while !session.vad.is_empty() {
        if let Some(segment) = session.vad.front() {
            session.vad.pop();
            if let Some(segment_text) = decode_buffer(recognizer, segment.samples()) {
                append_segment_text(&mut session.committed_text, &segment_text);
                if emit_updates {
                    emit_transcript(
                        app,
                        session_id,
                        session.committed_text.clone(),
                        false,
                        None,
                    );
                }
            }
        }
        session.buffer.clear();
        session.offset = 0;
        session.speech_started = false;
    }
}

fn flush_session_vad(
    session: &mut SherpaSpeechSession,
    recognizer: &OfflineRecognizer,
    app: &AppHandle,
    session_id: &str,
) {
    if session.offset < session.buffer.len() {
        session.vad.accept_waveform(&session.buffer[session.offset..]);
        session.offset = session.buffer.len();
    }
    session.vad.flush();
    drain_vad_segments(session, recognizer, app, session_id, true);
}

fn process_session_audio(
    app: &AppHandle,
    state: &SherpaSenseVoiceState,
    session_id: &str,
    samples: &[f32],
) -> Result<(), String> {
    let lang = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "SenseVoice 会话锁失败".to_string())?;
        sessions
            .get(session_id)
            .map(|s| s.lang.clone())
            .ok_or_else(|| "SenseVoice 会话已结束".to_string())?
    };
    ensure_recognizer(state, &lang)?;

    let rec_guard = state
        .recognizer
        .lock()
        .map_err(|_| "SenseVoice 识别器锁失败".to_string())?;
    let recognizer = rec_guard
        .as_ref()
        .ok_or_else(|| "SenseVoice 识别器未就绪".to_string())?;

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "SenseVoice 会话锁失败".to_string())?;
    let session = sessions
        .get_mut(session_id)
        .ok_or_else(|| "SenseVoice 会话已结束".to_string())?;

    session.buffer.extend_from_slice(samples);

    while session.offset + VAD_WINDOW_SIZE <= session.buffer.len() {
        session
            .vad
            .accept_waveform(&session.buffer[session.offset..session.offset + VAD_WINDOW_SIZE]);
        if !session.speech_started && session.vad.detected() {
            session.speech_started = true;
            session.last_interim_at = Instant::now();
        }
        session.offset += VAD_WINDOW_SIZE;
    }

    if !session.speech_started && session.buffer.len() > 10 * VAD_WINDOW_SIZE {
        let trim_amount = session.buffer.len() - 10 * VAD_WINDOW_SIZE;
        session.offset = session.offset.saturating_sub(trim_amount);
        session.buffer = session.buffer[session.buffer.len() - 10 * VAD_WINDOW_SIZE..].to_vec();
    }

    if session.speech_started
        && session.last_interim_at.elapsed().as_secs_f32() > INTERIM_DECODE_INTERVAL_SECS
    {
        if let Some(interim) = decode_buffer(&recognizer.inner, &session.buffer) {
            let transcript = join_committed_and_interim(&session.committed_text, &interim);
            emit_transcript(app, session_id, transcript, false, None);
        }
        session.last_interim_at = Instant::now();
    }

    drain_vad_segments(session, &recognizer.inner, app, session_id, true);

    Ok(())
}

fn finish_session(
    app: &AppHandle,
    state: &SherpaSenseVoiceState,
    session_id: &str,
) -> Result<(), String> {
    let lang = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "SenseVoice 会话锁失败".to_string())?;
        sessions
            .get(session_id)
            .map(|s| s.lang.clone())
            .ok_or_else(|| "SenseVoice 会话已结束".to_string())?
    };
    ensure_recognizer(state, &lang)?;

    let rec_guard = state
        .recognizer
        .lock()
        .map_err(|_| "SenseVoice 识别器锁失败".to_string())?;
    let recognizer = rec_guard
        .as_ref()
        .ok_or_else(|| "SenseVoice 识别器未就绪".to_string())?;

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "SenseVoice 会话锁失败".to_string())?;
    let mut session = sessions
        .remove(session_id)
        .ok_or_else(|| "SenseVoice 会话已结束".to_string())?;

    flush_session_vad(&mut session, &recognizer.inner, app, session_id);

    let mut committed = session.committed_text;
    if !session.buffer.is_empty() {
        if let Some(tail) = decode_buffer(&recognizer.inner, &session.buffer) {
            append_segment_text(&mut committed, &tail);
        }
    }

    emit_transcript(
        app,
        session_id,
        committed.trim().to_string(),
        true,
        None,
    );
    Ok(())
}

fn emit_models_status(
    app: &AppHandle,
    phase: &'static str,
    message: String,
    models_installed: bool,
    progress_percent: Option<u8>,
) {
    let _ = app.emit(
        COMPOSER_SHERPA_MODELS_STATUS_EVENT,
        SherpaModelsStatusPayload {
            phase,
            message,
            models_installed,
            progress_percent,
        },
    );
}

async fn download_file_with_progress(
    app: &AppHandle,
    state: &SherpaSenseVoiceState,
    url: &str,
    dest: &Path,
    message: &str,
    progress_base: u8,
    progress_span: u8,
) -> Result<(), String> {
    check_download_cancelled(state)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let tmp = dest.with_extension("download_tmp");
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("下载失败: {e}"))?;
    check_download_cancelled(state)?;
    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }
    let total = response.content_length();
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("创建临时文件失败: {e}"))?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        check_download_cancelled(state)?;
        let chunk = chunk.map_err(|e| format!("读取下载内容失败: {e}"))?;
        downloaded += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        let progress_percent = total.map(|total_bytes| {
            if total_bytes == 0 {
                progress_base
            } else {
                progress_base
                    + ((downloaded.saturating_mul(progress_span as u64)) / total_bytes) as u8
            }
        });
        emit_models_status(
            app,
            "downloading",
            message.to_string(),
            false,
            progress_percent,
        );
    }
    check_download_cancelled(state)?;
    file.flush()
        .await
        .map_err(|e| format!("刷新临时文件失败: {e}"))?;
    drop(file);
    std::fs::rename(&tmp, dest).map_err(|e| format!("保存文件失败: {e}"))?;
    Ok(())
}

fn extract_tar_bz2(archive_path: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("创建目录失败: {e}"))?;
    let file = std::fs::File::open(archive_path).map_err(|e| format!("打开压缩包失败: {e}"))?;
    let decoder = BzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    archive
        .unpack(dest)
        .map_err(|e| format!("解压模型失败: {e}"))?;
    Ok(())
}

fn try_sensevoice_model_and_tokens(dir: &Path) -> Option<(PathBuf, PathBuf)> {
    let tokens = dir.join("tokens.txt");
    if !tokens.is_file() {
        return None;
    }
    for name in ["model.int8.onnx", "model.onnx"] {
        let model = dir.join(name);
        if model.is_file() {
            return Some((model, tokens));
        }
    }
    None
}

fn locate_extracted_sensevoice_files(extract_root: &Path) -> Result<(PathBuf, PathBuf), String> {
    if let Some(found) = try_sensevoice_model_and_tokens(extract_root) {
        return Ok(found);
    }
    for entry in std::fs::read_dir(extract_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(found) = try_sensevoice_model_and_tokens(&path) {
            return Ok(found);
        }
    }
    Err("解压后未找到 model.onnx / model.int8.onnx 与 tokens.txt".to_string())
}

fn install_sensevoice_models_from_archive(
    archive_path: &Path,
    model_dir: &Path,
) -> Result<(), String> {
    let extract_tmp = model_dir.join("_extract_tmp");
    if extract_tmp.exists() {
        std::fs::remove_dir_all(&extract_tmp).map_err(|e| e.to_string())?;
    }
    extract_tar_bz2(archive_path, &extract_tmp)?;
    let (model_src, tokens_src) = locate_extracted_sensevoice_files(&extract_tmp)?;
    std::fs::create_dir_all(model_dir).map_err(|e| e.to_string())?;
    let model_name = model_src
        .file_name()
        .ok_or_else(|| "模型文件名无效".to_string())?;
    let model_dest = model_dir.join(model_name);
    std::fs::copy(&model_src, &model_dest).map_err(|e| e.to_string())?;
    std::fs::copy(&tokens_src, sensevoice_tokens_path(model_dir)).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&extract_tmp);
    let _ = std::fs::remove_file(archive_path);
    Ok(())
}

async fn download_sensevoice_models_task(app: AppHandle) {
    let state = app.state::<SherpaSenseVoiceState>();
    if state
        .download_in_progress
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        emit_models_status(
            &app,
            "downloading",
            "模型正在下载中…".to_string(),
            false,
            None,
        );
        return;
    }

    state
        .download_cancel_requested
        .store(false, Ordering::SeqCst);

    emit_models_status(
        &app,
        "downloading",
        "正在下载 SenseVoice 模型…".to_string(),
        false,
        Some(0),
    );

    let model_dir = match sherpa_sensevoice_model_dir() {
        Ok(dir) => dir,
        Err(e) => {
            state.download_in_progress.store(false, Ordering::SeqCst);
            emit_models_status(&app, "error", e, false, None);
            return;
        }
    };

    let archive_path = model_dir.join("sensevoice-int8.tar.bz2");
    let tmp_path = archive_path.with_extension("download_tmp");

    let result: Result<(), String> = async {
        std::fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;

        if let Err(e) = download_file_with_progress(
            &app,
            state.inner(),
            SENSEVOICE_ARCHIVE_URL,
            &archive_path,
            "正在下载 SenseVoice 模型…",
            0,
            70,
        )
        .await
        {
            if !e.contains("404") {
                return Err(e);
            }
            download_file_with_progress(
                &app,
                state.inner(),
                SENSEVOICE_ARCHIVE_FALLBACK_URL,
                &archive_path,
                "正在下载 SenseVoice 模型（备用源）…",
                0,
                70,
            )
            .await?;
        }
        check_download_cancelled(state.inner())?;
        emit_models_status(
            &app,
            "downloading",
            "正在解压 SenseVoice 模型…".to_string(),
            false,
            Some(72),
        );
        install_sensevoice_models_from_archive(&archive_path, &model_dir)?;
        check_download_cancelled(state.inner())?;

        download_file_with_progress(
            &app,
            state.inner(),
            SILERO_VAD_URL,
            &silero_vad_path(&model_dir),
            "正在下载 Silero VAD 模型…",
            75,
            24,
        )
        .await?;

        if let Ok(mut guard) = state.recognizer.lock() {
            *guard = None;
        }
        Ok(())
    }
    .await;

    state.download_in_progress.store(false, Ordering::SeqCst);
    state
        .download_cancel_requested
        .store(false, Ordering::SeqCst);
    let _ = std::fs::remove_file(&tmp_path);
    let _ = std::fs::remove_file(model_dir.join("silero_vad.onnx.download_tmp"));

    match result {
        Ok(()) => emit_models_status(
            &app,
            "ready",
            "SenseVoice 模型已就绪".to_string(),
            sherpa_sensevoice_models_installed().unwrap_or(false),
            Some(100),
        ),
        Err(e) if is_download_cancelled_err(&e) => emit_models_status(
            &app,
            "cancelled",
            e,
            false,
            None,
        ),
        Err(e) => emit_models_status(&app, "error", e, false, None),
    }
}

/// 查询 Sherpa SenseVoice 模型与就绪状态。
#[tauri::command]
pub fn composer_sherpa_speech_capabilities(
    state: State<'_, SherpaSenseVoiceState>,
) -> Result<ComposerSherpaSpeechCapabilities, String> {
    let model_dir = sherpa_sensevoice_model_dir()?;
    let models_installed = sherpa_sensevoice_models_installed()?;
    let active_provider = state
        .recognizer
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|cached| cached.provider.clone()));
    Ok(ComposerSherpaSpeechCapabilities {
        models_installed,
        model_dir: model_dir.to_string_lossy().into_owned(),
        ready: models_installed,
        downloading: state.download_in_progress.load(Ordering::SeqCst),
        active_provider,
        model_variant: sensevoice_model_variant(&model_dir).to_string(),
    })
}

/// 后台下载 SenseVoice + Silero VAD 模型到 ~/.wise/models/sherpa-sensevoice/。
#[tauri::command]
pub fn composer_sherpa_download_models(app: AppHandle) -> Result<(), String> {
    if sherpa_sensevoice_models_installed()? {
        return Ok(());
    }
    tauri::async_runtime::spawn(async move {
        download_sensevoice_models_task(app).await;
    });
    Ok(())
}

/// 请求停止正在进行的 SenseVoice 模型下载。
#[tauri::command]
pub fn composer_sherpa_cancel_download_models(
    state: State<'_, SherpaSenseVoiceState>,
) -> Result<(), String> {
    if !state.download_in_progress.load(Ordering::SeqCst) {
        return Ok(());
    }
    state
        .download_cancel_requested
        .store(true, Ordering::SeqCst);
    Ok(())
}

/// 开始 SenseVoice 模拟流式听写。
#[tauri::command]
pub fn composer_sherpa_speech_start(
    app: AppHandle,
    state: State<'_, SherpaSenseVoiceState>,
    lang: Option<String>,
) -> Result<StreamingSpeechStartResponse, String> {
    let lang = lang.unwrap_or_else(|| "auto".to_string());
    if !sherpa_sensevoice_models_installed()? {
        return Err("SenseVoice 模型未安装，请先在语音菜单中下载。".to_string());
    }
    ensure_recognizer(state.inner(), &lang)?;

    let model_dir = sherpa_sensevoice_model_dir()?;
    let vad = create_vad(&silero_vad_path(&model_dir))?;
    let session_id = uuid::Uuid::new_v4().to_string();

    state
        .sessions
        .lock()
        .map_err(|_| "SenseVoice 会话锁失败".to_string())?
        .insert(
            session_id.clone(),
            SherpaSpeechSession {
                lang,
                vad,
                buffer: Vec::new(),
                offset: 0,
                speech_started: false,
                last_interim_at: Instant::now(),
                committed_text: String::new(),
            },
        );

    let _ = app;
    Ok(StreamingSpeechStartResponse {
        session_id,
        sample_rate: SAMPLE_RATE as f64,
    })
}

/// 追加 float32 PCM（little-endian base64）到 SenseVoice 会话。
#[tauri::command]
pub fn composer_sherpa_speech_append_pcm(
    app: AppHandle,
    state: State<'_, SherpaSenseVoiceState>,
    session_id: String,
    pcm_base64: String,
) -> Result<(), String> {
    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("sessionId 无效".to_string());
    }
    let samples = decode_pcm_f32_base64(&pcm_base64)?;
    process_session_audio(&app, state.inner(), &session_id, &samples)
}

/// 结束音频输入并推送 final 转写。
#[tauri::command]
pub fn composer_sherpa_speech_finish(
    app: AppHandle,
    state: State<'_, SherpaSenseVoiceState>,
    session_id: String,
) -> Result<(), String> {
    let session_id = session_id.trim().to_string();
    finish_session(&app, state.inner(), &session_id)
}

/// 取消 SenseVoice 会话。
#[tauri::command]
pub fn composer_sherpa_speech_cancel(
    state: State<'_, SherpaSenseVoiceState>,
    session_id: String,
) -> Result<(), String> {
    let session_id = session_id.trim().to_string();
    state
        .sessions
        .lock()
        .map_err(|_| "SenseVoice 会话锁失败".to_string())?
        .remove(&session_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_bcp47_zh_cn_to_zh() {
        assert_eq!(map_bcp47_to_sensevoice_lang("zh-CN"), "zh");
    }

    #[test]
    fn map_short_lang_codes() {
        assert_eq!(map_bcp47_to_sensevoice_lang("auto"), "auto");
        assert_eq!(map_bcp47_to_sensevoice_lang("yue"), "yue");
        assert_eq!(map_bcp47_to_sensevoice_lang("ja"), "ja");
    }

    #[test]
    fn strip_rich_tags() {
        assert_eq!(
            strip_sensevoice_rich_tags("<|zh|><|NEUTRAL|><|Speech|>你好世界"),
            "你好世界"
        );
    }
}
