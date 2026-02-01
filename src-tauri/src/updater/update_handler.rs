use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Url};
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_specta::Event;

use crate::changelog::ChangelogVersion;

#[derive(Clone)]
pub struct UpdateHandler {
    app_handle: AppHandle,
    initialized: bool,

    update_available: bool,
    update_version: Option<String>,
    update_handler: Option<Update>,

    downloaded_update_data: Option<Vec<u8>>,
    changelog: Option<Vec<ChangelogVersion>>,

    show_notification: bool,
}

#[derive(Serialize, Debug, Clone, Copy, specta::Type, tauri_specta::Event)]
pub struct UpdateProgress {
    pub progress: f32,
}

impl UpdateProgress {
    pub fn new(progress: f32) -> Self {
        Self { progress }
    }
}

impl UpdateHandler {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            initialized: false,

            update_available: false,
            update_version: None,
            update_handler: None,

            downloaded_update_data: None,
            changelog: None,

            show_notification: true,
        }
    }

    pub async fn check_for_update(
        &mut self,
        _channel: &UpdateChannel,
    ) -> tauri_plugin_updater::Result<bool> {
        // Auto-update disabled
        self.update_available = false;
        self.update_version = None;
        self.initialized = true;
        Ok(false)
    }

    pub async fn download_update(&mut self) -> tauri_plugin_updater::Result<()> {
        log::info!("Auto-update disabled, skipping download.");
        Ok(())
    }

    pub fn install_update(&self) -> Result<(), String> {
        Err("Auto-update disabled".to_string())
    }

    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    pub fn update_available(&self) -> bool {
        self.update_available
    }

    pub fn update_version(&self) -> Option<&str> {
        self.update_version.as_deref()
    }

    pub fn get_changelog(&self) -> Option<&Vec<ChangelogVersion>> {
        self.changelog.as_ref()
    }

    pub fn set_changelog(&mut self, changelog: Vec<ChangelogVersion>) {
        self.changelog = Some(changelog);
    }

    pub async fn show_notification(&self) -> bool {
        self.show_notification
    }

    pub async fn set_show_notification(&mut self, show_notification: bool) {
        self.show_notification = show_notification;
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, specta::Type)]
pub enum UpdateChannel {
    #[serde(rename = "stable")]
    Stable,
    #[serde(rename = "pre-release")]
    PreRelease,
}

impl UpdateChannel {
    pub fn as_str(&self) -> &str {
        match self {
            UpdateChannel::Stable => "stable",
            UpdateChannel::PreRelease => "pre-release",
        }
    }
}
