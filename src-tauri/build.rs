fn main() {
    // macOS dev：通过 build-time codegen + `tauri_build_context!` 把合并后的 Info.plist
    // 嵌入 `__TEXT,__info_plist`。勿用 `generate_context!`（proc-macro 会覆盖 padding），
    // 亦勿再用 `-sectcreate` 重复嵌入，否则 TCC 无法解析并直接 abort。
    println!("cargo:rerun-if-changed=Info.plist");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=Entitlements.plist");

    #[cfg(target_os = "macos")]
    {
        validate_macos_privacy_plist();
        emit_info_plist_link_stamp();
    }

    // 使用 build-time codegen + `tauri_build_context!`，避免 `generate_context!` 在 proc-macro
    // 阶段再次写入未对齐的 plist，覆盖 build.rs 中的 padding。
    tauri_build::try_build(
        tauri_build::Attributes::default().codegen(tauri_build::CodegenContext::new()),
    )
    .expect("failed to run tauri build");

    #[cfg(target_os = "macos")]
    pad_dev_embedded_info_plist();
}

/// dev 构建时 tauri-codegen 会把合并后的 Info.plist 写入 OUT_DIR 并由 `embed_plist` 链接进
/// `__TEXT,__info_plist`。若字节长度不是 4 的倍数，链接器会在段尾补 0，TCC 会把 `</plist>`
/// 与 `>` 拆开并判定缺少 NSSpeechRecognitionUsageDescription 后直接 abort。
#[cfg(target_os = "macos")]
fn pad_dev_embedded_info_plist() {
    let out_dir = match std::env::var("OUT_DIR") {
        Ok(dir) => dir,
        Err(_) => return,
    };

    let entries = match std::fs::read_dir(&out_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }

        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };

        if !bytes.starts_with(b"<?xml")
            || !bytes
                .windows(b"NSSpeechRecognitionUsageDescription".len())
                .any(|window| window == b"NSSpeechRecognitionUsageDescription")
        {
            continue;
        }

        let original_len = bytes.len();
        let mut padded = bytes;
        while padded.len() % 4 != 0 {
            padded.push(b'\n');
        }

        if padded.len() != original_len {
            std::fs::write(&path, &padded).expect("pad dev embedded Info.plist for TCC alignment");
        }
        return;
    }
}

/// 让 `wise` 可执行文件在 Info.plist 变更后必定重链；仅重编 `tauri_app_lib` 不会刷新 `__info_plist`。
#[cfg(target_os = "macos")]
fn emit_info_plist_link_stamp() {
    use std::hash::{Hash, Hasher};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for path in ["Info.plist", "tauri.conf.json"] {
        if let Ok(bytes) = std::fs::read(path) {
            bytes.hash(&mut hasher);
        }
    }
    println!(
        "cargo:rustc-env=WISE_INFO_PLIST_LINK_STAMP={}",
        hasher.finish()
    );
}

#[cfg(target_os = "macos")]
fn validate_macos_privacy_plist() {
    const PLIST_PATH: &str = "Info.plist";
    const REQUIRED_KEYS: &[&str] = &[
        "NSMicrophoneUsageDescription",
        "NSSpeechRecognitionUsageDescription",
    ];

    let content = match std::fs::read_to_string(PLIST_PATH) {
        Ok(c) => c,
        Err(e) => panic!("{PLIST_PATH} 无法读取: {e}"),
    };

    for key in REQUIRED_KEYS {
        if !content.contains(&format!("<key>{key}</key>")) {
            panic!(
                "{PLIST_PATH} 缺少 {key}。\
                 麦克风/语音识别在未声明用途说明时，macOS TCC 会直接 abort 进程。"
            );
        }
    }
}
