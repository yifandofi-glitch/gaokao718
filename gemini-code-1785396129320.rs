// JOY背单词 桌面 App —— Tauri 入口
// 前端为纯静态站点（../site），无需任何后端逻辑。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}