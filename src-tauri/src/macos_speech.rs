//! macOS：设备端 Speech 框架将录音 WAV 转写为文字（不依赖 Web Speech / 云端听写）。

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use base64::Engine;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::AnyThread;
use objc2_foundation::{NSBundle, NSLocale, NSString, NSURL};
use objc2_speech::{
    SFSpeechRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognizer,
    SFSpeechRecognizerAuthorizationStatus, SFSpeechURLRecognitionRequest,
};
use tauri::AppHandle;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacosLocalSpeechCapabilities {
    pub available: bool,
    pub on_device: bool,
    pub authorization: String,
}

fn auth_status_label(status: SFSpeechRecognizerAuthorizationStatus) -> &'static str {
    if status == SFSpeechRecognizerAuthorizationStatus::Authorized {
        "authorized"
    } else if status == SFSpeechRecognizerAuthorizationStatus::Denied {
        "denied"
    } else if status == SFSpeechRecognizerAuthorizationStatus::Restricted {
        "restricted"
    } else {
        "not_determined"
    }
}

#[cfg(target_os = "macos")]
fn speech_recognition_usage_description_present() -> bool {
    let bundle = NSBundle::mainBundle();
    let Some(info) = bundle.infoDictionary() else {
        return false;
    };
    let key = NSString::from_str("NSSpeechRecognitionUsageDescription");
    info.objectForKey(&key).is_some()
}

#[cfg(target_os = "macos")]
pub(crate) fn ensure_speech_authorization() -> Result<SFSpeechRecognizerAuthorizationStatus, String> {
    let status = unsafe { SFSpeechRecognizer::authorizationStatus() };
    if status == SFSpeechRecognizerAuthorizationStatus::Authorized {
        return Ok(status);
    }
    if status == SFSpeechRecognizerAuthorizationStatus::Denied
        || status == SFSpeechRecognizerAuthorizationStatus::Restricted
    {
        return Ok(status);
    }

    if !speech_recognition_usage_description_present() {
        return Err(
            "应用未声明语音识别隐私说明（NSSpeechRecognitionUsageDescription）。\
             请完整重新编译 Wise（cargo clean 后重新运行 tauri dev），勿在开发态重复嵌入 Info.plist。"
                .to_string(),
        );
    }

    let (tx, rx) = mpsc::sync_channel(1);
    let block = RcBlock::new(move |new_status: SFSpeechRecognizerAuthorizationStatus| {
        let _ = tx.send(new_status);
    });
    unsafe {
        SFSpeechRecognizer::requestAuthorization(&block);
    }
    rx.recv_timeout(Duration::from_secs(120))
        .map_err(|_| "等待语音识别授权超时".to_string())
}

#[cfg(target_os = "macos")]
pub(crate) fn locale_for_bcp47(lang: &str) -> Retained<NSLocale> {
    let trimmed = lang.trim();
    if trimmed.is_empty() {
        return NSLocale::currentLocale();
    }
    let id = NSString::from_str(trimmed);
    NSLocale::localeWithLocaleIdentifier(&id)
}

