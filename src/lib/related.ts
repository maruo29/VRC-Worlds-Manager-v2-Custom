import type {
  ColorFeatures,
  RelatedWeights,
  WorldDisplayData,
} from '@/lib/bindings';
import { colorSimilarity } from '@/lib/color-similarity';
import {
  PALETTE_WEIGHT,
  buildPaletteScorer,
  type ColorPaletteId,
} from '@/lib/color-palette';
import { authorTagsOf } from '@/lib/recommend';
import { textOverlap, textTokens } from '@/lib/text-similarity';

/** Mirrors the Rust default; used when preferences have not loaded yet. */
export const DEFAULT_RELATED_WEIGHTS: RelatedWeights = {
  tag: 1.0,
  author: 2.5,
  folder: 1.2,
  genre: 1.8,
  text: 1.0,
  color: 0.8,
};

/**
 * Each further world by the same author is worth this much of the previous
 * one's author bonus.
 *
 * A flat bonus makes the ranking useless for prolific creators: the author
 * search returns up to a hundred of their worlds and every one of them would
 * outrank everything else. Decaying it means the closest two or three still
 * land at the top while the rest fall back among the ordinary candidates.
 */
const AUTHOR_DECAY = 0.6;

/**
 * The closest few worlds by the same author keep the bonus in full; only past
 * this does it start decaying. Decaying straight from the second world pushed
 * it down into the thirties, which defeats the point of the signal.
 */
const AUTHOR_FULL_BONUS_COUNT = 3;

export {
  averageColorFeatures,
  colorSimilarity,
  rawColorSimilarity,
} from '@/lib/color-similarity';

/**
 * "Worlds like these": given one or more seed worlds, work out what they have
 * in common and score candidates on how much of that they share.
 *
 * Two modes, because with several seeds there are two sensible questions:
 *  - `any`: worlds like *any* of these (union of their tags)
 *  - `all`: worlds like *all* of these at once (only the tags every seed has)
 */
export type RelatedMode = 'any' | 'all';

export interface RelatedSeed {
  worldId: string;
  name: string;
  authorId: string;
  authorName: string;
  tags: string[];
  /** Title plus description, the raw material for the wording comparison. */
  text: string;
}

export function toSeed(
  world: WorldDisplayData,
  authorId: string,
  description = '',
): RelatedSeed {
  return {
    worldId: world.worldId,
    name: world.name,
    authorId,
    authorName: world.authorName,
    tags: authorTagsOf(world),
    text: `${world.name} ${description}`.trim(),
  };
}

/**
 * How distinctive each tag is, 0..1, from how rare it is in the library.
 *
 * Without this every tag counts the same, and a world that merely shares
 * "room", "home" and "relax" outranks one that shares "letter" - even though
 * the first three are on dozens of worlds and the last is on exactly one. The
 * value is squared so a genuinely rare tag beats a pile of generic ones
 * rather than merely edging ahead of them.
 */
export function buildTagIdf(
  library: WorldDisplayData[],
): Record<string, number> {
  const documentCount = Math.max(library.length, 1);
  const frequency: Record<string, number> = {};

  for (const world of library) {
    for (const tag of authorTagsOf(world)) {
      frequency[tag] = (frequency[tag] ?? 0) + 1;
    }
  }

  const maxIdf = Math.log(documentCount) || 1;
  const idf: Record<string, number> = {};
  for (const [tag, count] of Object.entries(frequency)) {
    const normalized = Math.log(documentCount / (1 + count)) / maxIdf;
    idf[tag] = Math.min(Math.max(normalized, 0), 1) ** 2;
  }

  return idf;
}

/** Tags the library has never seen are treated as maximally distinctive. */
export function tagWeight(idf: Record<string, number>, tag: string): number {
  return idf[tag] ?? 1;
}

export interface RelatedProfile {
  mode: RelatedMode;
  /** Tags to search with, most shared first. */
  tags: string[];
  /**
   * Tags borrowed from the worlds the user filed alongside the seeds. Plenty
   * of authors set no tags at all, and without this the only thing left to go
   * on is the author, so every result ends up being by the same person.
   */
  derivedTags: string[];
  /** In `all` mode a candidate must carry every one of these. */
  requiredTags: string[];
  /** How many seeds carry each tag; used for weighting. */
  seedsPerTag: Record<string, number>;
  authorIds: string[];
  authorNames: string[];
  /** Title + description of every seed, for the wording comparison. */
  seedTexts: string[];
  seedWorldIds: Set<string>;
  seedCount: number;
}

