import type { ColorFeatures, WorldDisplayData } from '@/lib/bindings';
import { rawColorSimilarity } from '@/lib/color-similarity';
import {
  PALETTE_WEIGHT,
  buildPaletteScorer,
  type ColorPaletteId,
} from '@/lib/color-palette';

/**
 * Recommendation scoring for the "Recommended Worlds" page.
 *
 * Everything in this file is pure so the weighting can be reasoned about (and
 * later tested) without touching the VRChat API or Tauri.
 */

const AUTHOR_TAG_PREFIX = 'author_tag_';

/** Weight a world contributes to the taste profile. */
export const BASE_WEIGHT = 1;
export const FAVORITE_BONUS = 2;
export const FOLDER_BONUS = 0.6;

/** Manual tags sit slightly above the strongest auto-detected tag. */
export const MANUAL_TAG_WEIGHT = 1.25;

/** How many of the profile's tags we actually query the API with. */
export const CANDIDATE_TAG_LIMIT = 6;

/**
 * author_tag_Chill and author_tag_chill are the same taste signal, so tags are
 * lower-cased. system_* / admin_* / feature_* tags describe VRChat's own
 * moderation state rather than the world's mood, so they are dropped.
 */
export function normalizeTag(rawTag: string): string | null {
  if (!rawTag.startsWith(AUTHOR_TAG_PREFIX)) return null;
  const tag = rawTag.slice(AUTHOR_TAG_PREFIX.length).trim().toLowerCase();
  return tag.length > 0 ? tag : null;
}

/**
 * How loudly a single library world speaks for the user's taste. A world they
 * favourited says more than one they merely saved, and one they bothered to
 * file says a little more than one they did not.
 */
export function tasteWeight(world: WorldDisplayData): number {
  return (
    BASE_WEIGHT +
    (world.isFavorite ? FAVORITE_BONUS : 0) +
    (world.folders.length > 0 ? FOLDER_BONUS : 0)
  );
}

/** Distinct, normalized author tags of a single world. */
export function authorTagsOf(world: WorldDisplayData): string[] {
  const seen = new Set<string>();
  for (const rawTag of world.tags) {
    const tag = normalizeTag(rawTag);
    if (tag) seen.add(tag);
  }
  return Array.from(seen);
}

export interface TagScore {
  tag: string;
  /** 0..1 for auto-detected tags, MANUAL_TAG_WEIGHT for manually pinned ones. */
  weight: number;
  /** How many worlds in the library carry this tag. */
  worldCount: number;
  isManual: boolean;
}

export interface PreferenceProfile {
  tags: TagScore[];
  weightByTag: Record<string, number>;
  manualTags: string[];
  libraryWorldIds: Set<string>;
  /** Worlds that actually carried at least one usable tag. */
  taggedWorldCount: number;
  totalWorldCount: number;
}

/**
 * Builds the taste profile from the local library.
 *
 * Raw counts are square-rooted before normalizing: without damping, a tag on
 * 125 worlds would drown out every other signal and every recommendation would
 * come back "chill".
 */
export function buildPreferenceProfile(
  worlds: WorldDisplayData[],
  manualTags: string[] = [],
): PreferenceProfile {
  const rawWeight: Record<string, number> = {};
  const worldCount: Record<string, number> = {};
  let taggedWorldCount = 0;

  for (const world of worlds) {
    const tags = authorTagsOf(world);
    if (tags.length === 0) continue;
    taggedWorldCount += 1;

    const weight = tasteWeight(world);

    for (const tag of tags) {
      rawWeight[tag] = (rawWeight[tag] ?? 0) + weight;
      worldCount[tag] = (worldCount[tag] ?? 0) + 1;
    }
  }

  const damped = Object.entries(rawWeight).map(
    ([tag, weight]) => [tag, Math.sqrt(weight)] as const,
  );
  const maxDamped = damped.reduce((max, [, w]) => Math.max(max, w), 0);

  const normalizedManualTags = Array.from(
    new Set(
      manualTags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0),
    ),
  );
  const manualSet = new Set(normalizedManualTags);

  const tags: TagScore[] = damped
    .map(([tag, weight]) => ({
      tag,
      weight: manualSet.has(tag)
        ? MANUAL_TAG_WEIGHT
        : maxDamped > 0
          ? weight / maxDamped
          : 0,
      worldCount: worldCount[tag] ?? 0,
      isManual: manualSet.has(tag),
    }))
    .filter((entry) => entry.weight > 0);

  // Manually pinned tags count even when the library has never seen them.
  for (const tag of normalizedManualTags) {
    if (!tags.some((entry) => entry.tag === tag)) {
      tags.push({
        tag,
        weight: MANUAL_TAG_WEIGHT,
        worldCount: 0,
        isManual: true,
      });
    }
  }

  tags.sort((a, b) => b.weight - a.weight || a.tag.localeCompare(b.tag));

  const weightByTag: Record<string, number> = {};
  for (const entry of tags) weightByTag[entry.tag] = entry.weight;

  return {
    tags,
    weightByTag,
    manualTags: normalizedManualTags,
    libraryWorldIds: new Set(worlds.map((world) => world.worldId)),
    taggedWorldCount,
    totalWorldCount: worlds.length,
  };
}

