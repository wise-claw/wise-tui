fn main() {
    // macOS dev：`tauri-codegen` 会在 `dev` 构建时通过 `embed_plist` 把合并后的
    // Info.plist 写入 `__TEXT,__info_plist`。切勿再用 `-sectcreate` 嵌入同一份 plist，
    // 否则段内会出现两份 XML，TCC 无法解析并直接 abort（缺少 NSSpeechRecognitionUsageDescription）。
    tauri_build::build();
}
