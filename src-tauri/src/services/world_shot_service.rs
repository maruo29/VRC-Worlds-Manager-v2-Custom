//! Screenshots taken inside a world, stored against that world.
//!
//! A thumbnail is chosen by the author to sell the world; it often says little
//! about what standing in the place is actually like. A shot taken on arrival
//! does, so the app can take one and keep it alongside the world.
//!
//! Capture goes through `Windows.Graphics.Capture`, which is the only path
//! that sees a DirectX window: the older GDI routes hand back a black
//! rectangle for anything the GPU drew. Verified against VRChat itself.

use directories::BaseDirs;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use serde::Serialize;
use std::path::PathBuf;

/// Stored width. Below roughly this, signage and distant detail turn to mush
/// and the shot stops answering the question it was taken to answer.
const STORE_WIDTH: u32 = 1280;

/// Measured on real captures: a detailed world lands around 200-400 KB here.
const STORE_QUALITY: u8 = 82;

/// A capture this dark is a loading screen, an unlit intro or a fade, not a
/// look at the world. Measured: a genuinely dark gimmick world scored 92%
/// near-black, an ordinary daylit one 1.2%.
const USELESS_BLACK_RATIO: f64 = 0.90;

/// Pixels at or below this on every channel count as black.
const NEAR_BLACK: u8 = 8;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldShot {
    pub world_id: String,
    /// File name, unique within the world's folder.
    pub file_name: String,
    /// Absolute path, for the frontend to load through the asset protocol.
    pub path: String,
    /// Milliseconds since the epoch, from the file name.
    pub taken_at: i64,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    /// True when the frame was almost entirely black, so the UI can offer to
    /// retake it rather than leaving the user wondering.
    pub looks_blank: bool,
}

fn shots_root() -> PathBuf {
    BaseDirs::new()
        .expect("Failed to get base directories")
        .data_local_dir()
        .join("VRC_Worlds_Manager_new")
        .join("world_shots")
}

/// World ids are opaque VRChat ids, but they arrive from the frontend, so
/// they are never trusted as a path component without checking.
fn world_dir(world_id: &str) -> Result<PathBuf, String> {
    let safe = world_id.starts_with("wrld_")
        && world_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !safe {
        return Err(format!("Not a world id: {}", world_id));
    }
    Ok(shots_root().join(world_id))
}

