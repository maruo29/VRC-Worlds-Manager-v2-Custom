//! Thumbnail colour features, used as a supporting signal for related worlds.
//!
//! Colour turns out to describe the *mood* of a world well (dark neon night vs
//! pale quiet interior) but to say nothing about its genre - a dark shooting
//! range looks like a dark ruin. It is therefore only ever used to boost
//! candidates that already matched on something else.
//!
//! VRChat serves a resized variant of every thumbnail
//! (`/api/1/image/{fileId}/{version}/128`) which is roughly a fortieth the
//! size of the full image, so analysing a whole library costs about 11 MB
//! rather than 360 MB. Features are cached on disk and never recomputed.

use directories::BaseDirs;
use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Duration;
use tauri::async_runtime::Mutex;

/// Hue buckets; 16 is enough to tell blue night from orange sunset.
pub const HUE_BINS: usize = 16;
/// Greys are binned by lightness instead, so monochrome worlds still compare.
pub const ACHROMATIC_BINS: usize = 4;
const TOTAL_BINS: usize = HUE_BINS + ACHROMATIC_BINS;

/// Analysis resolution. The histogram does not get better above this.
const SAMPLE_SIZE: u32 = 32;

/// Below this saturation a pixel is treated as grey rather than coloured.
const SATURATION_FLOOR: f32 = 0.15;

