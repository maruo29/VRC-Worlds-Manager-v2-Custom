use crate::services::visited_service::{VisitedService, VisitedWorld};
use crate::services::vrchat_log_service::VrchatLogService;
use crate::services::world_shot_service::{WorldShot, WorldShotService};
use tauri::{AppHandle, State};

/// Captures the VRChat window and files the result under the given world.
#[tauri::command]
#[specta::specta]
pub fn capture_world_shot(world_id: String) -> Result<WorldShot, String> {
    WorldShotService::capture(&world_id)
}

#[tauri::command]
#[specta::specta]
pub fn get_world_shots(world_id: String) -> Result<Vec<WorldShot>, String> {
    WorldShotService::list(&world_id)
}

/// One shot as a `data:` URL, for the frontend to put straight in an <img>.
#[tauri::command]
#[specta::specta]
pub fn read_world_shot(world_id: String, file_name: String) -> Result<String, String> {
    WorldShotService::read_data_url(&world_id, &file_name)
}

#[tauri::command]
#[specta::specta]
pub fn delete_world_shot(world_id: String, file_name: String) -> Result<(), String> {
    WorldShotService::delete(&world_id, &file_name)
}

/// Bytes held by every stored shot, for the settings screen.
#[tauri::command]
#[specta::specta]
pub fn get_world_shot_storage() -> u64 {
    WorldShotService::total_bytes()
}

/// Starts tailing VRChat's log. The frontend then listens for
/// `vrchat-world-entered` to know when a world has finished loading.
/// Every world known to have been visited.
#[tauri::command]
#[specta::specta]
pub async fn get_visited_worlds() -> Vec<VisitedWorld> {
    VisitedService::all().await
}

/// Rebuilds the visited list from whatever VRChat's logs still hold, and from
/// VRChat's own recently-visited listing. Both only ever add.
#[tauri::command]
#[specta::specta]
pub async fn refresh_visited_worlds() -> Result<usize, String> {
    let from_logs = VisitedService::scan_logs().await?;

    let cookie_store = crate::AUTHENTICATOR.get().read().await.get_cookies();
    match crate::services::ApiService::get_recently_visited_worlds(cookie_store).await {
        Ok(worlds) => {
            let ids: Vec<String> = worlds.into_iter().map(|world| world.world_id).collect();
            VisitedService::record_many_undated(&ids).await
        }
        Err(e) => {
            // The logs are the more complete source anyway, so a failure here
            // is worth noting rather than failing the whole refresh.
            log::warn!("[visited] recently-visited lookup failed: {}", e);
            Ok(from_logs)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn start_vrchat_log_watch(handle: State<'_, AppHandle>) -> Result<(), String> {
    VrchatLogService::start((*handle).clone())
}

#[tauri::command]
#[specta::specta]
pub fn stop_vrchat_log_watch() {
    VrchatLogService::stop();
}

#[tauri::command]
#[specta::specta]
pub fn is_vrchat_log_watching() -> bool {
    VrchatLogService::is_watching()
}
