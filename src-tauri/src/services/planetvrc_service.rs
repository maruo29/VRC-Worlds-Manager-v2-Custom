//! Look-ups against PlanetVRC (https://planetvrchat.net), a Japanese VRChat
//! world catalogue.
//!
//! A large share of worlds carry no author tags at all, which leaves the
//! in-app "related worlds" search with nothing but the author to go on.
//! PlanetVRC is a WordPress site whose editors tag worlds by hand, and its
//! REST API puts the VRChat world id straight into each post slug
//! (`vrc-world-wrld_...`), so a world can be looked up directly.
//!
//! It is someone's personal site, so every response is cached for the life of
//! the process and requests are spaced out.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::async_runtime::Mutex;

const BASE_URL: &str = "https://planetvrchat.net/wp-json/wp/v2";
const SLUG_PREFIX: &str = "vrc-world-";

/// Minimum spacing between requests to the site.
const MIN_REQUEST_INTERVAL: Duration = Duration::from_millis(400);

/// Seeds looked up per call, so one action cannot fan out into many requests.
const MAX_SEEDS: usize = 5;

/// Tags actually queried for related worlds.
const MAX_QUERY_TAGS: usize = 4;

/// A tag on this many worlds says nothing useful ("landscape" and friends).
const MAX_USEFUL_TAG_COUNT: i64 = 400;

#[derive(Debug, Deserialize)]
struct WpPost {
    slug: String,
    #[serde(default)]
    tags: Vec<i64>,
    #[serde(default)]
    categories: Vec<i64>,
}

#[derive(Debug, Deserialize)]
struct WpTerm {
    id: i64,
    name: String,
    #[serde(default)]
    count: i64,
}

#[derive(Debug, Clone)]
struct WorldTerms {
    tag_ids: Vec<i64>,
    category_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanetVrcRelated {
    /// Human readable tag names the seeds share, for display.
    pub tag_names: Vec<String>,
    pub category_names: Vec<String>,
    /// VRChat world ids of related worlds, most relevant tag first.
    pub world_ids: Vec<String>,
    /// Seeds PlanetVRC does not list.
    pub missing_world_ids: Vec<String>,
}

#[derive(Default)]
struct PlanetVrcCache {
    /// `None` means the site has no entry for that world.
    world_terms: HashMap<String, Option<WorldTerms>>,
    term_names: HashMap<i64, String>,
    term_counts: HashMap<i64, i64>,
    tag_worlds: HashMap<i64, Vec<String>>,
    last_request_ms: u64,
}

static CACHE: LazyLock<Mutex<PlanetVrcCache>> =
    LazyLock::new(|| Mutex::new(PlanetVrcCache::default()));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::ClientBuilder::new()
        .user_agent(concat!(
            "VRCWorldsManager/",
            env!("CARGO_PKG_VERSION"),
            " (+related-worlds lookup)"
        ))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build the PlanetVRC client: {}", e))
}

/// Keeps requests to the site spaced out; the caller already holds no lock.
async fn throttle() {
    let wait = {
        let mut cache = CACHE.lock().await;
        let elapsed = now_ms().saturating_sub(cache.last_request_ms);
        let min = MIN_REQUEST_INTERVAL.as_millis() as u64;
        cache.last_request_ms = now_ms().max(cache.last_request_ms + min);
        min.saturating_sub(elapsed)
    };

    if wait > 0 {
        tokio::time::sleep(Duration::from_millis(wait)).await;
    }
}

