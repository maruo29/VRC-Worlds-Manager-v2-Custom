use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::definitions::DefaultInstanceType;

/// Custom data structure to store app-specific extensions
/// This is stored separately from the main data files to maintain
/// backward compatibility with the original VRC World Manager V2.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CustomData {
    /// Version of the custom data format for future migrations
    #[serde(default = "default_version")]
    pub version: u32,
    
    /// Map of world_id -> is_favorite status
    #[serde(rename = "worldFavorites", default)]
    pub world_favorites: HashMap<String, bool>,
    
    /// Map of folder_name -> color (hex string like "#a855f7")
    #[serde(rename = "folderColors", default)]
    pub folder_colors: HashMap<String, String>,
    
    /// Extended preferences
    #[serde(default)]
    pub preferences: CustomPreferences,
}

fn default_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CustomPreferences {
    /// Default instance type for creating instances
    #[serde(rename = "defaultInstanceType", default)]
    pub default_instance_type: DefaultInstanceType,
}

impl CustomData {
    pub fn new() -> Self {
        Self {
            version: 1,
            world_favorites: HashMap::new(),
            folder_colors: HashMap::new(),
            preferences: CustomPreferences::default(),
        }
    }
    
    /// Sets the favorite status for a world
    pub fn set_world_favorite(&mut self, world_id: &str, is_favorite: bool) {
        if is_favorite {
            self.world_favorites.insert(world_id.to_string(), true);
        } else {
            self.world_favorites.remove(world_id);
        }
    }
    
    /// Gets the favorite status for a world
    pub fn is_world_favorite(&self, world_id: &str) -> bool {
        self.world_favorites.get(world_id).copied().unwrap_or(false)
    }
    
    /// Sets the color for a folder
    pub fn set_folder_color(&mut self, folder_name: &str, color: Option<&str>) {
        match color {
            Some(c) => {
                self.folder_colors.insert(folder_name.to_string(), c.to_string());
            }
            None => {
                self.folder_colors.remove(folder_name);
            }
        }
    }
    
    /// Gets the color for a folder
    pub fn get_folder_color(&self, folder_name: &str) -> Option<&String> {
        self.folder_colors.get(folder_name)
    }
    
    /// Renames a folder in the color map (used when folder is renamed)
    pub fn rename_folder(&mut self, old_name: &str, new_name: &str) {
        if let Some(color) = self.folder_colors.remove(old_name) {
            self.folder_colors.insert(new_name.to_string(), color);
        }
    }
    
    /// Removes a folder from the color map (used when folder is deleted)
    pub fn remove_folder(&mut self, folder_name: &str) {
        self.folder_colors.remove(folder_name);
    }
}
