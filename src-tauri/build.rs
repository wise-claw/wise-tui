fn main() {
    // macOS dev：`tauri-codegen` 会在 `dev` 构建时通过 `embed_plist` 把合并后的
    // Info.plist 写入 `__TEXT,__info_plist`。切勿再用 `-sectcreate` 嵌入同一份 plist，
    // 否则段内会出现两份 XML，TCC 无法解析并直接 abort（缺少 NSSpeechRecognitionUsageDescription）。
    println!("cargo:rerun-if-changed=Info.plist");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=Entitlements.plist");

    #[cfg(target_os = "macos")]
    validate_macos_privacy_plist();

    tauri_build::build();
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
