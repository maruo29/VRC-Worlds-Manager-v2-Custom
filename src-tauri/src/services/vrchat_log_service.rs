//! Watching VRChat's own log to know when a world is ready to look at.
//!
//! VRChat writes a plain text log next to its own data, and the app tails it.
//! Nothing is injected into the client and no memory is read - this is the
//! same approach the established community tools take, and it stays well
//! clear of the anti-tamper rules.
//!
//! Timing has to come from the log because it cannot be guessed: measured
//! against four real visits, the gap between joining and the world being up
//! ranged from 11 to 31 seconds, and a first-time download stretches it
//! further.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// VRChat flushes in chunks, so polling faster than this buys nothing.
const POLL: Duration = Duration::from_millis(500);

/// The line VRChat writes once the world is actually up and rendering.
/// `Entering Room` fires far earlier, while the world is still loading.
const READY_MARKER: &str = "Finished entering world.";

const JOINING_MARKER: &str = "Joining wrld_";
const ROOM_MARKER: &str = "Entering Room:";

static WATCHING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldEntered {
    pub world_id: String,
    pub world_name: String,
}

fn log_dir() -> Option<PathBuf> {
    let base = BaseDirsLow::data_local_low()?;
    Some(base.join("VRChat").join("VRChat"))
}

/// `directories` has no notion of LocalLow, which is where Unity puts logs.
struct BaseDirsLow;

impl BaseDirsLow {
    fn data_local_low() -> Option<PathBuf> {
        let profile = std::env::var("USERPROFILE").ok()?;
        Some(PathBuf::from(profile).join("AppData").join("LocalLow"))
    }
}

fn newest_log(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("output_log_")
        })
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

/// `wrld_xxx:12345~private(...)` -> `wrld_xxx`
fn world_id_from_joining(line: &str) -> Option<String> {
    let rest = line.split(JOINING_MARKER).nth(1)?;
    let id = rest.split(':').next()?.trim();
    Some(format!("wrld_{}", id))
}

pub struct VrchatLogService;

impl VrchatLogService {
    /// Starts tailing the log, emitting `vrchat-world-entered` when a world
    /// finishes loading. Safe to call twice; the second call does nothing.
    pub fn start(app: AppHandle) -> Result<(), String> {
        if WATCHING.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        let dir = log_dir().ok_or("Could not locate the VRChat log folder")?;
        if !dir.exists() {
            WATCHING.store(false, Ordering::SeqCst);
            return Err(format!(
                "No VRChat log folder at {}. Has VRChat ever been run?",
                dir.display()
            ));
        }

        log::info!("[vrclog] watching {}", dir.display());

        std::thread::spawn(move || {
            // Start at the end of the current log: past sessions are history,
            // not events.
            let mut current = newest_log(&dir);
            let mut offset = current
                .as_ref()
                .and_then(|path| std::fs::metadata(path).ok())
                .map(|meta| meta.len())
                .unwrap_or(0);

            // Both live only inside this thread, so no sharing is needed.
            let mut pending_name = String::new();
            let mut pending_id = String::new();

            while WATCHING.load(Ordering::SeqCst) {
                // A fresh VRChat start writes a whole new file.
                if let Some(newest) = newest_log(&dir) {
                    if current.as_deref() != Some(newest.as_path()) {
                        log::info!("[vrclog] following {}", newest.display());
                        current = Some(newest);
                        offset = 0;
                    }
                }

                if let Some(path) = &current {
                    if let Some(chunk) = read_from(path, &mut offset) {
                        for line in chunk.lines() {
                            if line.contains(ROOM_MARKER) {
                                pending_name = line
                                    .split(ROOM_MARKER)
                                    .nth(1)
                                    .unwrap_or("")
                                    .trim()
                                    .to_string();
                            } else if line.contains(JOINING_MARKER) {
                                if let Some(world_id) = world_id_from_joining(line) {
                                    log::info!("[vrclog] joining {}", world_id);
                                    pending_id = world_id.clone();

                                    // Recorded as it happens, because VRChat
                                    // keeps only a handful of log files and
                                    // this is the one chance to see it.
                                    let at = chrono::Utc::now().timestamp_millis();
                                    tauri::async_runtime::spawn(async move {
                                        crate::services::VisitedService::record(
                                            &world_id, at,
                                        )
                                        .await;
                                    });
                                }
                            } else if line.contains(READY_MARKER) {
                                if pending_id.is_empty() {
                                    continue;
                                }
                                log::info!("[vrclog] world ready: {}", pending_id);
                                let _ = app.emit(
                                    "vrchat-world-entered",
                                    WorldEntered {
                                        world_id: pending_id.clone(),
                                        world_name: pending_name.clone(),
                                    },
                                );
                            }
                        }
                    }
                }

                std::thread::sleep(POLL);
            }

            log::info!("[vrclog] stopped");
        });

        Ok(())
    }

    pub fn stop() {
        WATCHING.store(false, Ordering::SeqCst);
    }

    pub fn is_watching() -> bool {
        WATCHING.load(Ordering::SeqCst)
    }
}


/// Reads whatever has been appended since `offset`, advancing it.
fn read_from(path: &Path, offset: &mut u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();

    // A rotated or truncated file starts over rather than seeking past its end.
    if len < *offset {
        *offset = 0;
    }
    if len == *offset {
        return None;
    }

    file.seek(SeekFrom::Start(*offset)).ok()?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).ok()?;
    *offset += buffer.len() as u64;

    Some(String::from_utf8_lossy(&buffer).into_owned())
}
