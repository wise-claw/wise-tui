use crate::{
    agent_registry, app_state_commands, assistants, at_mention_shortcuts, cc_switch_import,
    in_app_shortcuts,
    claude_code_usage, claude_commands, codex_commands, claude_config_dir,
    claude_llm_proxy, claude_model_profiles,
    cursor_agent, fcc_traces, free_claude_code, opencode_go_proxy,
    cua_driver, dingtalk_enterprise_bot, dingtalk_stream_gateway, extensions, git_commands,
    main_window, mcp, my_extensions,
    openspec_bootstrap, project_relative_files, remote_channels, repository_files, skills, skills_sh, system_resource,
    composer_image_gc, wise_data_cleanup, wise_db, wise_mascot, wise_paths, wise_push,
    workspace_commands,
    workspace_inspector_commands,
    execution_environment_dispatch_commands,
};
#[cfg(target_os = "macos")]
use crate::macos_terminal_detect;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 系统菜单「功能 → 打开 WebView 控制台…」项 id（与 `on_menu_event` 匹配）。
#[cfg(desktop)]
const MENU_ID_OPEN_WEBVIEW_DEVTOOLS: &str = "wise/open-webview-devtools";
#[cfg(desktop)]
const MENU_ID_CLOSE_WEBVIEW_DEVTOOLS: &str = "wise/close-webview-devtools";
#[cfg(desktop)]
const MENU_ID_NEW_MAIN_WINDOW: &str = "wise/new-main-window";
#[cfg(desktop)]
const MENU_ID_CLOSE_MAIN_WINDOW: &str = "wise/close-main-window";