/** Tags we send to the VRChat API as search filters, manual ones first. */
export function candidateTags(
  profile: PreferenceProfile,
  limit: number = CANDIDATE_TAG_LIMIT,
): string[] {
  const manual = profile.tags.filter((entry) => entry.isManual);
  const auto = profile.tags.filter((entry) => !entry.isManual);
  return [...manual, ...auto].slice(0, limit).map((entry) => entry.tag);
}

/**
 * Colour taste, as a set of reference thumbnails rather than one average.
 *
 * Averaging a whole library's colour is worthless: a user who likes both dark
 * neon streets and pale quiet interiors averages out to a flat grey that
 * nothing resembles and everything resembles equally. Keeping the individual
 * thumbnails around and asking "is this close to *any* corner of what they
 * already collect" preserves a taste that has several sides to it.
 */
export interface ColorAnchor {
  features: ColorFeatures;
  /** From tasteWeight(): favourites pull harder than plain saves. */
  weight: number;
}

export interface ColorTasteProfile {
  anchors: ColorAnchor[];
  /** Library worlds that actually had an analysed thumbnail. */
  sourceCount: number;
}

/**
 * Reference thumbnails kept. Every candidate is compared against all of them,
 * so this is the term that decides the cost; a few hundred anchors against a
 * hundred candidates is a few tens of thousands of 20-bin comparisons, which
 * is nothing.
 */
export const MAX_COLOR_ANCHORS = 240;

/**
 * Anchors a candidate is scored against. Only the closest handful count: a
 * world should score well for looking like one corner of the library, not for
 * being averagely close to all of it.
 */
export const COLOR_TASTE_NEIGHBORS = 5;

export function buildColorTaste(
  worlds: WorldDisplayData[],
  featuresByWorldId: Record<string, ColorFeatures>,
): ColorTasteProfile | null {
  const anchors: ColorAnchor[] = [];

  for (const world of worlds) {
    const features = featuresByWorldId[world.worldId];
    if (!features) continue;
    anchors.push({ features, weight: tasteWeight(world) });
  }

  if (anchors.length === 0) return null;

  // Heaviest first, so trimming drops the worlds that say least about taste.
  anchors.sort((a, b) => b.weight - a.weight);

  return {
    anchors: anchors.slice(0, MAX_COLOR_ANCHORS),
    sourceCount: anchors.length,
  };
}

/**
 * Closeness of this thumbnail to the nearest corner of the library, on the
 * *raw* similarity scale.
 *
 * Deliberately not rescaled here. The fixed 0.35..0.75 rescale used when
 * comparing two single worlds is calibrated for exactly that; taking the best
 * of a few hundred anchors lands far higher (measured against a real 533-world
 * cache: 10th percentile 0.72, median 0.81, 90th 0.88), so applying it would
 * push practically every candidate to a full score and turn colour back into
 * the flat bonus it must not be. Calibration happens in rankCandidates, over
 * the candidates actually being ranked.
 */