/// File names come back from the frontend, so they must not be able to walk
/// out of the world's own folder.
fn safe_file_name(file_name: &str) -> Result<&str, String> {
    let safe = !file_name.is_empty()
        && !file_name.contains("..")
        && file_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_');
    if safe {
        Ok(file_name)
    } else {
        Err(format!("Not a shot file name: {}", file_name))
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The VRChat window, or None when the client is not up.
///
/// Matched narrowly: this app's own window carries "VRC" in its title too,
/// and capturing ourselves would be a confusing bug to chase.
fn find_vrchat_window() -> Option<xcap::Window> {
    xcap::Window::all().ok()?.into_iter().find(|window| {
        let app = window.app_name().unwrap_or_default().to_lowercase();
        let title = window.title().unwrap_or_default().to_lowercase();
        app == "vrchat" || title == "vrchat"
    })
}

struct Frame {
    image: image::RgbaImage,
    black_ratio: f64,
}

fn grab() -> Result<Frame, String> {
    let window = find_vrchat_window().ok_or("VRChat is not running")?;

    if window.is_minimized().unwrap_or(false) {
        return Err("VRChat is minimized, so it is not drawing anything".into());
    }

    let image = window
        .capture_image()
        .map_err(|e| format!("Could not capture the VRChat window: {}", e))?;

    let mut near_black = 0usize;
    for pixel in image.pixels() {
        let [r, g, b, _] = pixel.0;
        if r <= NEAR_BLACK && g <= NEAR_BLACK && b <= NEAR_BLACK {
            near_black += 1;
        }
    }
    let total = (image.width() * image.height()).max(1) as f64;

    Ok(Frame {
        black_ratio: near_black as f64 / total,
        image,
    })
}

pub struct WorldShotService;

impl WorldShotService {
    /// Captures the VRChat window and files it under the given world.
    pub fn capture(world_id: &str) -> Result<WorldShot, String> {
        let dir = world_dir(world_id)?;
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create the shot folder: {}", e))?;

        let frame = grab()?;
        let source = image::DynamicImage::ImageRgba8(frame.image).to_rgb8();

        // Only ever shrink: a window smaller than the stored width would be
        // blown up into something blurrier than what was on screen.
        let scaled = if source.width() > STORE_WIDTH {
            let height = source.height() * STORE_WIDTH / source.width();
            image::imageops::resize(&source, STORE_WIDTH, height, FilterType::Lanczos3)
        } else {
            source
        };

        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, STORE_QUALITY)
            .encode_image(&scaled)
            .map_err(|e| format!("Failed to encode the shot: {}", e))?;

        let taken_at = now_millis();
        let file_name = format!("{}.jpg", taken_at);
        let path = dir.join(&file_name);
        std::fs::write(&path, &jpeg).map_err(|e| format!("Failed to save the shot: {}", e))?;

        log::info!(
            "[shot] {} {}x{} {} KB black={:.0}%",
            world_id,
            scaled.width(),
            scaled.height(),
            jpeg.len() / 1024,
            frame.black_ratio * 100.0
        );

        Ok(WorldShot {
            world_id: world_id.to_string(),
            file_name,
            path: path.to_string_lossy().to_string(),
            taken_at,
            width: scaled.width(),
            height: scaled.height(),
            bytes: jpeg.len() as u64,
            looks_blank: frame.black_ratio >= USELESS_BLACK_RATIO,
        })
    }

    /// Every shot stored for a world, oldest first. Missing folder means none.
    pub fn list(world_id: &str) -> Result<Vec<WorldShot>, String> {
        let dir = world_dir(world_id)?;
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Ok(vec![]);
        };

        let mut shots: Vec<WorldShot> = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                if path.extension()?.to_str()? != "jpg" {
                    return None;
                }
                let file_name = path.file_name()?.to_string_lossy().to_string();
                let taken_at = path.file_stem()?.to_str()?.parse().ok()?;
                let metadata = entry.metadata().ok()?;

                // Dimensions are read from the header only; decoding every
                // shot to list them would make opening a world crawl.
                let (width, height) = image::image_dimensions(&path).unwrap_or((0, 0));

                Some(WorldShot {
                    world_id: world_id.to_string(),
                    file_name,
                    path: path.to_string_lossy().to_string(),
                    taken_at,
                    width,
                    height,
                    bytes: metadata.len(),
                    // Only meaningful at capture time; a stored shot the user
                    // chose to keep is not second-guessed.
                    looks_blank: false,
                })
            })
            .collect();

        shots.sort_by_key(|shot| shot.taken_at);
        Ok(shots)
    }

    /// One shot as a `data:` URL.
    ///
    /// Returned inline rather than served over the asset protocol: that would
    /// mean opening a filesystem scope to the webview for the sake of a
    /// handful of 200 KB images, and only the shots actually on screen are
    /// ever read.
    pub fn read_data_url(world_id: &str, file_name: &str) -> Result<String, String> {
        let path = world_dir(world_id)?.join(safe_file_name(file_name)?);
        let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read the shot: {}", e))?;

        use base64::Engine;
        Ok(format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }

    pub fn delete(world_id: &str, file_name: &str) -> Result<(), String> {
        let path = world_dir(world_id)?.join(safe_file_name(file_name)?);
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete the shot: {}", e))
    }

    /// Total bytes held by all stored shots, for the settings screen.
    pub fn total_bytes() -> u64 {
        let Ok(worlds) = std::fs::read_dir(shots_root()) else {
            return 0;
        };

        worlds
            .filter_map(Result::ok)
            .filter_map(|world| std::fs::read_dir(world.path()).ok())
            .flat_map(|shots| shots.filter_map(Result::ok))
            .filter_map(|shot| shot.metadata().ok())
            .map(|metadata| metadata.len())
            .sum()
    }
}
