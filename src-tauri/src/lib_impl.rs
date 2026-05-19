use crate::{
    agent_registry, app_state_commands, assistants, cc_wf_studio_mcp_bridge, cc_workflow_studio,
    claude_code_usage, claude_commands, claude_config_dir, claude_external_ingest, code_knowledge_graph,
    cua_driver, dingtalk_enterprise_bot, dingtalk_stream_gateway, extensions, git_commands, mission_control, mcp,
    prd_url_fetch, repository_files, skills, skills_sh, system_resource, trellis_bootstrap, trellis_bridge,
    trellis_runtime, wise_db, wise_mascot, wise_paths, wise_push, workspace_commands,
};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 系统菜单「功能 → 打开 WebView 控制台…」项 id（与 `on_menu_event` 匹配）。
#[cfg(desktop)]
const MENU_ID_OPEN_WEBVIEW_DEVTOOLS: &str = "wise/open-webview-devtools";

// ── App Entry ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            cc_wf_studio_mcp_bridge::kill_stale_cc_wf_studio_mcp_listeners(6282);
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

            // ⌥S / Alt+S：置顶主窗口并切换小窗口模式（与左栏按钮一致）
            let toggle_compact_layout_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyS);
            app.global_shortcut()
                .on_shortcut(toggle_compact_layout_shortcut, |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = wise_mascot::wise_main_window_focus(_app.clone());
                        let _ = _app.emit("global-toggle-compact-layout", ());
                    }
                })
                .map_err(|e| e.to_string())?;

            // ⌥K / Alt+K：置顶主窗口并切换双栏（与中栏按钮一致）
            let toggle_dual_pane_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyK);
            app.global_shortcut()
                .on_shortcut(toggle_dual_pane_shortcut, |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = wise_mascot::wise_main_window_focus(_app.clone());
                        let _ = _app.emit("global-toggle-dual-pane", ());
                    }
                })
                .map_err(|e| e.to_string())?;

            app.manage(wise_mascot::WiseToastMerge::default());
            app.manage(wise_push::WisePushControl::default());
            app.manage(dingtalk_stream_gateway::DingTalkStreamGatewayControl::default());
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
            trellis_runtime::spawn_stale_scanner(app.handle().clone());

            #[cfg(target_os = "macos")]
            if let Some(w) = app.handle().get_webview_window("mascot") {
                let _ = w.set_always_on_top(true);
            }

            Ok(())
        })
        .manage(Mutex::new(workspace_commands::GitWatcherState::new()))
        .manage(Mutex::new(claude_commands::TerminalManager::new()))
        .manage(claude_commands::ClaudeProcessState::default())
        .manage(claude_commands::ClaudeSessionRegistry::new())
        .on_window_event(|window, event| {
            // macOS：主窗口红点关闭默认会销毁窗口，导致后续点击程序坞图标只触发
            // `RunEvent::Reopen` 但 `get_webview_window("main")` 已为 None，没有任何窗口可显示。
            // 与原生 macOS App 行为对齐：拦截关闭事件 → 阻止销毁 → 隐藏整个应用。
            //
            // 注意：这里调用 `app_handle().hide()`（NSApp.hide:，即 Cmd+H）而**不是**
            // `window.hide()`。原因：
            // - `window.hide()` 走的是 NSWindow.orderOut:，单个 NSWindow 被移出窗口序列；
            //   配合 `macos-private-api`（透明背景 / 自定义 chrome）会让 WKWebView 渲染层
            //   失效，dock 点击后 `show()` 出来一片白（已知白屏问题）。
            // - `app_handle().hide()` 走的是 NSApp.hide:，整个应用进入 hidden 状态，
            //   WKWebView 渲染状态完整保留；dock 点击时 macOS 系统自动 unhide，再触发
            //   `RunEvent::Reopen`（见 run 回调），不会白屏。
            #[cfg(target_os = "macos")]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.app_handle().hide();
                }
            }
            // 非 macOS 沿用平台默认行为（Windows / Linux 通常希望关闭即退出）。
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        });

    #[cfg(desktop)]
    let builder = {
        use tauri::menu::{Menu, MenuItem, Submenu};
        builder
            .menu(|app| {
                let menu = Menu::default(app)?;
                let open_console = MenuItem::with_id(
                    app,
                    MENU_ID_OPEN_WEBVIEW_DEVTOOLS,
                    "打开 WebView 控制台…",
                    true,
                    None::<&str>,
                )?;
                let utilities = Submenu::with_items(app, "功能", true, &[&open_console])?;
                menu.append(&utilities)?;
                Ok(menu)
            })
            .on_menu_event(|app, event| {
                if event.id() == MENU_ID_OPEN_WEBVIEW_DEVTOOLS {
                    if let Some(win) = app.get_webview_window("main") {
                        win.open_devtools();
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
            app_state_commands::update_repository_main_owner_agent,
            app_state_commands::update_repository_sdd_mode,
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
            app_state_commands::delete_project,
            app_state_commands::add_repository_to_project,
            app_state_commands::reconcile_project_workspace,
            app_state_commands::resolve_project_root_from_repository,
            app_state_commands::reorder_project_repositories,
            app_state_commands::remove_repository_from_project,
            app_state_commands::get_active_project_id,
            app_state_commands::set_active_project_id,
            app_state_commands::list_project_prd_employee_ids,
            app_state_commands::list_project_prd_workflow_ids,
            app_state_commands::list_workflow_project_ids,
            app_state_commands::add_project_prd_employee,
            app_state_commands::remove_project_prd_employee,
            app_state_commands::add_project_prd_workflow,
            app_state_commands::remove_project_prd_workflow,
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
            app_state_commands::settings_commands::get_repo_task_split_prompt_section,
            app_state_commands::settings_commands::set_repo_task_split_prompt_section,
            app_state_commands::settings_commands::clear_repo_task_split_prompt_section,
            app_state_commands::settings_commands::get_platform_split_prompt_layers,
            app_state_commands::settings_commands::get_project_split_prompt_layers,
            app_state_commands::settings_commands::set_project_split_prompt_layers,
            app_state_commands::settings_commands::clear_project_split_prompt_layers,
            app_state_commands::settings_commands::get_repository_split_prompt_layers,
            app_state_commands::settings_commands::set_repository_split_prompt_layers,
            app_state_commands::settings_commands::clear_repository_split_prompt_layers,
            app_state_commands::settings_commands::get_prd_task_draft,
            app_state_commands::settings_commands::set_prd_task_draft,
            app_state_commands::settings_commands::clear_prd_task_draft,
            app_state_commands::settings_commands::get_app_setting,
            app_state_commands::settings_commands::set_app_setting,
            app_state_commands::settings_commands::delete_app_setting,
            app_state_commands::settings_commands::get_prd_task_split_result,
            app_state_commands::settings_commands::get_prd_executable_tasks_result,
            app_state_commands::settings_commands::set_prd_task_split_result,
            app_state_commands::settings_commands::clear_prd_task_split_result,
            app_state_commands::workflow_run_commands::get_workflow_run,
            app_state_commands::workflow_run_commands::set_workflow_run,
            app_state_commands::workflow_run_commands::list_workflow_runs,
            app_state_commands::workflow_run_commands::append_workflow_event,
            app_state_commands::workflow_run_commands::migrate_workflow_session_tab_references,
            app_state_commands::workflow_run_commands::list_workflow_events,
            mission_control::mission_create_or_resume,
            mission_control::mission_get_snapshot,
            mission_control::mission_list_recent,
            mission_control::mission_append_event,
            mission_control::mission_list_events,
            mission_control::mission_get_requirement_trace,
            mission_control::mission_upsert_agent_assignment,
            mission_control::mission_complete_agent_assignment,
            mission_control::mission_list_agent_assignments,
            mission_control::mission_preview_requirement_reassign,
            mission_control::mission_commit_requirement_reassign,
            mission_control::mission_record_planning_mutation,
            mission_control::mission_attach_to_session,
            mission_control::mission_get_session_mission,
            mission_control::mission_append_instruction,
            mission_control::mission_record_agent_command,
            mission_control::mission_complete_agent_command,
            mission_control::mission_record_evidence,
            mission_control::mission_capture_git_evidence,
            mission_control::mission_list_evidence,
            mission_control::mission_get_replay,
            mission_control::mission_get_onboarding_health,
            prd_url_fetch::fetch_prd_from_url,
            workspace_commands::open_in_finder,
            workspace_commands::open_claude_user_agents_dir,
            workspace_commands::get_claude_user_agents_dir,
            workspace_commands::open_workspace_in,
            git_commands::git_status,
            git_commands::git_stage,
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
            git_commands::git_init,
            git_commands::git_remote_url,
            git_commands::git_list_branches,
            git_commands::git_checkout_branch,
            git_commands::git_create_branch,
            git_commands::git_checkout_detached,
            git_commands::git_worktree_list,
            git_commands::git_worktree_remove,
            git_commands::git_worktree_add_omc_batch,
            workspace_commands::start_git_watcher,
            workspace_commands::stop_git_watcher,
            workspace_commands::run_shell_command,
            repository_files::search_repository_files,
            repository_files::list_repository_explorer_entries,
            repository_files::create_repository_file,
            repository_files::create_repository_directory,
            repository_files::delete_repository_entry,
            trellis_bootstrap::bootstrap_trellis_if_missing,
            trellis_bridge::trellis_list_tasks,
            trellis_bridge::trellis_list_requirement_workspace,
            trellis_bridge::trellis_read_task,
            trellis_bridge::trellis_write_prd,
            trellis_bridge::trellis_write_status,
            trellis_bridge::trellis_list_research,
            trellis_bridge::trellis_detect_sdd_signals,
            trellis_bridge::trellis_list_spec_areas,
            trellis_bridge::trellis_list_spec_tree,
            trellis_bridge::trellis_read_spec_index,
            trellis_bridge::trellis_write_spec_index,
            trellis_bridge::trellis_read_spec_file,
            trellis_bridge::trellis_write_spec_file,
            trellis_runtime::trellis_runtime_record_event,
            trellis_runtime::trellis_runtime_list_events,
            trellis_runtime::trellis_runtime_compile_workflow,
            trellis_runtime::trellis_runtime_run_task_lifecycle,
            trellis_runtime::trellis_runtime_upsert_agent_run,
            trellis_runtime::trellis_runtime_get_agent_ownership_graph,
            trellis_runtime::trellis_agent_heartbeat,
            trellis_runtime::trellis_runtime_record_spec_revision,
            trellis_runtime::trellis_runtime_list_spec_revisions,
            trellis_runtime::trellis_runtime_get_onboarding_state,
            trellis_runtime::trellis_runtime_get_replay,
            trellis_runtime::trellis_runtime_capture_workspace_snapshot,
            trellis_runtime::trellis_runtime_diff_workspace_snapshots,
            claude_external_ingest::ingest_external_claude_cli_sessions,
            claude_commands::terminal::terminal_open,
            claude_commands::terminal::terminal_write,
            claude_commands::terminal::terminal_resize,
            claude_commands::terminal::terminal_close,
            claude_commands::execute_claude_code,
            claude_commands::resume_claude_code,
            claude_commands::cancel_claude_execution,
            claude_commands::cancel_claude_invocation,
            claude_commands::get_claude_spawn_slot_count,
            claude_commands::claude_submit_stdin_line,
            claude_commands::list_running_claude_sessions,
            system_resource::get_system_resource_snapshot,
            claude_code_usage::get_claude_code_usage_snapshot,
            claude_commands::get_claude_config_model,
            claude_commands::get_claude_model_picker_options,
            claude_config_dir::get_claude_user_config_dir,
            claude_config_dir::set_claude_user_config_dir,
            claude_commands::mcp::get_claude_mcp_status,
            claude_commands::mcp::get_claude_mcp_runtime_health,
            claude_commands::mcp::remove_claude_mcp_server,
            claude_commands::mcp::add_claude_mcp_server,
            cua_driver::get_cua_driver_status,
            cua_driver::install_cua_driver,
            cua_driver::macos_open_privacy_pane,
            skills_sh::skills_sh_search,
            skills_sh::skills_cli_add_from_registry,
            skills_sh::skills_cli_remove_from_registry,
            claude_commands::mcp::set_claude_mcp_server_enabled,
            claude_commands::get_claude_hooks_status,
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
            claude_commands::attachments::save_prd_pasted_image,
            claude_commands::attachments::materialize_prd_snapshot,
            claude_commands::attachments::read_project_relative_file,
            claude_commands::attachments::read_project_relative_file_base64,
            claude_commands::attachments::read_snapshot_file,
            claude_commands::attachments::append_project_relative_file,
            claude_commands::attachments::write_project_relative_file,
            claude_commands::attachments::append_wise_relative_file,
            claude_commands::attachments::read_wise_relative_file,
            claude_commands::prd_split::run_prd_split_claude,
            claude_commands::prd_split::run_claude_quick,
            claude_commands::prd_split::read_local_text_file,
            claude_commands::prd_split_pipeline::prd_split_create_parent_task,
            claude_commands::prd_split_pipeline::prd_split_materialize_tasks,
            claude_commands::prd_split_pipeline::prd_split_dispatch_cluster,
            claude_commands::prd_split_pipeline::prd_split_dispatch_cluster_background,
            claude_commands::prd_split_pipeline::prd_split_retry_run,
            claude_commands::prd_split_pipeline::prd_split_cancel_run,
            claude_commands::prd_split_pipeline::prd_split_scan_project_parents,
            claude_commands::prd_split_pipeline::prd_split_mark_children_status,
            claude_commands::prd_split_pipeline::prd_split_list_active_runs,
            claude_commands::prd_split_pipeline::prd_split_list_legacy_runs,
            claude_commands::prd_split_pipeline::prd_split_read_legacy_run,
            claude_commands::attachments::capture_screenshot,
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
            wise_push::wise_push_start,
            wise_push::wise_push_stop,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_ping,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_oto_send_markdown,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_oto_send_image_by_url,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_oto_send_image_file,
            dingtalk_stream_gateway::dingtalk_stream_gateway_start,
            dingtalk_stream_gateway::dingtalk_stream_gateway_stop,
            dingtalk_stream_gateway::dingtalk_stream_gateway_is_running,
            code_knowledge_graph::get_code_graph_subgraph,
            code_knowledge_graph::trigger_code_graph_reindex,
            code_knowledge_graph::cancel_code_graph_reindex,
            code_knowledge_graph::trigger_code_graph_association_build,
            code_knowledge_graph::trigger_code_graph_project_search,
            code_knowledge_graph::build_code_graph_api_associations,
            code_knowledge_graph::get_code_graph_index_status,
            code_knowledge_graph::clear_code_graph_index,
            code_knowledge_graph::import_code_graph_openapi,
            code_knowledge_graph::bridge_code_graph_http,
            code_knowledge_graph::extract_code_graph_synthetic_routes,
            code_knowledge_graph::get_code_graph_multi_subgraph,
            code_knowledge_graph::search_code_graph_nodes,
            cc_workflow_studio::list_cc_workflow_studio_workflows,
            cc_workflow_studio::read_cc_workflow_studio_workflow,
            cc_workflow_studio::write_cc_workflow_studio_workflow,
            cc_workflow_studio::read_cc_workflow_studio_import_file,
            cc_workflow_studio::write_cc_wf_studio_ai_editing_skill,
            cc_wf_studio_mcp_bridge::cc_wf_studio_mcp_bridge_status,
            cc_wf_studio_mcp_bridge::cc_wf_studio_mcp_bridge_resolve,
            cc_wf_studio_mcp_bridge::cc_wf_studio_mcp_set_review_before_apply,
            cc_wf_studio_mcp_bridge::start_cc_wf_studio_mcp_bridge,
            cc_wf_studio_mcp_bridge::ensure_cc_workflow_studio_project_mcp,
            cc_wf_studio_mcp_bridge::stop_cc_wf_studio_mcp_bridge,
            extensions::commands::extensions_list,
            extensions::commands::extensions_get_skills,
            extensions::commands::extensions_get_themes,
            extensions::commands::extensions_get_settings_declarations,
            extensions::commands::extensions_set_enabled,
            extensions::commands::extensions_get_permissions,
            extensions::commands::extensions_reload,
            extensions::commands::extensions_get_mcp_servers,
            extensions::commands::extensions_get_settings_tabs,
            extensions::commands::extensions_read_settings_tab_body,
            assistants::commands::assistants_list,
            assistants::commands::assistants_save_custom,
            assistants::commands::assistants_delete_custom,
            assistants::commands::assistants_get_system_prompt,
            assistants::commands::assistants_get_overrides,
            assistants::commands::assistants_list_overrides,
            assistants::commands::assistants_save_overrides,
            assistants::commands::assistants_reset_overrides,
            assistants::commands::assistants_resolve_runtime,
            skills::commands::skills_detect_external_paths,
            skills::commands::skills_scan_path,
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
            mcp::commands::mcp_list_servers,
            mcp::commands::mcp_save_server,
            mcp::commands::mcp_delete_server,
            mcp::commands::mcp_test_connection,
            mcp::commands::mcp_supported_transports,
        ])
        .build(tauri::generate_context!())
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