export function buildRelatedProfile(
  seeds: RelatedSeed[],
  mode: RelatedMode,
  derivedTags: string[] = [],
): RelatedProfile {
  const seedsPerTag: Record<string, number> = {};
  for (const seed of seeds) {
    for (const tag of new Set(seed.tags)) {
      seedsPerTag[tag] = (seedsPerTag[tag] ?? 0) + 1;
    }
  }

  const sharedByAll = Object.entries(seedsPerTag)
    .filter(([, count]) => count === seeds.length)
    .map(([tag]) => tag);

  // With "all" and nothing in common there is no meaningful query, so fall
  // back to the union rather than returning an empty page.
  const requiredTags =
    mode === 'all' && sharedByAll.length > 0 ? sharedByAll : [];

  const ownTags = Object.entries(seedsPerTag)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);

  // Derived tags count for half a seed, so a real tag always outranks one
  // inferred from the neighbours.
  for (const tag of derivedTags) {
    if (!(tag in seedsPerTag)) seedsPerTag[tag] = seeds.length * 0.5;
  }

  const tags = [
    ...ownTags,
    ...derivedTags.filter((tag) => !ownTags.includes(tag)),
  ];

  return {
    mode,
    tags: requiredTags.length > 0 ? requiredTags : tags,
    derivedTags,
    requiredTags,
    seedsPerTag,
    authorIds: Array.from(
      new Set(seeds.map((seed) => seed.authorId).filter(Boolean)),
    ),
    authorNames: Array.from(new Set(seeds.map((seed) => seed.authorName))),
    seedTexts: seeds.map((seed) => seed.text),
    seedWorldIds: new Set(seeds.map((seed) => seed.worldId)),
    seedCount: seeds.length,
  };
}

export interface RelatedWorld {
  world: WorldDisplayData;
  score: number;
  matchedTags: string[];
  sameAuthor: boolean;
  /** Already filed in one of the folders the seeds live in. */
  sameFolder: boolean;
  /** Grouped with the seeds by PlanetVRC's hand-written tags. */
  sameGenre: boolean;
  /** 0..1 overlap between the seed wording and this world's title. */
  textScore: number;
  /** 0..1 thumbnail colour similarity, or 0 when it was not analysed. */
  colorScore: number;
  /** Rarity-weighted tag overlap, kept for the score breakdown. */
  tagScore: number;
  /** Already saved in the user's library. */
  isInLibrary: boolean;
}

/** Extra context for ranking; all optional so callers only pass what they have. */
export interface RankRelatedContext {
  authorIdByWorldId?: Record<string, string>;
  folderMateIds?: Set<string>;
  genreMateIds?: Set<string>;
  libraryIds?: Set<string>;
  weights?: RelatedWeights;
  /** Thumbnail features by world id; missing entries simply score nothing. */
  colorFeatures?: Record<string, ColorFeatures>;
  /** Per-tag distinctiveness from buildTagIdf; defaults to treating all alike. */
  tagIdf?: Record<string, number>;
  /** Averaged features of the seeds, precomputed by the caller. */
  seedColor?: ColorFeatures | null;
  /**
   * Colour families the user asked for outright. When set it *replaces* the
   * "looks like the seed" comparison: asking for cool worlds related to a
   * warm seed is a legitimate thing to want, and the two cannot both drive
   * the same term.
   */
  palette?: ColorPaletteId[];
  /**
   * Keep candidates that match nothing, scored 0, instead of dropping them.
   * Used when relatedness is only re-ordering an existing result list rather
   * than producing one.
   */
  keepUnmatched?: boolean;
}

/**
 * Ranks candidates against the seed profile. Tag overlap dominates; sharing an
 * author is a strong but secondary signal, since a creator's worlds tend to
 * feel alike even when they are tagged differently.
 *
 * This orders candidates, it does not filter them. Dropping loosely-matched
 * worlds was tried and cut a 120-result page down to six: most candidates come
 * back from a tag search and so share exactly that one tag. Weak matches
 * belong at the bottom of the list, not off it.
 */
