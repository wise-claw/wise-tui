#[derive(Clone)]
pub struct SubagentParsed {
    pub name: String,
    pub description: String,
    pub model: Option<String>,
    pub tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub permission_mode: Option<String>,
    pub memory: Option<String>,
    pub frontmatter: String,
    pub prompt: String,
}

pub fn validate_claude_subagent_name(name: &str) -> Result<(), String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("subagent 名称不能为空".to_string());
    }
    if n.len() > 128 {
        return Err("subagent 名称过长（最多 128 字符）".to_string());
    }
    let ok = n
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !ok {
        return Err("subagent 名称仅允许小写字母、数字与连字符".to_string());
    }
    Ok(())
}

fn parse_tools_value(v: &str) -> Vec<String> {
    let t = v.trim();
    if t.is_empty() {
        return Vec::new();
    }
    if t.starts_with('[') && t.ends_with(']') {
        let inner = &t[1..t.len().saturating_sub(1)];
        return inner
            .split(',')
            .map(|x| x.trim().trim_matches('"').trim_matches('\''))
            .filter(|x| !x.is_empty())
            .map(|x| x.to_string())
            .collect();
    }
    t.split(',')
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
        .map(|x| x.to_string())
        .collect()
}

pub fn parse_subagent_markdown(raw: &str) -> Result<SubagentParsed, String> {
    let normalized = raw.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return Err("缺少 YAML frontmatter（需以 --- 开始）".to_string());
    }
    let mut end_idx: Option<usize> = None;
    for (i, line) in lines.iter().enumerate().skip(1) {
        if line.trim() == "---" {
            end_idx = Some(i);
            break;
        }
    }
    let e = end_idx.ok_or_else(|| "frontmatter 未正确闭合（缺少结尾 ---）".to_string())?;
    let frontmatter = lines[1..e].join("\n");
    let prompt = if e + 1 < lines.len() {
        lines[e + 1..].join("\n")
    } else {
        String::new()
    };

    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut model: Option<String> = None;
    let mut tools: Vec<String> = Vec::new();
    let mut disallowed_tools: Vec<String> = Vec::new();
    let mut permission_mode: Option<String> = None;
    let mut memory: Option<String> = None;

    for line in frontmatter.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let Some((k, v)) = t.split_once(':') else {
            continue;
        };
        let key = k.trim();
        let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
        match key {
            "name" => {
                if !val.is_empty() {
                    name = Some(val);
                }
            }
            "description" => {
                if !val.is_empty() {
                    description = Some(val);
                }
            }
            "model" => {
                if !val.is_empty() {
                    model = Some(val);
                }
            }
            "tools" => {
                tools = parse_tools_value(&val);
            }
            "disallowedTools" => {
                disallowed_tools = parse_tools_value(&val);
            }
            "permissionMode" => {
                if !val.is_empty() {
                    permission_mode = Some(val);
                }
            }
            "memory" => {
                if !val.is_empty() {
                    memory = Some(val);
                }
            }
            _ => {}
        }
    }

    let name = name.ok_or_else(|| "frontmatter 缺少 name".to_string())?;
    validate_claude_subagent_name(&name)?;
    let description = description.ok_or_else(|| "frontmatter 缺少 description".to_string())?;
    if description.trim().is_empty() {
        return Err("description 不能为空".to_string());
    }

    Ok(SubagentParsed {
        name,
        description,
        model,
        tools,
        disallowed_tools,
        permission_mode,
        memory,
        frontmatter,
        prompt,
    })
}
