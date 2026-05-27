//! macOS dock context menu: lists registered repositories for quick switching.
//!
//! Uses raw Objective-C (`msg_send!`) because Tauri 2 does not expose `setDockMenu:`.
//! Built at startup (async) and refreshed on `dock-menu-refresh` events from the frontend.
//! Clicking a repository emits `dock-menu-switch-repository` to the frontend.

use tauri::{AppHandle, Emitter, Listener};

use crate::app_state_commands::{StoredRepository, load_repositories};
use crate::wise_mascot::wise_main_window_focus;

const MAX_DOCK_REPOS: usize = 20;

/// Refresh the macOS dock context menu.
pub fn refresh_dock_menu(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let repos = load_repositories(app);
        set_dock_menu(app, &repos);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
fn set_dock_menu(app: &AppHandle, repos: &[StoredRepository]) {
    use objc2::msg_send;
    use objc2::MainThreadOnly;
    use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
    use objc2::rc::Retained;
    use objc2_foundation::{MainThreadMarker, NSString};

    let mtm = MainThreadMarker::new().expect("dock menu must run on main thread");
    let ns_app = NSApplication::sharedApplication(mtm);

    // Build menu
    let menu = NSMenu::new(mtm);

    for repo in repos.iter().take(MAX_DOCK_REPOS) {
        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(mtm),
                &NSString::from_str(&repo.name),
                Some(objc2::sel!(dockMenuAction:)),
                &NSString::new(),
            )
        };
        let _: () = unsafe { msg_send![&item, setTag: repo.id] };
        menu.addItem(&item);
    }

    if !repos.is_empty() {
        menu.addItem(&NSMenuItem::separatorItem(mtm));
    }

    let nw = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            &NSString::from_str("新建窗口"),
            None,
            &NSString::new(),
        )
    };
    let _: () = unsafe { msg_send![&nw, setTag: -1i64] };
    menu.addItem(&nw);

    // Set as dock menu via [NSApp setDockMenu:]
    let ns_app_ptr = Retained::as_ptr(&ns_app) as *mut objc2_app_kit::NSApplication;
    let _: () = unsafe { msg_send![ns_app_ptr, setDockMenu: &*menu] };

    // Store app handle globally for the action handler
    unsafe {
        DOCK_MENU_APP_HANDLE = Some(app.clone());
    }
}

/// Global app handle for the dock menu action callback.
static mut DOCK_MENU_APP_HANDLE: Option<AppHandle> = None;

/// Objective-C action handler for dock menu items.
/// Called by `[NSMenuItem action]` when a menu item is clicked.
///
/// SAFETY: This function must match the signature expected by
/// `NSMenuItem.action` — `-(void)dockMenuAction:(id)sender`.
/// It is set as the action selector for all dock menu items.
#[no_mangle]
extern "C-unwind" fn dockMenuAction(sender: &objc2::runtime::AnyObject) {
    use objc2::msg_send;

    let tag: i64 = unsafe { msg_send![sender, tag] };

    // SAFETY: DOCK_MENU_APP_HANDLE is only written from the main thread
    // during setup, and read from the main thread during menu clicks.
    let app = unsafe { DOCK_MENU_APP_HANDLE.clone() };
    let Some(app) = app else { return };

    if tag == -1 {
        return;
    }

    let _ = wise_main_window_focus(app.clone());
    let _ = app.emit("dock-menu-switch-repository", tag);
}

/// Install the event listener that refreshes the dock menu on `dock-menu-refresh`.
pub fn setup_dock_menu_events(app: &AppHandle) {
    let handle = app.clone();
    app.listen("dock-menu-refresh", move |_event| {
        refresh_dock_menu(&handle);
    });
}
