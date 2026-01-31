use crate::services::folder_manager::FolderManager;
use crate::WORLDS;

#[tauri::command]
#[specta::specta]
pub async fn set_world_photographed(world_id: String, is_photographed: bool) -> Result<(), String> {
    FolderManager::set_world_photographed(world_id, is_photographed, WORLDS.get()).map_err(|e| {
        log::error!("Error setting world photographed status: {}", e);
        e.to_string()
    })
}

#[tauri::command]
#[specta::specta]
pub async fn set_world_shared(world_id: String, is_shared: bool) -> Result<(), String> {
    FolderManager::set_world_shared(world_id, is_shared, WORLDS.get()).map_err(|e| {
        log::error!("Error setting world shared status: {}", e);
        e.to_string()
    })
}

#[tauri::command]
#[specta::specta]
pub async fn set_world_favorite(world_id: String, is_favorite: bool) -> Result<(), String> {
    FolderManager::set_world_favorite(world_id, is_favorite, WORLDS.get()).map_err(|e| {
        log::error!("Error setting world favorite status: {}", e);
        e.to_string()
    })
}
