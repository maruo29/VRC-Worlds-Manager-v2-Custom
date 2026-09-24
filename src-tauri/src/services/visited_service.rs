//! Which worlds have actually been visited.
//!
//! VRChat keeps only the last few log files - three, holding 23 worlds, on the
//! machine this was written against - so reading them on demand would forget
//! almost everything. They are therefore scanned once and merged into a file
//! of our own, which only ever grows as the log watcher sees new arrivals.

use chrono::{NaiveDateTime, TimeZone, Utc};
use directories::BaseDirs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use tauri::async_runtime::Mutex;

const CACHE_FILE: &str = "visited_worlds.json";

/// `2026.09.12 12:19:34 Debug      -  [Behaviour] Joining wrld_...`
const LOG_TIME_FORMAT: &str = "%Y.%m.%d %H:%M:%S";

const JOINING_MARKER: &str = "Joining wrld_";

/// Epoch millis of the last visit, or 0 when a world is known to have been
/// visited but not when - which is all VRChat's own history endpoint says.
type VisitMap = HashMap<String, i64>;

static VISITED: LazyLock<Mutex<Option<VisitMap>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VisitedWorld {
    pub world_id: String,
    /// Epoch millis, or 0 when the date is not known.
    pub last_visited: i64,
}

fn cache_path() -> PathBuf {
    BaseDirs::new()
        .expect("Failed to get base directories")
        .data_local_dir()
        .join("VRC_Worlds_Manager_new")
        .join(CACHE_FILE)
}

fn log_dir() -> Option<PathBuf> {
    let profile = std::env::var("USERPROFILE").ok()?;
    Some(
        PathBuf::from(profile)
            .join("AppData")
            .join("LocalLow")
            .join("VRChat")
            .join("VRChat"),
    )
}

async fn ensure_loaded() {
    let mut cache = VISITED.lock().await;
    if cache.is_some() {
        return;
    }

    let loaded = std::fs::read_to_string(cache_path())
        .ok()
        .and_then(|text| serde_json::from_str::<VisitMap>(&text).ok())
        .unwrap_or_default();

    log::info!("[visited] loaded {} world(s)", loaded.len());
    *cache = Some(loaded);
}

async fn persist() -> Result<(), String> {
    let cache = VISITED.lock().await;
    let Some(map) = cache.as_ref() else {
        return Ok(());
    };

    let json = serde_json::to_string(map)
        .map_err(|e| format!("Failed to serialise visited worlds: {}", e))?;
    std::fs::write(cache_path(), json)
        .map_err(|e| format!("Failed to write visited worlds: {}", e))
}

/// `... Joining wrld_xxx:12345~private(...)` -> the bare world id.
fn world_id_from_line(line: &str) -> Option<String> {
    let rest = line.split(JOINING_MARKER).nth(1)?;
    let id = rest.split(':').next()?.trim();
    if id.is_empty() {
        return None;
    }
    Some(format!("wrld_{}", id))
}

/// VRChat writes local time; without a zone the best available reading is to
/// treat it as UTC, which can be a few hours out. Only ever used for ordering
/// and for "have I been here", so that is good enough.
fn timestamp_from_line(line: &str) -> i64 {
    let Some(stamp) = line.get(..19) else {
        return 0;
    };
    NaiveDateTime::parse_from_str(stamp, LOG_TIME_FORMAT)
        .ok()
        .and_then(|naive| Utc.from_local_datetime(&naive).single())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

pub struct VisitedService;

impl VisitedService {
    /// Records a visit, keeping the most recent timestamp for a world.
    pub async fn record(world_id: &str, at_millis: i64) {
        ensure_loaded().await;

        {
            let mut cache = VISITED.lock().await;
            let Some(map) = cache.as_mut() else {
                return;
            };
            let entry = map.entry(world_id.to_string()).or_insert(0);
            if at_millis > *entry {
                *entry = at_millis;
            }
        }

        if let Err(e) = persist().await {
            log::warn!("[visited] {}", e);
        }
    }

    /// Merges every visit still readable from VRChat's own logs.
    ///
    /// Returns how many worlds the file knows about afterwards.
    pub async fn scan_logs() -> Result<usize, String> {
        ensure_loaded().await;

        let Some(dir) = log_dir() else {
            return Err("Could not locate the VRChat log folder".into());
        };

        let mut found: VisitMap = HashMap::new();
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Err(format!("No VRChat log folder at {}", dir.display()));
        };

        for entry in entries.filter_map(Result::ok) {
            if !entry
                .file_name()
                .to_string_lossy()
                .starts_with("output_log_")
            {
                continue;
            }

            let Ok(text) = std::fs::read_to_string(entry.path()) else {
                continue;
            };

            for line in text.lines() {
                if !line.contains(JOINING_MARKER) {
                    continue;
                }
                let Some(world_id) = world_id_from_line(line) else {
                    continue;
                };
                let at = timestamp_from_line(line);
                let slot = found.entry(world_id).or_insert(0);
                if at > *slot {
                    *slot = at;
                }
            }
        }

        let total = {
            let mut cache = VISITED.lock().await;
            let map = cache.as_mut().expect("loaded above");
            for (world_id, at) in found {
                let slot = map.entry(world_id).or_insert(0);
                if at > *slot {
                    *slot = at;
                }
            }
            map.len()
        };

        persist().await?;
        log::info!("[visited] {} world(s) after scanning logs", total);
        Ok(total)
    }

    /// Marks worlds as visited without a date, for sources that do not carry
    /// one - VRChat's own "recently visited" listing, for instance.
    pub async fn record_many_undated(world_ids: &[String]) -> Result<usize, String> {
        ensure_loaded().await;

        let total = {
            let mut cache = VISITED.lock().await;
            let map = cache.as_mut().expect("loaded above");
            for world_id in world_ids {
                map.entry(world_id.clone()).or_insert(0);
            }
            map.len()
        };

        persist().await?;
        Ok(total)
    }

    pub async fn all() -> Vec<VisitedWorld> {
        ensure_loaded().await;
        let cache = VISITED.lock().await;
        let Some(map) = cache.as_ref() else {
            return vec![];
        };

        map.iter()
            .map(|(world_id, last_visited)| VisitedWorld {
                world_id: world_id.clone(),
                last_visited: *last_visited,
            })
            .collect()
    }
}