export function rankRelated(
  candidates: WorldDisplayData[],
  profile: RelatedProfile,
  context: RankRelatedContext = {},
): RelatedWorld[] {
  const {
    authorIdByWorldId = {},
    folderMateIds = new Set<string>(),
    genreMateIds = new Set<string>(),
    libraryIds = new Set<string>(),
    weights = DEFAULT_RELATED_WEIGHTS,
    colorFeatures = {},
    tagIdf = {},
    seedColor = null,
    palette = [],
    keepUnmatched = false,
  } = context;

  const seedTextTokens = textTokens(profile.seedTexts.join(' '));

  const unique = new Map<string, WorldDisplayData>();
  for (const world of candidates) {
    if (profile.seedWorldIds.has(world.worldId)) continue;
    if (!unique.has(world.worldId)) unique.set(world.worldId, world);
  }

  // Calibrated against the candidates in hand, so asking for a family that is
  // scarce still surfaces the best of what there is rather than nothing.
  const usePalette = palette.length > 0;
  const paletteScorer = usePalette
    ? buildPaletteScorer(
        palette,
        Array.from(unique.keys())
          .map((worldId) => colorFeatures[worldId])
          .filter((features): features is ColorFeatures => Boolean(features)),
      )
    : null;

  const results: RelatedWorld[] = [];

  for (const world of unique.values()) {
    const worldTags = authorTagsOf(world);
    const tagSet = new Set(worldTags);

    if (
      !keepUnmatched &&
      profile.requiredTags.length > 0 &&
      !profile.requiredTags.every((tag) => tagSet.has(tag))
    ) {
      continue;
    }

    const matchedTags = worldTags.filter(
      (tag) => (profile.seedsPerTag[tag] ?? 0) > 0,
    );

    const sameAuthor = profile.authorIds.includes(
      authorIdByWorldId[world.worldId] ?? '',
    );

    // A tag shared by every seed counts for more than one only one seed has,
    // and a rare tag counts for more than a generic one.
    const tagScore = matchedTags.reduce(
      (sum, tag) =>
        sum +
        ((profile.seedsPerTag[tag] ?? 0) / profile.seedCount) *
          tagWeight(tagIdf, tag),
      0,
    );

    const sameFolder = folderMateIds.has(world.worldId);
    const sameGenre = genreMateIds.has(world.worldId);

    const textScore = textOverlap(seedTextTokens, textTokens(world.name));

    if (
      !keepUnmatched &&
      tagScore === 0 &&
      textScore === 0 &&
      !sameAuthor &&
      !sameFolder &&
      !sameGenre
    ) {
      continue;
    }

    // Colour says a lot about mood but nothing about genre: a dark shooting
    // range looks like a dark ruin. So it only ever boosts a candidate that
    // already matched on something else.
    const candidateColor = colorFeatures[world.worldId];
    const hasOtherSignal =
      tagScore > 0 || sameAuthor || sameFolder || sameGenre || textScore > 0;

    const colorScore =
      candidateColor && hasOtherSignal
        ? paletteScorer
          ? paletteScorer(candidateColor)
          : seedColor
            ? colorSimilarity(seedColor, candidateColor)
            : 0
        : 0;
    const colorWeight = usePalette ? PALETTE_WEIGHT : weights.color;

    results.push({
      world,
      // The author bonus is applied afterwards, once it is known how many
      // worlds by that author are competing.
      score:
        tagScore * weights.tag +
        (sameFolder ? weights.folder : 0) +
        (sameGenre ? weights.genre : 0) +
        textScore * weights.text +
        colorScore * colorWeight,
      matchedTags: matchedTags.sort(
        (a, b) =>
          (profile.seedsPerTag[b] ?? 0) * tagWeight(tagIdf, b) -
          (profile.seedsPerTag[a] ?? 0) * tagWeight(tagIdf, a),
      ),
      sameAuthor,
      sameFolder,
      sameGenre,
      textScore,
      colorScore,
      tagScore,
      isInLibrary: libraryIds.has(world.worldId),
    });
  }

  applyAuthorDecay(results, authorIdByWorldId, weights.author);

  return results.sort(
    (a, b) => b.score - a.score || a.world.name.localeCompare(b.world.name),
  );
}

/**
 * Adds the author bonus, worth less for each additional world by the same
 * creator, strongest first.
 */
function applyAuthorDecay(
  results: RelatedWorld[],
  authorIdByWorldId: Record<string, string>,
  authorWeight: number,
): void {
  if (authorWeight <= 0) return;

  const byAuthor = new Map<string, RelatedWorld[]>();
  for (const entry of results) {
    if (!entry.sameAuthor) continue;
    const authorId = authorIdByWorldId[entry.world.worldId] ?? '';
    const group = byAuthor.get(authorId);
    if (group) group.push(entry);
    else byAuthor.set(authorId, [entry]);
  }

  for (const group of byAuthor.values()) {
    // Whichever of the author's worlds is otherwise the best match keeps the
    // full bonus.
    group.sort((a, b) => b.score - a.score);
    group.forEach((entry, index) => {
      const decayStep = Math.max(0, index - (AUTHOR_FULL_BONUS_COUNT - 1));
      entry.score += authorWeight * AUTHOR_DECAY ** decayStep;
    });
  }
}