async fn get_json(url: &str) -> Result<String, String> {
    throttle().await;

    log::info!("[planetvrc] GET {}", url);
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("PlanetVRC request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("PlanetVRC returned {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read the PlanetVRC response: {}", e))
}

fn world_id_from_slug(slug: &str) -> Option<String> {
    slug.strip_prefix(SLUG_PREFIX)
        .filter(|id| id.starts_with("wrld_"))
        .map(|id| id.to_string())
}

/// Terms PlanetVRC has for a single world, or `None` when it is not listed.
async fn fetch_world_terms(world_id: &str) -> Result<Option<WorldTerms>, String> {
    if let Some(cached) = CACHE.lock().await.world_terms.get(world_id) {
        return Ok(cached.clone());
    }

    let url = format!(
        "{}/posts?slug={}{}&_fields=slug,tags,categories",
        BASE_URL,
        SLUG_PREFIX,
        urlencoding::encode(world_id)
    );
    let body = get_json(&url).await?;

    let posts: Vec<WpPost> = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse the PlanetVRC post: {}", e))?;

    let terms = posts.into_iter().next().map(|post| WorldTerms {
        tag_ids: post.tags,
        category_ids: post.categories,
    });

    CACHE
        .lock()
        .await
        .world_terms
        .insert(world_id.to_string(), terms.clone());

    Ok(terms)
}

/// Names and world counts for the given term ids, in one request per taxonomy.
async fn fetch_term_details(
    taxonomy: &str,
    ids: &[i64],
) -> Result<HashMap<i64, (String, i64)>, String> {
    let mut result: HashMap<i64, (String, i64)> = HashMap::new();
    let mut missing: Vec<i64> = Vec::new();

    {
        let cache = CACHE.lock().await;
        for id in ids {
            match (cache.term_names.get(id), cache.term_counts.get(id)) {
                (Some(name), Some(count)) => {
                    result.insert(*id, (name.clone(), *count));
                }
                _ => missing.push(*id),
            }
        }
    }

    if missing.is_empty() {
        return Ok(result);
    }

    let joined = missing
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let url = format!(
        "{}/{}?include={}&per_page=100&_fields=id,name,count",
        BASE_URL, taxonomy, joined
    );
    let body = get_json(&url).await?;

    let terms: Vec<WpTerm> = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse PlanetVRC terms: {}", e))?;

    let mut cache = CACHE.lock().await;
    for term in terms {
        cache.term_names.insert(term.id, term.name.clone());
        cache.term_counts.insert(term.id, term.count);
        result.insert(term.id, (term.name, term.count));
    }

    Ok(result)
}

/// World ids carrying a given tag.
async fn fetch_worlds_for_tag(tag_id: i64, limit: usize) -> Result<Vec<String>, String> {
    if let Some(cached) = CACHE.lock().await.tag_worlds.get(&tag_id) {
        return Ok(cached.clone());
    }

    let url = format!(
        "{}/posts?tags={}&per_page={}&_fields=slug",
        BASE_URL,
        tag_id,
        limit.clamp(1, 50)
    );
    let body = get_json(&url).await?;

    let posts: Vec<WpPost> = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse PlanetVRC posts: {}", e))?;

    let world_ids: Vec<String> = posts
        .iter()
        .filter_map(|post| world_id_from_slug(&post.slug))
        .collect();

    CACHE
        .lock()
        .await
        .tag_worlds
        .insert(tag_id, world_ids.clone());

    Ok(world_ids)
}

pub struct PlanetVrcService;

impl PlanetVrcService {
    /// Given seed worlds, returns worlds PlanetVRC groups with them.
    pub async fn related(world_ids: Vec<String>, limit: usize) -> Result<PlanetVrcRelated, String> {
        let seeds: Vec<String> = world_ids.into_iter().take(MAX_SEEDS).collect();
        let seed_set: HashSet<&String> = seeds.iter().collect();

        let mut tag_ids: Vec<i64> = Vec::new();
        let mut category_ids: Vec<i64> = Vec::new();
        let mut missing: Vec<String> = Vec::new();

        for world_id in &seeds {
            match fetch_world_terms(world_id).await {
                Ok(Some(terms)) => {
                    for id in terms.tag_ids {
                        if !tag_ids.contains(&id) {
                            tag_ids.push(id);
                        }
                    }
                    for id in terms.category_ids {
                        if !category_ids.contains(&id) {
                            category_ids.push(id);
                        }
                    }
                }
                Ok(None) => missing.push(world_id.clone()),
                Err(e) => {
                    log::warn!("[planetvrc] lookup failed for {}: {}", world_id, e);
                    missing.push(world_id.clone());
                }
            }
        }

        if tag_ids.is_empty() && category_ids.is_empty() {
            return Ok(PlanetVrcRelated {
                tag_names: vec![],
                category_names: vec![],
                world_ids: vec![],
                missing_world_ids: missing,
            });
        }

        let tag_details = fetch_term_details("tags", &tag_ids)
            .await
            .unwrap_or_default();
        let category_details = fetch_term_details("categories", &category_ids)
            .await
            .unwrap_or_default();

        // A tag on one world only points back at the seed; a tag on hundreds
        // says nothing. Prefer what is in between, most specific first.
        let mut usable: Vec<(i64, String, i64)> = tag_ids
            .iter()
            .filter_map(|id| {
                tag_details
                    .get(id)
                    .map(|(name, count)| (*id, name.clone(), *count))
            })
            .filter(|(_, _, count)| *count > 1 && *count <= MAX_USEFUL_TAG_COUNT)
            .collect();
        usable.sort_by_key(|(_, _, count)| *count);

        let mut related_ids: Vec<String> = Vec::new();
        for (tag_id, _, _) in usable.iter().take(MAX_QUERY_TAGS) {
            match fetch_worlds_for_tag(*tag_id, limit).await {
                Ok(ids) => {
                    for id in ids {
                        if !seed_set.contains(&id) && !related_ids.contains(&id) {
                            related_ids.push(id);
                        }
                    }
                }
                Err(e) => log::warn!("[planetvrc] tag {} failed: {}", tag_id, e),
            }
        }

        Ok(PlanetVrcRelated {
            tag_names: usable.iter().map(|(_, name, _)| name.clone()).collect(),
            category_names: category_ids
                .iter()
                .filter_map(|id| category_details.get(id).map(|(name, _)| name.clone()))
                .collect(),
            world_ids: related_ids,
            missing_world_ids: missing,
        })
    }
}
