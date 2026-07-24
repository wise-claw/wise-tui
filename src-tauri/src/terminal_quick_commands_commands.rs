use crate::terminal_quick_commands_db::TerminalQuickCommandDto;
use crate::wise_db::WiseDb;
use tauri::State;

#[tauri::command]
pub(crate) fn list_terminal_quick_commands(
    db: State<'_, WiseDb>,
) -> Result<Vec<TerminalQuickCommandDto>, String> {
    db.list_terminal_quick_commands()
}

#[tauri::command]
pub(crate) fn save_terminal_quick_commands(
    db: State<'_, WiseDb>,
    items: Vec<TerminalQuickCommandDto>,
) -> Result<Vec<TerminalQuickCommandDto>, String> {
    db.save_terminal_quick_commands(items)
}
