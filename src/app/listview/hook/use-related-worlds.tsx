'use client';

import { create } from 'zustand';
import {
  commands,
  WorldDisplayData,
  RelatedWeights,
  ColorFeatures,
} from '@/lib/bindings';
import {
  API_CALL_GAP_MS,
  DISCOVERY_MAX_RESULTS,
  paceApiCall,
  sleep,
} from '@/lib/discovery';
import {
  MAX_COLOR_CANDIDATES,
  analyzeColorsInBatches,
  missingColorTargets,
  readColorFeatures,
  type ColorFeatureMap,
} from '@/lib/color-analysis';
import { saveAndHideWorld } from '@/lib/library-actions';
import { detailsToDisplayData } from '@/lib/world-display';
import { error, info } from '@tauri-apps/plugin-log';
import { authorTagsOf } from '@/lib/recommend';
import {
  DEFAULT_RELATED_WEIGHTS,
  averageColorFeatures,
  buildRelatedProfile,
  buildTagIdf,
  tagWeight,
  rankRelated,
  toSeed,
  type RelatedMode,
  type RelatedSeed,
  type RelatedWorld,
} from '@/lib/related';
import type { ColorPaletteId } from '@/lib/color-palette';

/** Authors queried for their other worlds. */
const MAX_AUTHOR_QUERIES = 3;

/** Seed tags queried against the API. */
const MAX_TAG_QUERIES = 5;

interface RelatedState {
  seeds: RelatedSeed[];
  mode: RelatedMode;
  results: RelatedWorld[];
  /** Hand-written PlanetVRC tags the seeds share, for display. */
  genreTagNames: string[];
  /**
   * Worlds already in the library are hidden by default: this page is mostly
   * about finding something new, and the folder mates that feed the search
   * would otherwise fill it with worlds the user already has.
   */
  includeLibraryWorlds: boolean;
  /** How many results the filter is currently holding back. */
  hiddenLibraryCount: number;
  /** Tags inferred from the folders the seeds live in, for display. */
  derivedTagNames: string[];
  /**
   * Whether the colour signal is actually contributing:
   *  - `off`     the weight is zero
   *  - `ready`   the seeds have analysed thumbnails
   *  - `missing` colour is switched on but nothing has been analysed yet
   */
  colorState: 'off' | 'ready' | 'missing';
  /** Set while candidate thumbnails are being analysed in the background. */
  colorProgress: { done: number; total: number } | null;
  /** Colour families asked for outright; empty means "look like the seed". */
  palette: ColorPaletteId[];
  isLoading: boolean;
  errorMessage: string | null;

  /** Starts a fresh search from the given worlds. */
  search: (worlds: WorldDisplayData[]) => Promise<void>;
  /** Re-ranks the worlds already fetched; no extra API calls. */
  setMode: (mode: RelatedMode) => void;
  setIncludeLibraryWorlds: (include: boolean) => void;
  /** Prioritises the given colour families; no refetch, thumbnails only. */
  setPalette: (palette: ColorPaletteId[]) => void;
  clearSeeds: () => void;
  /** Saves the world to the library and hides it, like anywhere else. */
  hideWorld: (worldId: string) => Promise<void>;
  /**
   * Scores an existing list of worlds against the current seeds without
   * dropping anything, so another page can re-order its own results.
   */
  rankAgainstSeeds: (worlds: WorldDisplayData[]) => RelatedWorld[];
  refresh: () => Promise<void>;
  updateWorld: (worldId: string, updates: Partial<WorldDisplayData>) => void;
}

/** Tags borrowed from the worlds sitting in the same folders as the seeds. */
const MAX_DERIVED_TAGS = 4;

/** PlanetVRC world ids we bother resolving through the VRChat API. */
const MAX_GENRE_LOOKUPS = 12;