export function rawColorTasteScore(
  features: ColorFeatures,
  taste: ColorTasteProfile,
): number {
  const nearest = taste.anchors
    .map((anchor) => ({
      similarity: rawColorSimilarity(features, anchor.features),
      weight: anchor.weight,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, COLOR_TASTE_NEIGHBORS);

  if (nearest.length === 0) return 0;

  const totalWeight = nearest.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight === 0) return 0;

  return (
    nearest.reduce((sum, entry) => sum + entry.similarity * entry.weight, 0) /
    totalWeight
  );
}

/**
 * Percentiles of the candidates' own colour scores that become 0 and 1.
 *
 * Self-calibrating rather than fixed, because where the scores land depends on
 * how big the library is and how uniform its look is. Roughly a tenth of the
 * list is pinned at each end and the rest is spread across the middle, which
 * is what makes colour a ranking signal instead of a constant.
 */
const COLOR_CALIBRATION_LOW = 0.1;
const COLOR_CALIBRATION_HIGH = 0.9;

/** Below this the candidates all look alike, so no ordering can be read out. */
const MIN_COLOR_SPAN = 0.01;

/** Everything rankCandidates needs to add the colour term. */
export interface ColorContext {
  taste: ColorTasteProfile | null;
  /** Candidate thumbnail features; a missing entry simply scores nothing. */
  featuresByWorldId: Record<string, ColorFeatures>;
  /** Shared with the related-worlds search, so one setting drives both. */
  weight: number;
  /**
   * Colour families the user asked for outright. When this is non-empty it
   * *replaces* the taste-derived colour score rather than adding to it: the
   * whole reason to pick a palette is that the inferred preference keeps
   * returning the same muted colours, so letting the two compete would defeat
   * the point.
   */
  palette?: ColorPaletteId[];
}

export interface ScoredWorld {
  world: WorldDisplayData;
  score: number;
  /** Profile tags this world matched, strongest first. */
  matchedTags: string[];
  /** 0..1 thumbnail resemblance to the library, or 0 when unused. */
  colorScore: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days since the world was first made public, or null when VRChat did not
 * say - unpublished worlds, and anything saved before the field was stored.
 */
export function publicationAgeDays(
  world: WorldDisplayData,
  now: number = Date.now(),
): number | null {
  if (!world.publicationDate) return null;
  const published = Date.parse(world.publicationDate);
  if (Number.isNaN(published)) return null;
  return (now - published) / DAY_MS;
}

/**
 * Whether the world was published inside the window.
 *
 * A world with no publication date fails: the caller is asking for worlds
 * known to be new, and "we do not know when this came out" is not that.
 */
export function isPublishedWithin(
  world: WorldDisplayData,
  maxAgeDays: number,
  now: number = Date.now(),
): boolean {
  const age = publicationAgeDays(world, now);
  return age !== null && age <= maxAgeDays;
}

/**
 * Recent worlds get a small nudge so the list does not go stale.
 *
 * Measured from the publication date where there is one: lastUpdated only
 * says when the author last edited the world, so a five-year-old world that
 * got a lighting tweak last week would otherwise read as brand new.
 */
function recencyBonus(world: WorldDisplayData, now: number): number {
  const age = publicationAgeDays(world, now);
  const ageDays = age ?? (now - Date.parse(world.lastUpdated)) / DAY_MS;

  if (Number.isNaN(ageDays)) return 0;
  if (ageDays < 0) return 0;
  if (ageDays > 180) return 0;
  return 0.35 * (1 - ageDays / 180);
}

/** Mild popularity nudge; deliberately capped so it cannot outrank taste. */
function popularityBonus(world: WorldDisplayData): number {
  const favorites = Math.max(world.favorites, 0);
  return Math.min(Math.log10(favorites + 1) / 16, 0.25);
}

export function scoreWorld(
  world: WorldDisplayData,
  profile: PreferenceProfile,
  now: number = Date.now(),
): ScoredWorld {
  const matches = authorTagsOf(world)
    .map((tag) => ({ tag, weight: profile.weightByTag[tag] ?? 0 }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  const tagScore = matches.reduce((sum, entry) => sum + entry.weight, 0);

  return {
    world,
    score:
      tagScore > 0
        ? tagScore + recencyBonus(world, now) + popularityBonus(world)
        : 0,
    matchedTags: matches.map((entry) => entry.tag),
    // Filled in by applyColorTaste once the whole list is known.
    colorScore: 0,
  };
}

/**
 * Adds the colour term to an already-scored list, calibrated against that
 * list.
 *
 * Colour describes the mood of a world but nothing about what happens in it -
 * a dark shooting range looks like a dark ruin. So, exactly as on the
 * related-worlds page, it only ever boosts a world that already matched the
 * taste profile on tags; it never pulls one in on looks alone.
 */
function applyColorTaste(scored: ScoredWorld[], color: ColorContext): void {
  const palette = color.palette ?? [];

  // An explicitly chosen palette is an absolute 0..1 measure already, so it
  // needs none of the calibration the taste score does.
  if (palette.length > 0) {
    const matched = scored
      .filter((entry) => entry.score > 0)
      .map((entry) => ({
        entry,
        features: color.featuresByWorldId[entry.world.worldId],
      }))
      .filter((item) => Boolean(item.features));

    const scorer = buildPaletteScorer(
      palette,
      matched.map((item) => item.features),
    );

    for (const { entry, features } of matched) {
      entry.colorScore = scorer(features);
      entry.score += entry.colorScore * PALETTE_WEIGHT;
    }
    return;
  }

  const taste = color.taste;
  if (!taste || color.weight <= 0) return;

  const rawScores = new Map<ScoredWorld, number>();
  for (const entry of scored) {
    if (entry.score <= 0) continue;
    const features = color.featuresByWorldId[entry.world.worldId];
    if (!features) continue;
    rawScores.set(entry, rawColorTasteScore(features, taste));
  }
  if (rawScores.size === 0) return;

  const sorted = Array.from(rawScores.values()).sort((a, b) => a - b);
  const at = (fraction: number) =>
    sorted[Math.round(fraction * (sorted.length - 1))];
  const floor = at(COLOR_CALIBRATION_LOW);
  const span = at(COLOR_CALIBRATION_HIGH) - floor;

  rawScores.forEach((raw, entry) => {
    // A list with no spread gets a flat 0.5, which shifts every candidate
    // equally and so changes nothing - the honest answer when the thumbnails
    // genuinely cannot be told apart.
    const normalized = span > MIN_COLOR_SPAN ? (raw - floor) / span : 0.5;
    entry.colorScore = Math.min(Math.max(normalized, 0), 1);
    entry.score += entry.colorScore * color.weight;
  });
}

export interface RankOptions {
  excludedTags?: string[];
  ignoredWorldIds?: string[];
  /** Hide worlds already in the library. */
  hideLibraryWorlds?: boolean;
  /** Drop worlds that match nothing in the profile. */
  requireTagMatch?: boolean;
  now?: number;
  /** Thumbnail colour, when it has been analysed and switched on. */
  color?: ColorContext;
}

/**
 * Deduplicates, filters and ranks API candidates. The same world comes back
 * from several per-tag queries, so dedupe has to happen before scoring.
 */
export function rankCandidates(
  candidates: WorldDisplayData[],
  profile: PreferenceProfile,
  options: RankOptions = {},
): ScoredWorld[] {
  const {
    excludedTags = [],
    ignoredWorldIds = [],
    hideLibraryWorlds = true,
    requireTagMatch = true,
    now = Date.now(),
    color,
  } = options;

  const excluded = new Set(
    excludedTags
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0),
  );
  const ignored = new Set(ignoredWorldIds);

  const unique = new Map<string, WorldDisplayData>();
  for (const world of candidates) {
    if (unique.has(world.worldId)) continue;
    if (ignored.has(world.worldId)) continue;
    if (hideLibraryWorlds && profile.libraryWorldIds.has(world.worldId))
      continue;
    if (
      excluded.size > 0 &&
      authorTagsOf(world).some((tag) => excluded.has(tag))
    )
      continue;
    unique.set(world.worldId, world);
  }

  const scored = Array.from(unique.values()).map((world) =>
    scoreWorld(world, profile, now),
  );

  // Colour is calibrated against the whole candidate list, so it has to be
  // applied after every candidate has its base score.
  if (color) applyColorTaste(scored, color);

  return scored
    .filter((entry) => (requireTagMatch ? entry.score > 0 : true))
    .sort(
      (a, b) => b.score - a.score || a.world.name.localeCompare(b.world.name),
    );
}