#[cfg(target_os = "macos")]
fn transcribe_wav_on_main_thread(wav_path: &std::path::Path, lang: &str) -> Result<String, String> {
    let locale = locale_for_bcp47(lang);
    let allocated = SFSpeechRecognizer::alloc();
    let recognizer = unsafe { SFSpeechRecognizer::initWithLocale(allocated, &locale) }
        .ok_or_else(|| format!("当前语言「{lang}」不支持语音识别"))?;

    if !unsafe { recognizer.isAvailable() } {
        return Err("语音识别服务暂不可用，请稍后重试。".to_string());
    }

    let on_device = unsafe { recognizer.supportsOnDeviceRecognition() };
    let url = NSURL::fileURLWithPath(&NSString::from_str(
        wav_path.to_str().ok_or("WAV 路径无效")?,
    ));
    let request_allocated = SFSpeechURLRecognitionRequest::alloc();
    let request = unsafe { SFSpeechURLRecognitionRequest::initWithURL(request_allocated, &url) };
    unsafe {
        request.setAddsPunctuation(true);
        if on_device {
            request.setRequiresOnDeviceRecognition(true);
        }
        request.setShouldReportPartialResults(false);
    }

    let (tx, rx) = mpsc::sync_channel::<Result<String, String>>(1);
    let block = RcBlock::new(
        move |result: *mut SFSpeechRecognitionResult, error: *mut objc2_foundation::NSError| {
            if !error.is_null() {
                let msg = unsafe { &*error }
                    .localizedDescription()
                    .to_string();
                let _ = tx.send(Err(if msg.is_empty() {
                    "语音识别失败".to_string()
                } else {
                    msg
                }));
                return;
            }
            if result.is_null() {
                return;
            }
            let result = unsafe { &*result };
            if !unsafe { result.isFinal() } {
                return;
            }
            let transcript = unsafe { result.bestTranscription().formattedString() }.to_string();
            let _ = tx.send(Ok(transcript.trim().to_string()));
        },
    );

    let req_ref: &SFSpeechRecognitionRequest = request.as_ref();
    let _task = unsafe { recognizer.recognitionTaskWithRequest_resultHandler(req_ref, &block) };

    match rx.recv_timeout(Duration::from_secs(120)) {
        Ok(Ok(text)) if text.is_empty() => Err("未识别到语音内容，请靠近麦克风后重试。".to_string()),
        Ok(inner) => inner,
        Err(_) => Err("语音识别超时，请缩短录音后重试。".to_string()),
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn run_on_main_thread<F, T>(app: &AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| format!("主线程调度失败: {e}"))?;
    rx.recv()
        .map_err(|_| "读取语音识别结果失败".to_string())?
}

/// 查询 macOS 本地 Speech 转写能力与授权状态。
#[tauri::command]
pub fn macos_local_speech_capabilities(lang: Option<String>) -> Result<MacosLocalSpeechCapabilities, String> {
    #[cfg(target_os = "macos")]
    {
        let lang = lang.unwrap_or_else(|| "zh-CN".to_string());
        let locale = locale_for_bcp47(&lang);
        let status = unsafe { SFSpeechRecognizer::authorizationStatus() };
        let allocated = SFSpeechRecognizer::alloc();
        let recognizer = unsafe { SFSpeechRecognizer::initWithLocale(allocated, &locale) }
            .ok_or_else(|| format!("当前语言「{lang}」不支持语音识别"))?;
        let available = unsafe { recognizer.isAvailable() };
        let on_device = unsafe { recognizer.supportsOnDeviceRecognition() };
        return Ok(MacosLocalSpeechCapabilities {
            available,
            on_device,
            authorization: auth_status_label(status).to_string(),
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = lang;
        Err("仅 macOS 支持".to_string())
    }
}

/// 将前端录制的 WAV（base64）在设备端转写为文字。
#[tauri::command]
pub fn macos_transcribe_composer_wav(
    app: AppHandle,
    wav_base64: String,
    lang: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let lang = lang.unwrap_or_else(|| "zh-CN".to_string());
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(wav_base64.trim())
            .map_err(|e| format!("音频数据无效: {e}"))?;
        if bytes.len() < 44 {
            return Err("录音过短，请多说几句后重试。".to_string());
        }

        let mut wav_path: PathBuf = crate::wise_paths::wise_dir()
            .map_err(|e| e.to_string())?
            .join("tmp");
        std::fs::create_dir_all(&wav_path).map_err(|e| format!("创建临时目录失败: {e}"))?;
        wav_path.push(format!("composer-speech-{}.wav", uuid::Uuid::new_v4()));

        std::fs::write(&wav_path, &bytes).map_err(|e| format!("写入临时音频失败: {e}"))?;

        let wav_path_for_thread = wav_path.clone();
        let result = run_on_main_thread(&app, move || {
            let auth = ensure_speech_authorization()?;
            if auth != SFSpeechRecognizerAuthorizationStatus::Authorized {
                return Err(match auth {
                    SFSpeechRecognizerAuthorizationStatus::Denied => {
                        "未获得语音识别权限。请在「系统设置 → 隐私与安全性 → 语音识别」中允许 Wise。"
                    }
                    SFSpeechRecognizerAuthorizationStatus::Restricted => {
                        "系统限制了语音识别功能。"
                    }
                    _ => "请先允许 Wise 使用语音识别。",
                }
                .to_string());
            }
            transcribe_wav_on_main_thread(&wav_path_for_thread, &lang)
        });

        let _ = std::fs::remove_file(&wav_path);
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, wav_base64, lang);
        Err("仅 macOS 支持".to_string())
    }
}
