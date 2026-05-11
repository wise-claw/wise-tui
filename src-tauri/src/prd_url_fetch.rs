use serde::Serialize;
use std::time::Duration;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedPrdContent {
    title: Option<String>,
    content: String,
    source_url: String,
}

fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn remove_tag_blocks_case_insensitive(input: &str, tag: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let open_pat = format!("<{}", tag);
    let close_pat = format!("</{}>", tag);
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0usize;

    while let Some(rel_open) = lower[cursor..].find(&open_pat) {
        let open_start = cursor + rel_open;
        output.push_str(&input[cursor..open_start]);

        let after_open = match lower[open_start..].find('>') {
            Some(pos) => open_start + pos + 1,
            None => {
                cursor = input.len();
                break;
            }
        };

        if let Some(rel_close) = lower[after_open..].find(&close_pat) {
            cursor = after_open + rel_close + close_pat.len();
        } else {
            cursor = input.len();
            break;
        }
    }

    if cursor < input.len() {
        output.push_str(&input[cursor..]);
    }
    output
}

fn extract_first_tag_block(input: &str, tag: &str) -> Option<String> {
    let lower = input.to_ascii_lowercase();
    let open_pat = format!("<{}", tag);
    let close_pat = format!("</{}>", tag);
    let open_start = lower.find(&open_pat)?;
    let content_start_rel = lower[open_start..].find('>')?;
    let content_start = open_start + content_start_rel + 1;
    let close_rel = lower[content_start..].find(&close_pat)?;
    let content_end = content_start + close_rel;
    Some(input[content_start..content_end].to_string())
}

fn decode_basic_html_entities(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn extract_html_title(input: &str) -> Option<String> {
    let lower = input.to_ascii_lowercase();
    let start = lower.find("<title>")?;
    let end = lower.find("</title>")?;
    if end <= start + 7 {
        return None;
    }
    let raw = &input[start + 7..end];
    let title = raw.trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_string())
    }
}

fn normalize_text_blocks(input: &str) -> String {
    input
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[tauri::command]
pub async fn fetch_prd_from_url(url: String) -> Result<FetchedPrdContent, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("仅支持 http/https 链接".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("创建请求客户端失败: {}", e))?;

    let response = client
        .get(trimmed)
        .send()
        .await
        .map_err(|e| format!("拉取链接失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("链接返回异常状态码: {}", response.status()));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("读取页面内容失败: {}", e))?;
    let title = extract_html_title(&body);

    let mut cleaned = body;
    for noisy_tag in [
        "script", "style", "noscript", "svg", "header", "footer", "nav",
    ] {
        cleaned = remove_tag_blocks_case_insensitive(&cleaned, noisy_tag);
    }

    let main_like = extract_first_tag_block(&cleaned, "article")
        .or_else(|| extract_first_tag_block(&cleaned, "main"))
        .or_else(|| extract_first_tag_block(&cleaned, "body"))
        .unwrap_or_else(|| cleaned.clone());

    let plain_text = strip_html_tags(&main_like);
    let decoded_text = decode_basic_html_entities(&plain_text);
    let content = normalize_text_blocks(&decoded_text);

    if content.is_empty() {
        return Err("未提取到有效正文，请尝试粘贴 Markdown 原文".to_string());
    }

    Ok(FetchedPrdContent {
        title,
        content,
        source_url: trimmed.to_string(),
    })
}
