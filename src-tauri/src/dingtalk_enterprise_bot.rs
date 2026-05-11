//! 钉钉「企业内部应用」机器人：换取 access_token，并调用人与机器人单聊批量发送（Markdown）。
//! 接收用户在钉钉侧发送的内容可由本机 `dingtalk_stream_gateway`（Stream 长连）或自建网关调用 `wise_notification_ingest`；本模块仅负责出向单聊 Markdown。

use std::path::Path;

use reqwest::Client;
use reqwest::multipart::Part;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Deserialize)]
struct GetTokenResp {
    errcode: i32,
    #[serde(default)]
    errmsg: Option<String>,
    access_token: Option<String>,
}

/// 供 Stream 网关等模块复用：用 AppKey / AppSecret 换取新版接口用的 `access_token`（请求头 `x-acs-dingtalk-access-token`）。
pub async fn dingtalk_internal_access_token(app_key: &str, app_secret: &str) -> Result<String, String> {
    get_internal_access_token(app_key, app_secret).await
}

async fn get_internal_access_token(app_key: &str, app_secret: &str) -> Result<String, String> {
    let key = urlencoding::encode(app_key);
    let sec = urlencoding::encode(app_secret);
    let url = format!("https://oapi.dingtalk.com/gettoken?appkey={key}&appsecret={sec}");
    let client = Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求 gettoken 失败: {}", e))?;
    let body: GetTokenResp = resp
        .json()
        .await
        .map_err(|e| format!("解析 gettoken 响应失败: {}", e))?;
    if body.errcode != 0 {
        let msg = body.errmsg.unwrap_or_default();
        return Err(format!("gettoken 错误 errcode={} {}", body.errcode, msg));
    }
    body.access_token
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "gettoken 未返回 access_token".to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OtoBatchSendBody {
    robot_code: String,
    user_ids: Vec<String>,
    msg_key: String,
    msg_param: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkOtoBatchSendResult {
    pub process_query_key: Option<String>,
    pub invalid_staff_id_list: Option<Vec<String>>,
    pub flow_controlled_staff_id_list: Option<Vec<String>>,
}

/// 从钉钉新网关 JSON 中拼可读错误（含 HTTP 4xx/5xx 体）。
fn format_dingtalk_robot_api_error(status: reqwest::StatusCode, value: &serde_json::Value) -> String {
    let code = value
        .get("code")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let msg = value
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    let request_id = value
        .get("requestId")
        .or_else(|| value.get("requestid"))
        .and_then(|x| x.as_str())
        .unwrap_or("");

    if !code.is_empty() || !msg.is_empty() {
        let mut out = format!("{}: {}", if code.is_empty() { "错误" } else { &code }, msg);
        if !request_id.is_empty() {
            out.push_str(&format!("（requestId: {}）", request_id));
        }
        if code == "staffId.notExisted" {
            out.push_str(
                " — 请使用「本企业在钉钉通讯录中的 userid」（常为纯数字）；勿填 unionId、手机号或邮箱。接收人需已在钉钉内向该机器人发过消息以建立单聊。",
            );
        }
        return out;
    }

    format!("HTTP {} {}", status, value)
}

fn normalize_oto_user_ids(user_ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut user_ids: Vec<String> = user_ids.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if user_ids.is_empty() {
        return Err("至少填写一个接收人 userId".to_string());
    }
    if user_ids.len() > 20 {
        return Err("单次最多 20 个 userId".to_string());
    }
    user_ids.sort_unstable();
    user_ids.dedup();
    Ok(user_ids)
}

async fn robot_oto_batch_send(
    token: &str,
    robot_code: &str,
    user_ids: Vec<String>,
    msg_key: &str,
    msg_param: serde_json::Value,
) -> Result<DingTalkOtoBatchSendResult, String> {
    let body = OtoBatchSendBody {
        robot_code: robot_code.to_string(),
        user_ids,
        msg_key: msg_key.to_string(),
        msg_param: msg_param.to_string(),
    };
    let client = Client::new();
    let resp = client
        .post("https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend")
        .header("x-acs-dingtalk-access-token", token)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 batchSend 失败: {}", e))?;
    let status = resp.status();
    let raw = resp.text().await.map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!({ "raw": raw }));
    if !status.is_success() {
        return Err(format_dingtalk_robot_api_error(status, &value));
    }
    parse_batch_send_response(&value)
}

#[derive(Debug, Deserialize)]
struct OapiMediaUploadResp {
    errcode: i32,
    #[serde(default)]
    errmsg: Option<String>,
    #[serde(default)]
    media_id: Option<String>,
}

/// 旧版 `oapi.dingtalk.com/media/upload`，单聊图片消息的 `photoURL` 可填此处返回的 `media_id`。
async fn upload_oapi_robot_image_media(access_token: &str, bytes: Vec<u8>, filename: &str) -> Result<String, String> {
    const MAX_OAPI_IMAGE_BYTES: usize = 1024 * 1024;
    if bytes.is_empty() {
        return Err("图片文件为空".to_string());
    }
    if bytes.len() > MAX_OAPI_IMAGE_BYTES {
        return Err(format!(
            "图片超过 {}MB，钉钉 media/upload（type=image）单文件上限为 1MB，请先压缩或改用公网图片 URL 发送",
            MAX_OAPI_IMAGE_BYTES / (1024 * 1024)
        ));
    }
    let part = Part::bytes(bytes)
        .file_name(filename.to_string())
        .mime_str("application/octet-stream")
        .map_err(|e| format!("构建 multipart 失败: {}", e))?;
    let form = reqwest::multipart::Form::new().part("media", part);
    let url = format!(
        "https://oapi.dingtalk.com/media/upload?access_token={}&type=image",
        urlencoding::encode(access_token)
    );
    let client = Client::new();
    let resp = client
        .post(url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("media/upload 请求失败: {}", e))?;
    let body: OapiMediaUploadResp = resp
        .json()
        .await
        .map_err(|e| format!("解析 media/upload 响应失败: {}", e))?;
    if body.errcode != 0 {
        let msg = body.errmsg.unwrap_or_default();
        return Err(format!("media/upload 失败 errcode={} {}", body.errcode, msg));
    }
    body.media_id
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "media/upload 未返回 media_id".to_string())
}