// ── App Entry ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            use keyboard_types::{Code, Modifiers};
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
            let screenshot_shortcut = Shortcut::new(None, Code::F3);
            app.global_shortcut()
                .on_shortcut(screenshot_shortcut, |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        // Trigger screenshot via frontend event
                        let _ = _app.emit("global-screenshot", ());
                    }
                })
                .map_err(|e| e.to_string())?;

            // ⌥Z / Alt+Z：置顶主窗口并通知前端聚焦会话输入框（macOS 上 Alt 对应 Option）
            let focus_composer_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyZ);
            app.global_shortcut()
                .on_shortcut(focus_composer_shortcut, |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = wise_mascot::wise_main_window_focus(_app.clone());
                        let _ = _app.emit("global-focus-composer", ());
                    }
                })
                .map_err(|e| e.to_string())?;

            // ⌥S / Alt+S：置顶主窗口并打开默认配置弹窗（与左栏按钮一致）
            let open_default_config_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyS);
            app.global_shortcut()
                .on_shortcut(open_default_config_shortcut, |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = wise_mascot::wise_main_window_focus(_app.clone());
                        let _ = _app.emit("global-open-default-config", ());
                    }
                })
                .map_err(|e| e.to_string())?;

            // ⌥K / Alt+K：置顶主窗口并切换双栏（与中栏按钮一致）
            let toggle_dual_pane_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyK);
            app.global_shortcut()
                .on_shortcut(toggle_dual_pane_shortcut, |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = wise_mascot::wise_main_window_focus(_app.clone());
                        let _ = _app.emit("global-cycle-multi-pane", ());
                    }
                })
                .map_err(|e| e.to_string())?;

            at_mention_shortcuts::init(app.handle());
            in_app_shortcuts::init(app.handle());
            for (label, win) in app.webview_windows() {
                if main_window::is_main_workspace_window_label(&label)
                    && win.is_focused().unwrap_or(false)
                {
                    let _ = in_app_shortcuts::register_search_shortcuts(app.handle());
                    break;
                }
            }

            app.manage(wise_mascot::WiseToastMerge::default());
            app.manage(wise_push::WisePushControl::default());
            app.manage(dingtalk_stream_gateway::DingTalkStreamGatewayControl::default());
            app.manage(remote_channels::GenericWsControl::default());
            let wise_db = wise_db::WiseDb::open().map_err(|e| e.to_string())?;
            wise_mascot::restore_mascot_on_launch(app.handle(), &wise_db)?;
            claude_config_dir::init_from_db(&wise_db);
            app.manage(wise_db);
            let extension_registry = extensions::ExtensionRegistry::new();
            let extension_home = wise_paths::wise_dir().ok();
            extension_registry
                .initialize(extension_home, &[])
                .map_err(|e| format!("extension registry init: {e}"))?;
            app.manage(extension_registry);
            app.manage(agent_registry::AgentRegistry::new());
            composer_image_gc::spawn_composer_image_gc_scanner(app.handle().clone());
            claude_llm_proxy::bootstrap_from_db(app.handle());
            opencode_go_proxy::bootstrap_from_db(app.handle());

            #[cfg(target_os = "macos")]
            crate::macos_webview_wake_recovery::register_macos_webview_wake_recovery(app.handle());

            #[cfg(target_os = "macos")]
            if let Some(w) = app.handle().get_webview_window("mascot") {
                let _ = w.set_always_on_top(true);
            }

            Ok(())
        })
        .manage(Mutex::new(workspace_commands::GitWatcherState::new()))
        .manage(Mutex::new(claude_commands::TerminalManager::new()))
        .manage(claude_commands::ClaudeProcessState::default())
        .manage(claude_commands::ClaudeSessionRegistry::new());
    #[cfg(target_os = "macos")]
    let builder = builder.manage(crate::macos_speech_stream::MacosStreamingSpeechState::default());
    let builder = builder.manage(crate::sherpa_sensevoice::SherpaSenseVoiceState::default());

    #[cfg(desktop)]
    let builder = {
        use tauri::menu::{Menu, MenuItem, Submenu};
        builder
            .on_window_event(|window, event| {
                if main_window::is_main_workspace_window_label(window.label()) {
                    if let tauri::WindowEvent::Focused(focused) = event {
                        let _ = in_app_shortcuts::set_main_window_search_shortcuts_active(
                            window.app_handle(),
                            *focused,
                        );
                    }
                    // macOS：主工作区窗口红点关闭 → 隐藏应用（主窗）或销毁（辅助窗）。
                    #[cfg(target_os = "macos")]
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if main_window::is_primary_main_workspace_window_label(window.label()) {
                            api.prevent_close();
                            let _ = window.app_handle().hide();
                        }
                    }
                    if let tauri::WindowEvent::Destroyed = event {
                        let label = window.label().to_string();
                        main_window::cleanup_aux_main_workspace_window_assets(
                            window.app_handle(),
                            &label,
                        );
                    }
                }
            })
            .menu(|app| {
                let menu = Menu::default(app)?;
                let open_console = MenuItem::with_id(
                    app,
                    MENU_ID_OPEN_WEBVIEW_DEVTOOLS,
                    "打开 WebView 控制台…",
                    true,
                    None::<&str>,
                )?;
                let close_console = MenuItem::with_id(
                    app,
                    MENU_ID_CLOSE_WEBVIEW_DEVTOOLS,
                    "关闭 WebView 控制台",
                    true,
                    None::<&str>,
                )?;
                let new_window = MenuItem::with_id(
                    app,
                    MENU_ID_NEW_MAIN_WINDOW,
                    "新建窗口",
                    true,
                    Some("Shift+CmdOrCtrl+N"),
                )?;
                let close_window = MenuItem::with_id(
                    app,
                    MENU_ID_CLOSE_MAIN_WINDOW,
                    "关闭窗口",
                    true,
                    Some("CmdOrCtrl+W"),
                )?;
                let window_menu = Submenu::with_items(
                    app,
                    "窗口",
                    true,
                    &[&new_window, &close_window],
                )?;
                let utilities = Submenu::with_items(
                    app,
                    "功能",
                    true,
                    &[&open_console, &close_console],
                )?;
                menu.append(&window_menu)?;
                menu.append(&utilities)?;
                Ok(menu)
            })
            .on_menu_event(|app, event| {
                if event.id() == MENU_ID_NEW_MAIN_WINDOW {
                    let _ = main_window::open_main_workspace_window(app, None);
                } else if event.id() == MENU_ID_CLOSE_MAIN_WINDOW {
                    let _ = main_window::close_focused_main_workspace_window(app);
                } else if event.id() == MENU_ID_OPEN_WEBVIEW_DEVTOOLS {
                    let mut opened = false;
                    for (label, win) in app.webview_windows() {
                        if main_window::is_main_workspace_window_label(&label)
                            && win.is_focused().unwrap_or(false)
                        {
                            win.open_devtools();
                            opened = true;
                            break;
                        }
                    }
                    if !opened {
                        if let Some(win) = app.get_webview_window("main") {
                            win.open_devtools();
                        }
                    }
                } else if event.id() == MENU_ID_CLOSE_WEBVIEW_DEVTOOLS {
                    let mut closed = false;
                    for (label, win) in app.webview_windows() {
                        if main_window::is_main_workspace_window_label(&label)
                            && win.is_focused().unwrap_or(false)
                        {
                            win.close_devtools();
                            closed = true;
                            break;
                        }
                    }
                    if !closed {
                        if let Some(win) = app.get_webview_window("main") {
                            win.close_devtools();
                        }
                    }
                }
            })
    };

    builder
        .invoke_handler(tauri::generate_handler![
            app_state_commands::greet,
            app_state_commands::list_repositories,
            app_state_commands::create_repository_from_path,
            app_state_commands::update_repository_icon_display,
            app_state_commands::update_repository_icon_badge,
            app_state_commands::update_repository_main_owner_agent,
            app_state_commands::update_repository_execution_engine,
            app_state_commands::update_repository_sdd_mode,
            app_state_commands::update_repository_open_app_id,
            app_state_commands::update_repository_role_tags,
            app_state_commands::remove_repository,
            app_state_commands::remove_repository_global,
            app_state_commands::list_projects,
            app_state_commands::create_project,
            app_state_commands::update_project_name,
            app_state_commands::update_project_icon_badge,
            app_state_commands::update_project_root_path,
            app_state_commands::update_project_sdd_mode,
            app_state_commands::update_project_main_agent,
            app_state_commands::update_project_open_app_id,
            app_state_commands::delete_project,
            app_state_commands::add_repository_to_project,
            app_state_commands::reconcile_project_workspace,
            app_state_commands::reorder_project_repositories,
            app_state_commands::remove_repository_from_project,
            app_state_commands::get_active_project_id,
            app_state_commands::set_active_project_id,
            app_state_commands::list_employees,
            app_state_commands::create_employee,
            app_state_commands::update_employee,
            app_state_commands::delete_employee,
            app_state_commands::move_employee_display_order,
            app_state_commands::list_employee_task_counts,
            app_state_commands::list_workflow_templates,
            app_state_commands::save_workflow_template,
            app_state_commands::delete_workflow_template,
            app_state_commands::workflow_graph_commands::get_workflow_graph,
            app_state_commands::workflow_graph_commands::save_workflow_graph,
            app_state_commands::workflow_graph_commands::validate_workflow_graph,
            app_state_commands::create_workflow_task,
            app_state_commands::list_workflow_tasks,
            app_state_commands::list_task_events,
            app_state_commands::get_acceptance_verdict_source_stats,
            app_state_commands::append_task_event,
            app_state_commands::list_task_pending_employees,
            app_state_commands::decide_workflow_task_stage,
            app_state_commands::end_workflow_task,
            app_state_commands::settings_commands::get_task_template,
            app_state_commands::settings_commands::set_task_template,
            app_state_commands::settings_commands::get_app_setting,
            app_state_commands::settings_commands::get_app_settings_batch,
            app_state_commands::settings_commands::set_app_setting,
            app_state_commands::settings_commands::delete_app_setting,
            workspace_inspector_commands::list_project_workspace_quick_actions,
            workspace_inspector_commands::save_project_workspace_quick_actions,
            workspace_inspector_commands::list_repository_workspace_quick_actions,
            workspace_inspector_commands::save_repository_workspace_quick_actions,
            workspace_inspector_commands::list_project_workspace_todos,
            workspace_inspector_commands::save_project_workspace_todos,
            workspace_inspector_commands::list_repository_workspace_todos,
            workspace_inspector_commands::save_repository_workspace_todos,
            execution_environment_dispatch_commands::upsert_execution_environment_dispatch_batch,
            execution_environment_dispatch_commands::upsert_execution_environment_dispatch_item,
            execution_environment_dispatch_commands::list_execution_environment_dispatches_for_anchor,
            execution_environment_dispatch_commands::list_execution_environment_dispatches_for_repository,
            app_state_commands::workflow_run_commands::get_workflow_run,
            app_state_commands::workflow_run_commands::set_workflow_run,
            app_state_commands::workflow_run_commands::list_workflow_runs,
            app_state_commands::workflow_run_commands::append_workflow_event,
            app_state_commands::workflow_run_commands::migrate_workflow_session_tab_references,
            app_state_commands::workflow_run_commands::list_workflow_events,
            workspace_commands::open_in_finder,
            workspace_commands::write_text_file_absolute,
            workspace_commands::open_claude_user_agents_dir,
            workspace_commands::get_claude_user_agents_dir,
            workspace_commands::open_workspace_in,
            #[cfg(target_os = "macos")]
            macos_terminal_detect::macos_detect_terminals,
            git_commands::git_status,
            git_commands::git_status_summary,
            git_commands::git_stage,
            git_commands::git_stage_paths,
            git_commands::git_stage_all,
            git_commands::git_unstage,
            git_commands::git_unstage_all,
            git_commands::git_commit,
            git_commands::git_push,
            git_commands::git_pull,
            git_commands::git_fetch,
            git_commands::git_show_revision,
            git_commands::git_discard,
            git_commands::git_discard_all,
            git_commands::git_log,
            git_commands::git_graph,
            git_commands::git_commit_detail,
            git_commands::git_compare_commits,
            git_commands::git_create_tag,
            git_commands::git_delete_tag,
            git_commands::git_blame_file,
            git_commands::git_checkout_revision,
            git_commands::git_cherry_pick,
            git_commands::git_revert,
            git_commands::git_reset,
            git_commands::git_init,
            git_commands::prepare_empty_repository_dir,
            git_commands::git_clone_repository,
            git_commands::git_remote_url,
            git_commands::git_list_branches,
            git_commands::git_checkout_branch,
            git_commands::git_create_branch,
            git_commands::git_delete_branch,
            git_commands::git_worktree_list,
            git_commands::git_worktree_remove,
            git_commands::git_worktree_add_omc_batch,
            workspace_commands::start_git_watcher,
            workspace_commands::stop_git_watcher,
            workspace_commands::run_shell_command,
            repository_files::search_repository_files,
            repository_files::search_repository_file_contents,
            repository_files::path_is_accessible_directory,
            repository_files::list_repository_explorer_entries,
            repository_files::list_repository_explorer_children,
            repository_files::create_repository_file,
            repository_files::create_repository_directory,
            repository_files::delete_repository_entry,
            project_relative_files::detect_workspace_sdd_signals,
            project_relative_files::read_project_relative_file,
            project_relative_files::read_project_relative_file_base64,
            project_relative_files::list_project_relative_directory,
            project_relative_files::write_project_relative_file,
            project_relative_files::append_project_relative_file,
            project_relative_files::read_wise_relative_file,
            project_relative_files::append_wise_relative_file,
            openspec_bootstrap::bootstrap_openspec_if_missing,
            claude_commands::terminal::terminal_open,
            claude_commands::terminal::terminal_attach,
            claude_commands::terminal::terminal_list,
            claude_commands::terminal::terminal_get,
            claude_commands::terminal::terminal_update_title,
            claude_commands::terminal::terminal_write,
            claude_commands::terminal::terminal_resize,
            claude_commands::terminal::terminal_close,
            claude_llm_proxy::list_claude_llm_proxy_records,
            claude_llm_proxy::clear_claude_llm_proxy_records,
            claude_llm_proxy::get_claude_llm_proxy_status,
            claude_llm_proxy::get_claude_llm_proxy_config,
            claude_llm_proxy::set_claude_llm_proxy_config,
            claude_commands::execute_claude_code,
            codex_commands::execute_codex_code,
            claude_commands::resume_claude_code,
            claude_commands::spawn_streaming_session,
            claude_commands::send_user_message_to_session,
            claude_commands::close_streaming_session,
            claude_commands::cancel_claude_execution,
            claude_commands::cancel_claude_invocation,
            claude_commands::get_claude_spawn_slot_count,
            claude_commands::claude_submit_stdin_line,
            claude_commands::list_running_claude_sessions,
            system_resource::get_system_resource_snapshot,
            system_resource::kill_claude_host_process,
            claude_code_usage::get_claude_code_usage_snapshot,
            claude_commands::get_claude_config_model,
            claude_commands::get_claude_model_picker_options,
            claude_config_dir::get_claude_user_settings_json_path,
            claude_config_dir::sanitize_claude_credentials_for_fcc,
            free_claude_code::get_free_claude_code_status,
            free_claude_code::start_free_claude_code_server,
            free_claude_code::stop_free_claude_code_server,
            free_claude_code::install_free_claude_code,
            free_claude_code::uninstall_free_claude_code,
            free_claude_code::open_free_claude_code_admin,
            free_claude_code::apply_free_claude_code_claude_settings,
            opencode_go_proxy::get_opencode_go_proxy_status,
            opencode_go_proxy::save_opencode_go_proxy_prefs,
            opencode_go_proxy::switch_opencode_go_proxy_model,
            opencode_go_proxy::set_opencode_go_proxy_config,
            opencode_go_proxy::apply_opencode_go_proxy_client_settings,
            opencode_go_proxy::apply_opencode_go_proxy_claude_settings,
            opencode_go_proxy::apply_opencode_go_proxy_codex_settings,
            opencode_go_proxy::list_opencode_go_proxy_models,
            opencode_go_proxy::validate_opencode_go_proxy_config,
            opencode_go_proxy::list_opencode_go_proxy_traces,
            opencode_go_proxy::clear_opencode_go_proxy_traces,
            fcc_traces::list_fcc_traces,
            fcc_traces::clear_fcc_traces,
            claude_model_profiles::get_claude_model_profile_store,
            claude_model_profiles::get_model_profile_effective_models,
            claude_model_profiles::upsert_claude_model_profile,
            claude_model_profiles::delete_claude_model_profile,
            claude_model_profiles::apply_claude_model_profile,
            claude_model_profiles::failover_to_next_model_profile,
            claude_model_profiles::set_claude_model_profile_auto_failover,
            claude_model_profiles::reorder_claude_model_profiles,
            claude_model_profiles::create_claude_model_profile,
            claude_model_profiles::create_claude_model_profile_from_current,
            claude_model_profiles::get_claude_user_settings_json,
            claude_model_profiles::get_codex_user_settings_json,
            claude_model_profiles::get_opencode_user_settings_json,
            claude_model_profiles::save_claude_user_settings_json,
            cc_switch_import::sync_claude_model_profiles_from_cc_switch,
            claude_commands::mcp::get_claude_mcp_status,
            claude_commands::mcp::get_claude_mcp_runtime_health,
            claude_commands::mcp::remove_claude_mcp_server,
            claude_commands::mcp::add_claude_mcp_server,
            cua_driver::get_cua_driver_status,
            cua_driver::install_cua_driver,
            cua_driver::macos_open_privacy_pane,
            #[cfg(target_os = "macos")]
            crate::macos_microphone::macos_request_microphone_access,
            #[cfg(target_os = "macos")]
            crate::macos_speech::macos_local_speech_capabilities,
            #[cfg(target_os = "macos")]
            crate::macos_speech::macos_transcribe_composer_wav,
            #[cfg(target_os = "macos")]
            crate::macos_speech_stream::macos_streaming_speech_start,
            #[cfg(target_os = "macos")]
            crate::macos_speech_stream::macos_streaming_speech_append_pcm,
            #[cfg(target_os = "macos")]
            crate::macos_speech_stream::macos_streaming_speech_finish,
            #[cfg(target_os = "macos")]
            crate::macos_speech_stream::macos_streaming_speech_cancel,
            crate::sherpa_sensevoice::composer_sherpa_speech_capabilities,
            crate::sherpa_sensevoice::composer_sherpa_download_models,
            crate::sherpa_sensevoice::composer_sherpa_cancel_download_models,
            crate::sherpa_sensevoice::composer_sherpa_speech_start,
            crate::sherpa_sensevoice::composer_sherpa_speech_append_pcm,
            crate::sherpa_sensevoice::composer_sherpa_speech_finish,
            crate::sherpa_sensevoice::composer_sherpa_speech_cancel,
            skills_sh::skills_sh_search,
            skills_sh::skills_cli_add_from_registry,
            skills_sh::skills_cli_remove_from_registry,
            claude_commands::plugin_market::claude_plugin_market_bootstrap,
            claude_commands::plugin_market::claude_plugin_list_installed,
            claude_commands::plugin_market::claude_plugin_install,
            claude_commands::plugin_market::claude_plugin_scan_marketplace_source,
            claude_commands::plugin_market::claude_plugin_uninstall,
            claude_commands::mcp::set_claude_mcp_server_enabled,
            claude_commands::mcp::materialize_claude_spawn_mcp_config,
            claude_commands::get_claude_hooks_status,
            claude_commands::is_omc_plugin_installed,
            claude_commands::upsert_claude_hook,
            claude_commands::remove_claude_hook,
            claude_commands::set_claude_disable_all_hooks,
            claude_commands::subagents::list_claude_subagents,
            claude_commands::subagents::list_claude_available_agents,
            claude_commands::subagents::create_claude_subagent,
            claude_commands::subagents::get_claude_subagent_detail,
            claude_commands::subagents::save_claude_subagent,
            claude_commands::subagents::delete_claude_subagent,
            claude_commands::project_skills::list_claude_project_skills,
            claude_commands::project_skills::list_claude_user_skills,
            claude_commands::project_skills::list_claude_plugin_cache_skills,
            claude_commands::project_skills::create_claude_project_skill,
            claude_commands::project_skills::delete_claude_project_skill,
            claude_commands::project_skills::list_claude_project_skill_files,
            claude_commands::project_skills::get_claude_project_skill_file,
            claude_commands::project_skills::save_claude_project_skill_file,
            claude_commands::project_skills::delete_claude_project_skill_file,
            claude_commands::project_skills::format_claude_project_skill_file,
            claude_commands::disk_sessions::list_claude_disk_sessions,
            claude_commands::disk_sessions::load_claude_session_jsonl,
            claude_commands::disk_sessions::delete_claude_disk_session,
            claude_commands::attachments::save_composer_image,
            claude_commands::attachments::read_composer_image,
            claude_commands::attachments::capture_screenshot,
            claude_commands::quick::run_claude_quick,
            claude_commands::claude_cli::run_claude_cli_command,
            wise_data_cleanup::open_wise_home_dir,
            wise_data_cleanup::list_wise_data_cleanup_categories,
            wise_data_cleanup::cleanup_wise_data_categories,
            composer_image_gc::get_composer_image_gc_stats,
            composer_image_gc::run_composer_image_gc_command,
            composer_image_gc::get_composer_image_gc_config,
            composer_image_gc::set_composer_image_gc_config,
            app_state_commands::load_session_tabs,
            app_state_commands::save_session_tabs,
            wise_mascot::wise_mascot_show,
            wise_mascot::wise_mascot_hide,
            wise_mascot::wise_mascot_save_position,
            wise_mascot::wise_notification_unread_total,
            wise_mascot::wise_notification_ingest,
            wise_mascot::wise_notification_mark_all_read,
            wise_mascot::wise_notification_mark_read,
            wise_mascot::wise_notification_mark_omc_direct_batch_read_for_batch,
            wise_mascot::wise_notification_list_recent,
            wise_mascot::wise_main_window_focus,
            main_window::wise_open_main_window,
            main_window::wise_close_main_workspace_window,
            wise_push::wise_push_start,
            wise_push::wise_push_stop,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_ping,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_oto_send_markdown,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_oto_send_image_by_url,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_oto_send_image_file,
            dingtalk_stream_gateway::dingtalk_stream_gateway_start,
            dingtalk_stream_gateway::dingtalk_stream_gateway_stop,
            dingtalk_stream_gateway::dingtalk_stream_gateway_is_running,
            dingtalk_stream_gateway::dingtalk_stream_gateway_status,
            remote_channels::feishu_webhook_send,
            remote_channels::feishu_webhook_test,
            remote_channels::wecom_webhook_send,
            remote_channels::wecom_webhook_test,
            remote_channels::telegram_bot_send_message,
            remote_channels::telegram_bot_test,
            remote_channels::generic_ws_start,
            remote_channels::generic_ws_stop,
            remote_channels::generic_ws_status,
            remote_channels::generic_ws_send_text,
            extensions::commands::extensions_list,
            extensions::commands::extensions_get_skills,
            extensions::commands::extensions_get_themes,
            extensions::commands::extensions_get_settings_declarations,
            extensions::commands::extensions_set_enabled,
            extensions::commands::extensions_get_permissions,
            extensions::commands::extensions_reload,
            extensions::commands::extensions_install_hello_world_example,
            extensions::commands::extensions_get_mcp_servers,
            extensions::commands::extensions_get_settings_tabs,
            extensions::commands::extensions_read_settings_tab_body,
            my_extensions::commands::my_extensions_library_list,
            my_extensions::commands::my_extensions_library_remove,
            my_extensions::commands::my_extensions_library_home,
            my_extensions::commands::my_extensions_library_update_name,
            my_extensions::commands::my_extensions_library_list_snapshot_tree,
            my_extensions::commands::my_extensions_library_get_content,
            my_extensions::commands::my_extensions_library_save_content,
            my_extensions::commands::my_extensions_library_create_snapshot_file,
            my_extensions::commands::my_extensions_library_create_snapshot_directory,
            my_extensions::commands::my_extensions_library_delete_snapshot_entry,
            my_extensions::commands::my_extensions_discover,
            my_extensions::commands::my_extensions_capture,
            my_extensions::commands::my_extensions_capture_all,
            my_extensions::commands::my_extensions_capture_from_path,
            my_extensions::commands::my_extensions_install_from_library,
            my_extensions::commands::my_extensions_install_hello_world,
            my_extensions::commands::my_extensions_sync_repository_scan,
            assistants::commands::assistants_list,
            assistants::commands::assistants_save_custom,
            assistants::commands::assistants_delete_custom,
            assistants::commands::assistants_delete,
            assistants::commands::assistants_get_system_prompt,
            assistants::commands::assistants_get_overrides,
            assistants::commands::assistants_list_overrides,
            assistants::commands::assistants_save_overrides,
            assistants::commands::assistants_reset_overrides,
            assistants::commands::assistants_resolve_runtime,
            skills::commands::skills_detect_external_paths,
            skills::commands::skills_scan_path,
            skills::commands::skills_read_instruction,
            skills::commands::skills_add_external_path,
            skills::commands::skills_remove_external_path,
            skills::commands::skills_list_external_paths,
            skills::commands::skills_import_copy,
            skills::commands::skills_import_symlink,
            skills::commands::skills_delete_imported,
            skills::commands::skills_export_symlink,
            skills::commands::skills_wise_home,
            agent_registry::agent_registry_list,
            agent_registry::agent_registry_refresh,
            agent_registry::agent_registry_get,
            agent_registry::agent_registry_test_custom,
            agent_registry::agent_registry_save_custom,
            agent_registry::agent_registry_delete_custom,
            agent_registry::agent_registry_install_builtin,
            agent_registry::agent_registry_update_builtin,
            agent_registry::agent_registry_uninstall_builtin,
            cursor_agent::cursor_agent_get_status,
            cursor_agent::cursor_agent_set_api_key,
            cursor_agent::cursor_agent_clear_api_key,
            cursor_agent::cursor_agent_probe,
            cursor_agent::cursor_agent_probe_repository_files,
            cursor_agent::cursor_agent_probe_agent_write,
            cursor_agent::cursor_agent_list_models,
            cursor_agent::cursor_agent_read_spawn_mcp_servers,
            cursor_agent::load_cursor_session_jsonl_command,
            cursor_agent::execute_cursor_code,
            mcp::commands::mcp_list_servers,
            mcp::commands::mcp_save_server,
            mcp::commands::mcp_delete_server,
            mcp::commands::mcp_test_connection,
            mcp::commands::mcp_supported_transports,
            at_mention_shortcuts::cmd_register_at_mention_shortcuts,
        ])
        .build(tauri::tauri_build_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS：点击程序坞图标时 NSApplication 触发 Reopen。
            //
            // 配合 `on_window_event` 里把红点关闭改为 `app_handle().hide()`：dock 点击时
            // 系统会先 NSApp.unhide，再发 Reopen。这里显式再 `app.show()` 一次保证窗口栈
            // 归位（hide 之前已最小化等场景下也能覆盖），然后聚焦主窗口。
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                let _ = app_handle.show();
                let _ = wise_mascot::wise_main_window_focus(app_handle.clone());
            }
        });
}
