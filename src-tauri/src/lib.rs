mod attachments;
mod connection;
mod github_skills;
mod knowledge;
mod local_data;
mod mcp;
mod providers;
mod skills;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(mcp::McpStore::new(app.path().app_data_dir()?.join("mcp")));
            app.manage(providers::ProviderStore::new(
                app.path().app_data_dir()?.join("providers"),
            ));
            app.manage(attachments::AttachmentStore::new(
                app.path().app_data_dir()?.join("attachments"),
            ));
            app.manage(knowledge::KnowledgeStore::new(
                app.path().app_data_dir()?.join("knowledge"),
            ));
            app.manage(skills::SkillStore::new(
                app.path().app_data_dir()?.join("skills"),
            ));
            Ok(())
        })
        .manage(connection::CancellationRegistry::default())
        .manage(mcp::ApprovalRegistry::default())
        .invoke_handler(tauri::generate_handler![
            providers::list_provider_configs,
            providers::add_custom_provider,
            providers::save_provider_config,
            providers::remove_custom_provider,
            connection::has_provider_key,
            connection::save_provider_key,
            connection::remove_provider_key,
            connection::list_available_models,
            connection::send_chat,
            connection::stream_chat,
            connection::stream_chat_mcp,
            connection::cancel_chat,
            mcp::list_mcp_servers,
            mcp::save_mcp_server,
            mcp::remove_mcp_server,
            mcp::test_mcp_server,
            mcp::save_mcp_token,
            mcp::remove_mcp_token,
            mcp::decide_mcp_tool,
            connection::get_model_capabilities,
            connection::validate_chat_attachments,
            attachments::save_chat_attachment,
            attachments::get_chat_attachment,
            attachments::remove_chat_attachments,
            attachments::clean_unused_attachments,
            skills::preview_skill,
            skills::list_skills,
            skills::get_skill,
            skills::save_skill,
            skills::set_skill_enabled,
            skills::remove_skill,
            github_skills::preview_github_skill,
            github_skills::install_github_skill,
            knowledge::list_knowledge_bases,
            knowledge::get_knowledge_base,
            knowledge::save_knowledge_base,
            knowledge::import_knowledge_documents,
            knowledge::set_knowledge_base_enabled,
            knowledge::remove_knowledge_base,
            knowledge::remove_knowledge_document,
            knowledge::get_knowledge_document,
            knowledge::search_knowledge_base,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