fn parse_batch_send_response(value: &serde_json::Value) -> Result<DingTalkOtoBatchSendResult, String> {
    if let Some(code) = value.get("code").and_then(|c| c.as_str()) {
        if !code.is_empty() && code != "OK" {
            let msg = value
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("");
            return Err(format!("钉钉接口返回 code={} message={}", code, msg));
        }
    }
    Ok(DingTalkOtoBatchSendResult {
        process_query_key: value
            .get("processQueryKey")
            .and_then(|x| x.as_str())
            .map(String::from),
        invalid_staff_id_list: value
            .get("invalidStaffIdList")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            }),
        flow_controlled_staff_id_list: value
            .get("flowControlledStaffIdList")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            }),
    })
}

/// 校验应用凭证是否有效（能换取 access_token）。
#[tauri::command]
pub async fn dingtalk_enterprise_bot_ping(app_key: String, app_secret: String) -> Result<(), String> {
    let _ = get_internal_access_token(app_key.trim(), app_secret.trim()).await?;
    Ok(())
}

/// 向指定 userId 列表发送 Markdown（模板 `sampleMarkdown`）。
#[tauri::command]
pub async fn dingtalk_enterprise_bot_oto_send_markdown(
    app_key: String,
    app_secret: String,
    robot_code: String,
    user_ids: Vec<String>,
    title: String,
    text: String,
) -> Result<DingTalkOtoBatchSendResult, String> {
    let app_key = app_key.trim().to_string();
    let app_secret = app_secret.trim().to_string();
    let robot_code = robot_code.trim().to_string();
    let title = title.trim().to_string();
    let text = text.trim().to_string();
    let user_ids = normalize_oto_user_ids(user_ids)?;
    if app_key.is_empty() || app_secret.is_empty() {
        return Err("appKey / appSecret 不能为空".to_string());
    }
    if robot_code.is_empty() {
        return Err("robotCode 不能为空".to_string());
    }

    let token = get_internal_access_token(&app_key, &app_secret).await?;
    let msg_param = json!({ "title": title, "text": text });
    robot_oto_batch_send(&token, &robot_code, user_ids, "sampleMarkdown", msg_param).await
}

/// 使用公网 `https://` 图片地址发送单聊图片（模板 `sampleImageMsg`）。
#[tauri::command]
pub async fn dingtalk_enterprise_bot_oto_send_image_by_url(
    app_key: String,
    app_secret: String,
    robot_code: String,
    user_ids: Vec<String>,
    photo_url: String,
) -> Result<DingTalkOtoBatchSendResult, String> {
    let app_key = app_key.trim().to_string();
    let app_secret = app_secret.trim().to_string();
    let robot_code = robot_code.trim().to_string();
    let photo_url = photo_url.trim().to_string();
    let user_ids = normalize_oto_user_ids(user_ids)?;
    if app_key.is_empty() || app_secret.is_empty() {
        return Err("appKey / appSecret 不能为空".to_string());
    }
    if robot_code.is_empty() {
        return Err("robotCode 不能为空".to_string());
    }
    if !photo_url.to_lowercase().starts_with("https://") {
        return Err("photoUrl 须为 https:// 开头的公网图片地址".to_string());
    }
    let token = get_internal_access_token(&app_key, &app_secret).await?;
    let msg_param = json!({ "photoURL": photo_url });
    robot_oto_batch_send(&token, &robot_code, user_ids, "sampleImageMsg", msg_param).await
}

/// 从本机绝对路径读取图片，经 `media/upload` 换 `media_id` 后发送单聊图片。
#[tauri::command]
pub async fn dingtalk_enterprise_bot_oto_send_image_file(
    app_key: String,
    app_secret: String,
    robot_code: String,
    user_ids: Vec<String>,
    local_file_path: String,
) -> Result<DingTalkOtoBatchSendResult, String> {
    let app_key = app_key.trim().to_string();
    let app_secret = app_secret.trim().to_string();
    let robot_code = robot_code.trim().to_string();
    let path = Path::new(local_file_path.trim());
    let user_ids = normalize_oto_user_ids(user_ids)?;
    if app_key.is_empty() || app_secret.is_empty() {
        return Err("appKey / appSecret 不能为空".to_string());
    }
    if robot_code.is_empty() {
        return Err("robotCode 不能为空".to_string());
    }
    if !path.is_absolute() {
        return Err("local_file_path 须为绝对路径".to_string());
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("读取图片文件失败: {}", e))?;
    let fname = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("image.png")
        .to_string();

    let token = get_internal_access_token(&app_key, &app_secret).await?;
    let media_id = upload_oapi_robot_image_media(&token, bytes, &fname).await?;
    let msg_param = json!({ "photoURL": media_id });
    robot_oto_batch_send(&token, &robot_code, user_ids, "sampleImageMsg", msg_param).await
}