export const useRelatedWorldsStore = create<RelatedState>((set, get) => {
  // The raw pool is kept so switching AND/OR is instant.
  let candidates: WorldDisplayData[] = [];
  let authorIdByWorldId: Record<string, string> = {};
  let derivedTags: string[] = [];
  let folderMateIds = new Set<string>();
  let genreMateIds = new Set<string>();
  let libraryIds = new Set<string>();
  let weights: RelatedWeights = DEFAULT_RELATED_WEIGHTS;
  let colorFeatures: ColorFeatureMap = {};
  let tagIdf: Record<string, number> = {};
  /** Worlds hidden from this page; re-ranking must not bring them back. */
  let hiddenIds = new Set<string>();
  let seedColor: ColorFeatures | null = null;

  /**
   * Reads whatever thumbnail features are already cached, and quietly analyses
   * the handful that are missing. Nothing here blocks the first paint - the
   * list is simply re-ranked once the features arrive.
   */
  const loadColorFeatures = async (
    seedIds: string[],
    candidateWorlds: WorldDisplayData[],
  ) => {
    colorFeatures = {};
    seedColor = null;

    // A chosen palette needs candidate thumbnails even when the "looks like
    // the seed" comparison is switched off entirely.
    const usePalette = get().palette.length > 0;
    if (weights.color <= 0 && !usePalette) {
      set({ colorState: 'off' });
      return;
    }

    const ids = Array.from(
      new Set([...seedIds, ...candidateWorlds.map((w) => w.worldId)]),
    );

    if (!(await readColorFeatures(ids, colorFeatures))) return;

    // Seeds matter most: without their colour there is nothing to compare to,
    // so analyse those on the spot if they are missing.
    const missingSeeds = seedIds.filter((id) => !colorFeatures[id]);
    if (missingSeeds.length > 0) {
      const targets = missingSeeds
        .map((id) => {
          const world =
            candidateWorlds.find((w) => w.worldId === id) ??
            get().seeds.find((seed) => seed.worldId === id);
          const imageUrl =
            world && 'thumbnailUrl' in world ? world.thumbnailUrl : '';
          return imageUrl ? { worldId: id, imageUrl } : null;
        })
        .filter((target): target is { worldId: string; imageUrl: string } =>
          Boolean(target),
        );

      if (targets.length > 0) {
        await analyzeColorsInBatches(targets, colorFeatures);
      }
    }

    seedColor = averageColorFeatures(
      seedIds
        .map((id) => colorFeatures[id])
        .filter((features): features is ColorFeatures => Boolean(features)),
    );

    set({ colorState: seedColor || usePalette ? 'ready' : 'missing' });
  };

  /** Preferences can change while the page is open, so re-read them per run. */
  const loadWeights = async () => {
    const result = await commands.getRelatedWeights();
    if (result.status === 'ok') weights = result.data;
  };

  const rerank = () => {
    const { seeds, mode } = get();
    if (seeds.length === 0) {
      set({ results: [] });
      return;
    }
    const profile = buildRelatedProfile(seeds, mode, derivedTags);
    const ranked = rankRelated(candidates, profile, {
      authorIdByWorldId,
      folderMateIds,
      genreMateIds,
      libraryIds,
      weights,
      colorFeatures,
      tagIdf,
      seedColor,
      palette: get().palette,
    });

    const { includeLibraryWorlds } = get();
    const shown = ranked.filter((entry) => !hiddenIds.has(entry.world.worldId));
    const visible = includeLibraryWorlds
      ? shown
      : shown.filter((entry) => !entry.isInLibrary);

    set({
      results: visible.slice(0, DISCOVERY_MAX_RESULTS),
      hiddenLibraryCount: ranked.length - visible.length,
    });
  };

  /**
   * When an author sets no tags there is nothing to match on, and the results
   * collapse to "everything by the same person". The user's own filing is a
   * good stand-in: whatever they put in the same folders describes the mood of
   * this world better than an empty tag list does.
   */
  const deriveFromFolders = (
    seedIds: Set<string>,
    library: WorldDisplayData[],
  ) => {
    derivedTags = [];
    folderMateIds = new Set();

    const seedFolders = new Set<string>();
    for (const world of library) {
      if (seedIds.has(world.worldId)) {
        for (const folder of world.folders) seedFolders.add(folder);
      }
    }
    if (seedFolders.size === 0) return [] as WorldDisplayData[];

    const mates = library.filter(
      (world) =>
        !seedIds.has(world.worldId) &&
        world.folders.some((folder) => seedFolders.has(folder)),
    );
    folderMateIds = new Set(mates.map((world) => world.worldId));

    const tagCounts: Record<string, number> = {};
    for (const world of mates) {
      for (const tag of authorTagsOf(world)) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    }

    derivedTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_DERIVED_TAGS)
      .map(([tag]) => tag);
    set({ derivedTagNames: derivedTags });

    info(
      `[related] ${mates.length} folder mate(s) in ${seedFolders.size} folder(s), derived tags: ${derivedTags.join(', ')}`,
    );

    return mates;
  };

  /**
   * PlanetVRC is a hand-curated catalogue keyed by VRChat world id, so it can
   * describe worlds whose author never set a tag. Only the top handful of its
   * suggestions are resolved, since each unknown world costs an API call.
   */
  const fetchFromPlanetVrc = async (
    seedIds: string[],
    known: Map<string, WorldDisplayData>,
  ): Promise<{ worlds: WorldDisplayData[]; tagNames: string[] }> => {
    genreMateIds = new Set();

    const related = await commands.getPlanetvrcRelated(seedIds, 40);
    if (related.status !== 'ok') {
      error(`[related] PlanetVRC lookup failed: ${related.error}`);
      return { worlds: [], tagNames: [] };
    }

    info(
      `[related] PlanetVRC tags=[${related.data.tagNames.join(', ')}], ` +
        `${related.data.worldIds.length} candidate(s), ` +
        `${related.data.missingWorldIds.length} seed(s) not listed`,
    );

    const worlds: WorldDisplayData[] = [];
    let lookups = 0;

    for (const worldId of related.data.worldIds) {
      genreMateIds.add(worldId);

      const alreadyKnown = known.get(worldId);
      if (alreadyKnown) {
        worlds.push(alreadyKnown);
        continue;
      }

      if (lookups >= MAX_GENRE_LOOKUPS) continue;
      lookups += 1;

      await sleep(API_CALL_GAP_MS);
      const details = await commands.getWorld(worldId, true);
      if (details.status !== 'ok') continue;

      worlds.push(detailsToDisplayData(details.data));
    }

    return { worlds, tagNames: related.data.tagNames };
  };

  /**
   * Analyses the thumbnails of the results actually on screen, a batch at a
   * time, re-ranking as it goes. Runs after the first paint so the list is
   * never held up by it.
   */
  const topUpCandidateColors = async () => {
    const usePalette = get().palette.length > 0;
    if (weights.color <= 0 && !usePalette) return;

    // With a palette the whole list is analysed rather than the leading
    // stretch of it: the worlds the user is reaching for are precisely the
    // ones the tag ranking buried, so stopping at 60 would hide them.
    const limit = usePalette ? DISCOVERY_MAX_RESULTS : MAX_COLOR_CANDIDATES;

    const targets = missingColorTargets(
      get().results.map((entry) => entry.world),
      colorFeatures,
      limit,
    );
    if (targets.length === 0) return;

    set({ colorProgress: { done: 0, total: targets.length } });

    const outcome = await analyzeColorsInBatches(targets, colorFeatures, {
      onBatch: ({ done, total }) => {
        set({ colorProgress: { done, total } });
        rerank();
      },
    });
    if (outcome.error) {
      error(`[related] colour analysis failed: ${outcome.error}`);
    }

    set({ colorProgress: null });
  };

  const fetchFor = async (seeds: RelatedSeed[]) => {
    await loadWeights();
    const seedIds = new Set(seeds.map((seed) => seed.worldId));

    const libraryResult = await commands.getAllWorlds();
    const library = libraryResult.status === 'ok' ? libraryResult.data : [];
    const libraryById = new Map(library.map((world) => [world.worldId, world]));
    libraryIds = new Set(libraryById.keys());
    tagIdf = buildTagIdf(library);

    const folderMates = deriveFromFolders(seedIds, library);

    const genre = await fetchFromPlanetVrc(
      seeds.map((seed) => seed.worldId),
      libraryById,
    );
    set({ genreTagNames: genre.tagNames });

    const profile = buildRelatedProfile(seeds, get().mode, derivedTags);
    // Always query the union of tags: the "all" mode narrows the same pool
    // afterwards, so one fetch serves both modes.
    const unionProfile = buildRelatedProfile(seeds, 'any', derivedTags);

    info(
      `[related] ${seeds.length} seed(s), authors=${profile.authorIds.length}`,
    );

    // Folder mates are already-known worlds, but they are the closest thing to
    // a human judgement of "these belong together".
    // Rarest first: querying "room" returns every room in VRChat, querying
    // "letter" returns the handful that actually share this world's character.
    const queryTags = [...unionProfile.tags].sort(
      (a, b) => tagWeight(tagIdf, b) - tagWeight(tagIdf, a),
    );

    const pool: WorldDisplayData[] = [...folderMates, ...genre.worlds];
    const authorMap: Record<string, string> = {};
    let callIndex = 0;

    for (const authorId of profile.authorIds.slice(0, MAX_AUTHOR_QUERIES)) {
      await paceApiCall(callIndex++);

      const result = await commands.searchWorldsByAuthor(authorId, 1);
      if (result.status === 'ok') {
        for (const world of result.data) {
          authorMap[world.worldId] = authorId;
          pool.push(world);
        }
      } else {
        error(
          `[related] author search failed for ${authorId}: ${result.error}`,
        );
      }
    }

    for (const tag of queryTags.slice(0, MAX_TAG_QUERIES)) {
      await paceApiCall(callIndex++);

      const result = await commands.searchWorlds(
        'popularity',
        [tag],
        [],
        '',
        1,
      );
      if (result.status === 'ok') {
        pool.push(...result.data);
      } else {
        error(`[related] tag search failed for ${tag}: ${result.error}`);
      }
    }

    candidates = pool;
    authorIdByWorldId = authorMap;
    rerank();

    // Colour only refines an order that already exists, so it is loaded after
    // the first ranking is on screen.
    await loadColorFeatures(
      seeds.map((seed) => seed.worldId),
      [...pool, ...library],
    );
    rerank();

    // Candidates are almost never in the library, so their colours have to be
    // fetched here or the whole signal stays at zero.
    await topUpCandidateColors();
  };

  return {
    seeds: [],
    mode: 'any',
    results: [],
    genreTagNames: [],
    includeLibraryWorlds: false,
    hiddenLibraryCount: 0,
    derivedTagNames: [],
    colorState: 'off',
    colorProgress: null,
    palette: [],
    isLoading: false,
    errorMessage: null,

    search: async (worlds: WorldDisplayData[]) => {
      if (worlds.length === 0) return;

      set({ isLoading: true, errorMessage: null, results: [] });
      try {
        // WorldDisplayData has no author id, so the seeds are resolved through
        // the details endpoint. dontSaveToLocal keeps the library untouched.
        const seeds: RelatedSeed[] = [];
        for (const [index, world] of worlds.entries()) {
          await paceApiCall(index);
          const details = await commands.getWorld(world.worldId, true);
          seeds.push(
            toSeed(
              world,
              details.status === 'ok' ? details.data.authorId : '',
              details.status === 'ok' ? details.data.description : '',
            ),
          );
        }

        set({ seeds });
        await fetchFor(seeds);
      } catch (e) {
        error(`[related] search failed: ${e}`);
        set({ errorMessage: String(e) });
      } finally {
        set({ isLoading: false });
      }
    },

    setMode: (mode: RelatedMode) => {
      set({ mode });
      rerank();
    },

    setIncludeLibraryWorlds: (include: boolean) => {
      set({ includeLibraryWorlds: include });
      rerank();
    },

    setPalette: (palette: ColorPaletteId[]) => {
      set({ palette });

      // No refetch: this only changes how the worlds already fetched are
      // ordered, plus the thumbnails needed to do it.
      void (async () => {
        if (get().seeds.length === 0) return;
        await loadColorFeatures(
          get().seeds.map((seed) => seed.worldId),
          candidates,
        );
        rerank();
        await topUpCandidateColors();
      })();
    },

    hideWorld: async (worldId: string) => {
      try {
        await saveAndHideWorld(worldId);

        hiddenIds.add(worldId);
        set((state) => ({
          results: state.results.filter(
            (entry) => entry.world.worldId !== worldId,
          ),
        }));
      } catch (e) {
        error(`[related] hiding a world failed: ${e}`);
      }
    },

    clearSeeds: () => {
      hiddenIds = new Set();
      candidates = [];
      authorIdByWorldId = {};
      derivedTags = [];
      folderMateIds = new Set();
      genreMateIds = new Set();
      set({
        seeds: [],
        results: [],
        genreTagNames: [],
        derivedTagNames: [],
        hiddenLibraryCount: 0,
        errorMessage: null,
      });
    },

    rankAgainstSeeds: (worlds: WorldDisplayData[]) => {
      const { seeds, mode } = get();
      if (seeds.length === 0) return [];

      const profile = buildRelatedProfile(seeds, mode, derivedTags);
      return rankRelated(worlds, profile, {
        authorIdByWorldId,
        folderMateIds,
        genreMateIds,
        libraryIds,
        weights,
        colorFeatures,
        tagIdf,
        seedColor,
        palette: get().palette,
        keepUnmatched: true,
      });
    },

    refresh: async () => {
      const { seeds, isLoading } = get();
      if (isLoading || seeds.length === 0) return;

      set({ isLoading: true, errorMessage: null });
      try {
        await fetchFor(seeds);
      } catch (e) {
        error(`[related] refresh failed: ${e}`);
        set({ errorMessage: String(e) });
      } finally {
        set({ isLoading: false });
      }
    },

    updateWorld: (worldId: string, updates: Partial<WorldDisplayData>) => {
      set((state) => ({
        results: state.results.map((entry) =>
          entry.world.worldId === worldId
            ? { ...entry, world: { ...entry.world, ...updates } }
            : entry,
        ),
      }));
    },
  };
});