const CACHE_FILE: &str = "color_features.json";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ColorFeatures {
    /// Hue bins followed by achromatic lightness bins, summing to 1.
    pub histogram: Vec<f32>,
    pub mean_lightness: f32,
    pub mean_saturation: f32,
    /// Spread of lightness; separates flat gloom from high-contrast neon.
    pub lightness_spread: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ColorTarget {
    pub world_id: String,
    /// The full-size image URL as stored on the world; resized here.
    pub image_url: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ColorAnalysisResult {
    pub analyzed: usize,
    pub failed: usize,
    /// Worlds already cached before this call.
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ColorFeatureEntry {
    pub world_id: String,
    pub features: ColorFeatures,
}

static CACHE: LazyLock<Mutex<Option<HashMap<String, ColorFeatures>>>> =
    LazyLock::new(|| Mutex::new(None));

fn cache_path() -> PathBuf {
    BaseDirs::new()
        .expect("Failed to get base directories")
        .data_local_dir()
        .join("VRC_Worlds_Manager_new")
        .join(CACHE_FILE)
}

async fn ensure_loaded() {
    let mut cache = CACHE.lock().await;
    if cache.is_some() {
        return;
    }

    let loaded = std::fs::read_to_string(cache_path())
        .ok()
        .and_then(|text| serde_json::from_str::<HashMap<String, ColorFeatures>>(&text).ok())
        .unwrap_or_default();

    log::info!("[color] loaded {} cached feature sets", loaded.len());
    *cache = Some(loaded);
}

async fn persist() -> Result<(), String> {
    let cache = CACHE.lock().await;
    let Some(map) = cache.as_ref() else {
        return Ok(());
    };

    let json = serde_json::to_string(map)
        .map_err(|e| format!("Failed to serialise colour features: {}", e))?;
    std::fs::write(cache_path(), json)
        .map_err(|e| format!("Failed to write colour features: {}", e))
}

/// `/file/{id}/{ver}/file` -> `/image/{id}/{ver}/128`, which is ~40x smaller.
fn thumbnail_url(image_url: &str) -> Option<String> {
    let (head, rest) = image_url.split_once("/file/")?;
    let mut parts = rest.split('/');
    let file_id = parts.next()?;
    let version = parts.next()?;

    if !file_id.starts_with("file_") {
        return None;
    }

    Some(format!("{}/image/{}/{}/128", head, file_id, version))
}

/// Standard HSL conversion; only hue, saturation and lightness are needed.
fn to_hsl(r: u8, g: u8, b: u8) -> (f32, f32, f32) {
    let (r, g, b) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let lightness = (max + min) / 2.0;
    let delta = max - min;

    if delta.abs() < f32::EPSILON {
        return (0.0, 0.0, lightness);
    }

    let saturation = if lightness > 0.5 {
        delta / (2.0 - max - min)
    } else {
        delta / (max + min)
    };

    let hue = if (max - r).abs() < f32::EPSILON {
        ((g - b) / delta).rem_euclid(6.0)
    } else if (max - g).abs() < f32::EPSILON {
        (b - r) / delta + 2.0
    } else {
        (r - g) / delta + 4.0
    } * 60.0;

    (hue.rem_euclid(360.0), saturation, lightness)
}

fn analyze_image(bytes: &[u8]) -> Result<ColorFeatures, String> {
    let image = image::load_from_memory(bytes)
        .map_err(|e| format!("Failed to decode the thumbnail: {}", e))?
        .thumbnail_exact(SAMPLE_SIZE, SAMPLE_SIZE)
        .to_rgb8();

    let mut bins = vec![0f32; TOTAL_BINS];
    let mut lightness_values: Vec<f32> = Vec::with_capacity((SAMPLE_SIZE * SAMPLE_SIZE) as usize);
    let mut saturation_sum = 0f32;

    for (_, _, pixel) in image.view(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).pixels() {
        let (hue, saturation, lightness) = to_hsl(pixel[0], pixel[1], pixel[2]);
        lightness_values.push(lightness);
        saturation_sum += saturation;

        if saturation > SATURATION_FLOOR && (0.08..0.95).contains(&lightness) {
            let bin = ((hue / 360.0) * HUE_BINS as f32) as usize;
            bins[bin.min(HUE_BINS - 1)] += 1.0;
        } else {
            let bin = (lightness * ACHROMATIC_BINS as f32) as usize;
            bins[HUE_BINS + bin.min(ACHROMATIC_BINS - 1)] += 1.0;
        }
    }

    let pixels = lightness_values.len() as f32;
    if pixels == 0.0 {
        return Err("The thumbnail had no pixels".to_string());
    }

    for bin in &mut bins {
        *bin /= pixels;
    }

    let mean_lightness = lightness_values.iter().sum::<f32>() / pixels;
    let variance = lightness_values
        .iter()
        .map(|l| (l - mean_lightness).powi(2))
        .sum::<f32>()
        / pixels;

    Ok(ColorFeatures {
        histogram: bins,
        mean_lightness,
        mean_saturation: saturation_sum / pixels,
        lightness_spread: variance.sqrt(),
    })
}

pub struct ColorService;

impl ColorService {
    /// Cached features only; never touches the network.
    pub async fn get_features(world_ids: Vec<String>) -> Vec<ColorFeatureEntry> {
        ensure_loaded().await;
        let cache = CACHE.lock().await;
        let Some(map) = cache.as_ref() else {
            return vec![];
        };

        world_ids
            .into_iter()
            .filter_map(|world_id| {
                map.get(&world_id).map(|features| ColorFeatureEntry {
                    world_id,
                    features: features.clone(),
                })
            })
            .collect()
    }

    /// How many worlds already have features, for the settings screen.
    pub async fn analyzed_count() -> usize {
        ensure_loaded().await;
        CACHE.lock().await.as_ref().map_or(0, HashMap::len)
    }

    /// Fetches and analyses anything not cached yet. Callers pass small
    /// batches so progress can be shown and the work stays interruptible.
    pub async fn analyze(targets: Vec<ColorTarget>) -> Result<ColorAnalysisResult, String> {
        ensure_loaded().await;

        let pending: Vec<ColorTarget> = {
            let cache = CACHE.lock().await;
            let map = cache.as_ref().expect("cache loaded above");
            targets
                .iter()
                .filter(|target| !map.contains_key(&target.world_id))
                .cloned()
                .collect()
        };

        let skipped = targets.len() - pending.len();
        if pending.is_empty() {
            return Ok(ColorAnalysisResult {
                analyzed: 0,
                failed: 0,
                skipped,
            });
        }

        // VRChat answers 403 to any request without a User-Agent, including
        // the plain image endpoint, so this has to carry the app's own.
        let client = reqwest::ClientBuilder::new()
            .user_agent(crate::api::common::USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| format!("Failed to build the image client: {}", e))?;

        let mut analyzed = 0usize;
        let mut failed = 0usize;

        for target in pending {
            let Some(url) = thumbnail_url(&target.image_url) else {
                failed += 1;
                continue;
            };

            let features = match client.get(&url).send().await {
                Ok(response) if response.status().is_success() => match response.bytes().await {
                    Ok(bytes) => analyze_image(&bytes),
                    Err(e) => Err(format!("Failed to read the thumbnail: {}", e)),
                },
                Ok(response) => Err(format!("Thumbnail request returned {}", response.status())),
                Err(e) => Err(format!("Thumbnail request failed: {}", e)),
            };

            match features {
                Ok(features) => {
                    let mut cache = CACHE.lock().await;
                    if let Some(map) = cache.as_mut() {
                        map.insert(target.world_id.clone(), features);
                    }
                    analyzed += 1;
                }
                Err(e) => {
                    log::warn!("[color] {} failed: {}", target.world_id, e);
                    failed += 1;
                }
            }
        }

        persist().await?;

        Ok(ColorAnalysisResult {
            analyzed,
            failed,
            skipped,
        })
    }
}
