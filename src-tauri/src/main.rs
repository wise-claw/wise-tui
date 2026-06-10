// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
const _: &str = env!("WISE_INFO_PLIST_LINK_STAMP");

fn main() {
    tauri_app_lib::run()
}
