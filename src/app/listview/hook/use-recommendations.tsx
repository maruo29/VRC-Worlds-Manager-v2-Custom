'use client';

import { create } from 'zustand';
import { commands, WorldDisplayData } from '@/lib/bindings';
import { error, info } from '@tauri-apps/plugin-log';
import {
  authorTagsOf,
  buildColorTaste,
  buildPreferenceProfile,
  candidateTags,
  isPublishedWithin,
  rankCandidates,
  CANDIDATE_TAG_LIMIT,
  type ColorTasteProfile,
  type PreferenceProfile,
  type ScoredWorld,
} from '@/lib/recommend';
import type { ColorPaletteId } from '@/lib/color-palette';
import { DISCOVERY_MAX_RESULTS, paceApiCall } from '@/lib/discovery';
import {
  MAX_COLOR_CANDIDATES,
  analyzeColorsInBatches,
  missingColorTargets,
  readColorFeatures,
  type ColorFeatureMap,
} from '@/lib/color-analysis';
import { saveAndHideWorld } from '@/lib/library-actions';

/**
 * The questions worth asking separately.
 *
 * These are not sort orders over one result set: each tab queries the VRChat
 * API differently, so they see different worlds entirely. Sorting a list of
 * popular worlds by date only tells you which of those popular worlds is
 * newest, which is not the same thing as what came out this week.
 *
 * The `official-` tabs are VRChat's own listings, shown in VRChat's own
 * order. They deliberately skip the taste ranking: their value is being
 * exactly what everyone else is being shown, which a personal re-ordering
 * would destroy.
 */
export type RecommendTab =
  | 'popular'
  | 'new'
  | 'official-popular'
  | 'official-active'
  | 'official-new';

/** Tabs built from the user's own library. */
export const PERSONAL_TABS: RecommendTab[] = ['popular', 'new'];

/** Tabs that are VRChat's listings, untouched. */
export const OFFICIAL_TABS: RecommendTab[] = [
  'official-popular',
  'official-active',
  'official-new',
];

export const RECOMMEND_TABS: RecommendTab[] = [
  ...PERSONAL_TABS,
  ...OFFICIAL_TABS,
];

export const isOfficialTab = (tab: RecommendTab) => tab.startsWith('official-');

/** VRChat's sort parameter behind each official tab. */
const OFFICIAL_SORTS: Record<string, string> = {
  'official-popular': 'popularity',
  // "heat" is VRChat's measure of where people actually are right now.
  'official-active': 'heat',
  'official-new': 'publicationDate',
};

/**
 * How far back the new tab is allowed to reach, in days; null means no limit.
 *
 * The API is asked for each tag's newest 100 worlds, and how far back that
 * reaches depends entirely on how popular the tag is - a week for a common
 * one, years for a rare one. Without a window the tab therefore shows a mix
 * of genuinely new worlds and old ones that happen to carry an unusual tag.
 */
export const NEW_WINDOW_OPTIONS: { id: string; days: number | null }[] = [
  { id: '1d', days: 1 },
  { id: '3d', days: 3 },
  { id: '7d', days: 7 },
  { id: '30d', days: 30 },
  { id: '90d', days: 90 },
  { id: 'all', days: null },
];

/** A week is long enough to be worth browsing and short enough to mean new. */
export const DEFAULT_NEW_WINDOW = '7d';

/** Results survive navigating away and back; refreshed on demand or when stale. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Pages of newest worlds to pull (100 worlds per page). */
const NEW_ARRIVAL_PAGES = 2;

/** Pages pulled for an official listing; 200 worlds is far past browsing. */
const OFFICIAL_PAGES = 2;

/** Settings edits are batched so typing a tag does not fire a fetch per key. */
const AUTO_REFRESH_DELAY_MS = 1200;

interface RecommendationsState {
  /** Which question is being asked; each tab keeps its own results. */
  tab: RecommendTab;
  /** Id from NEW_WINDOW_OPTIONS; only meaningful on the new tab. */
  newWindow: string;
  /** Suggestions the new tab's window is currently holding back. */
  outOfWindowCount: number;
  /** Colour families asked for outright; empty means "follow my library". */
  palette: ColorPaletteId[];
  profile: PreferenceProfile | null;
  results: ScoredWorld[];
  manualTags: string[];
  excludedTags: string[];
  isLoading: boolean;
  isRefreshing: boolean;
  lastFetchedAt: number | null;
  errorMessage: string | null;
  /**
   * Whether thumbnail colour is contributing:
   *  - `off`     the strength setting is zero
   *  - `ready`   the library has analysed thumbnails to compare against
   *  - `missing` colour is switched on but nothing has been analysed yet
   */
  colorState: 'off' | 'ready' | 'missing';
  /** Library worlds behind the colour taste profile. */
  colorAnchorCount: number;
  /** Set while candidate thumbnails are being analysed in the background. */
  colorProgress: { done: number; total: number } | null;

  /** Loads settings + profile, and fetches results if the cache is cold. */
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Switches tab, fetching that tab's worlds the first time it is opened. */
  setTab: (tab: RecommendTab) => void;
  /** Narrows the new tab to worlds published inside the window; no refetch. */
  setNewWindow: (id: string) => void;
  /** Prioritises the given colour families; no refetch, thumbnails only. */
  setPalette: (palette: ColorPaletteId[]) => void;
  setManualTags: (tags: string[]) => Promise<void>;
  setExcludedTags: (tags: string[]) => Promise<void>;
  /** Saves the world to the library and hides it, like anywhere else. */
  hideWorld: (worldId: string) => Promise<void>;
  /** Keeps cards in sync when something else edits a world. */
  updateWorld: (worldId: string, updates: Partial<WorldDisplayData>) => void;
}

async function loadSettings(): Promise<{
  manualTags: string[];
  excludedTags: string[];
}> {
  const [manual, excluded] = await Promise.all([
    commands.getRecommendManualTags(),
    commands.getRecommendExcludedTags(),
  ]);

  return {
    manualTags: manual.status === 'ok' ? manual.data : [],
    excludedTags: excluded.status === 'ok' ? excluded.data : [],
  };
}

/**
 * One query per tag: the VRChat API treats a comma-separated tag list as AND,
 * so sending every profile tag at once would return almost nothing.
 */
async function fetchByTags(
  tags: string[],
  excludedTags: string[],
  sort: string,
): Promise<WorldDisplayData[]> {
  const candidates: WorldDisplayData[] = [];

  for (const [index, tag] of tags.entries()) {
    await paceApiCall(index);

    const result = await commands.searchWorlds(
      sort,
      [tag],
      excludedTags,
      '',
      1,
    );

    if (result.status === 'ok') {
      candidates.push(...result.data);
    } else {
      error(`[recommendations] tag search failed for ${tag}: ${result.error}`);
    }
  }

  return candidates;
}

/**
 * One of VRChat's own listings: no tags, no personal weighting, its order
 * preserved exactly as returned.
 */
async function fetchOfficial(
  sort: string,
  excludedTags: string[],
): Promise<WorldDisplayData[]> {
  const candidates: WorldDisplayData[] = [];

  for (let page = 1; page <= OFFICIAL_PAGES; page += 1) {
    await paceApiCall(page - 1);

    const result = await commands.searchWorlds(
      sort,
      [],
      excludedTags,
      '',
      page,
    );
    if (result.status !== 'ok') {
      error(`[recommendations] official ${sort} page ${page}: ${result.error}`);
      break;
    }

    candidates.push(...result.data);
    if (result.data.length === 0) break;
  }

  return candidates;
}

async function fetchNewArrivals(
  excludedTags: string[],
): Promise<WorldDisplayData[]> {
  const candidates: WorldDisplayData[] = [];

  for (let page = 1; page <= NEW_ARRIVAL_PAGES; page += 1) {
    await paceApiCall(page - 1);

    const result = await commands.searchWorlds(
      'publicationDate',
      [],
      excludedTags,
      '',
      page,
    );

    if (result.status === 'ok') {
      candidates.push(...result.data);
      if (result.data.length === 0) break;
    } else {
      error(`[recommendations] new arrivals page ${page}: ${result.error}`);
      break;
    }
  }

  return candidates;
}

/** Everything one tab remembers between visits. */
interface TabCache {
  candidates: WorldDisplayData[];
  results: ScoredWorld[];
  lastFetchedAt: number | null;
}

export const useRecommendationsStore = create<RecommendationsState>(
  (set, get) => {
    let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    // Per tab, so switching back is instant and does not re-query the API.
    const tabs = Object.fromEntries(
      RECOMMEND_TABS.map((tab) => [
        tab,
        { candidates: [], results: [], lastFetchedAt: null } as TabCache,
      ]),
    ) as Record<RecommendTab, TabCache>;

    // Shared by both tabs: taste comes from the library, not from whichever
    // list is on screen.
    let profile: PreferenceProfile | null = null;
    let library: WorldDisplayData[] = [];
    let hiddenIds: string[] = [];
    let activeExcludedTags: string[] = [];
    const colorFeatures: ColorFeatureMap = {};
    let colorTaste: ColorTasteProfile | null = null;
    let colorWeight = 0;

    /** Debounced so a burst of settings edits results in one fetch. */
    const scheduleAutoRefresh = () => {
      if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
      autoRefreshTimer = setTimeout(() => {
        autoRefreshTimer = null;
        get().refresh();
      }, AUTO_REFRESH_DELAY_MS);
    };

    /**
     * The colour half of the ranking, or undefined when colour is not in play.
     * An explicit palette counts even with the strength setting off: picking
     * one from a menu is an instruction, not a hint.
     */
    const colorContext = () => {
      const palette = get().palette;
      if (palette.length > 0) {
        return {
          taste: colorTaste,
          featuresByWorldId: colorFeatures,
          weight: colorWeight,
          palette,
        };
      }
      if (colorWeight > 0 && colorTaste) {
        return {
          taste: colorTaste,
          featuresByWorldId: colorFeatures,
          weight: colorWeight,
        };
      }
      return undefined;
    };

    /** Days the new tab currently reaches back, or null for no limit. */
    const windowDays = () =>
      NEW_WINDOW_OPTIONS.find((option) => option.id === get().newWindow)
        ?.days ?? null;

    /** A settings change invalidates both tabs, not just the visible one. */
    const invalidateAllTabs = () => {
      for (const tab of RECOMMEND_TABS) tabs[tab].lastFetchedAt = null;
    };

    const rerank = (tab: RecommendTab) => {
      if (isOfficialTab(tab)) {
        rerankOfficial(tab);
        return;
      }
      if (!profile) return;

      const ranked = rankCandidates(tabs[tab].candidates, profile, {
        excludedTags: activeExcludedTags,
        ignoredWorldIds: hiddenIds,
        color: colorContext(),
      });

      // Applied to the ranked list rather than the raw pool, so the count of
      // what the window holds back comes out of the same single pass.
      const maxAgeDays = tab === 'new' ? windowDays() : null;
      const windowed =
        maxAgeDays === null
          ? ranked
          : ranked.filter((entry) =>
              isPublishedWithin(entry.world, maxAgeDays),
            );

      tabs[tab].results = windowed.slice(0, DISCOVERY_MAX_RESULTS);
      if (get().tab === tab) {
        set({
          results: tabs[tab].results,
          outOfWindowCount: ranked.length - windowed.length,
        });
      }
    };

    /**
     * VRChat's listing, kept in VRChat's order.
     *
     * Only two things are taken out: worlds the user has hidden app-wide, and
     * worlds carrying a tag they asked never to see. Both are standing
     * instructions about what not to look at, so honouring them is not the
     * same as re-ranking. Worlds already in the library are left in: on a
     * listing of what everyone is being shown, "I have that one" is useful.
     */
    const rerankOfficial = (tab: RecommendTab) => {
      const excluded = new Set(
        activeExcludedTags
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0),
      );
      const hidden = new Set(hiddenIds);
      const seen = new Set<string>();
      const results: ScoredWorld[] = [];

      for (const world of tabs[tab].candidates) {
        if (seen.has(world.worldId) || hidden.has(world.worldId)) continue;
        if (
          excluded.size > 0 &&
          authorTagsOf(world).some((tag) => excluded.has(tag))
        ) {
          continue;
        }
        seen.add(world.worldId);
        results.push({ world, score: 0, matchedTags: [], colorScore: 0 });
      }

      tabs[tab].results = results.slice(0, DISCOVERY_MAX_RESULTS);
      if (get().tab === tab) {
        set({ results: tabs[tab].results, outOfWindowCount: 0 });
      }
    };

    /**
     * Builds the colour side of the taste profile from whatever the library
     * already has cached. Nothing here goes to the network: the full library
     * analysis stays a deliberate one-off from the settings screen.
     */
    const loadColorTaste = async (tab: RecommendTab) => {
      colorTaste = null;

      // Strength is shared with the related-worlds search, so there is one
      // "how much do I care about colour" setting rather than two.
      const weights = await commands.getRelatedWeights();
      colorWeight = weights.status === 'ok' ? weights.data.color : 0;

      // A chosen palette needs candidate thumbnails even when the inferred
      // colour preference is switched off entirely.
      const usePalette = get().palette.length > 0;
      if (colorWeight <= 0 && !usePalette) {
        set({ colorState: 'off', colorAnchorCount: 0 });
        return;
      }

      const ids = Array.from(
        new Set([
          ...library.map((world) => world.worldId),
          ...tabs[tab].candidates.map((world) => world.worldId),
        ]),
      );

      // Merged, not replaced: features fetched for the other tab are still
      // valid here, and they are keyed by world id anyway.
      if (!(await readColorFeatures(ids, colorFeatures))) {
        error('[recommendations] reading colour features failed');
        set({ colorState: 'missing', colorAnchorCount: 0 });
        return;
      }

      colorTaste = buildColorTaste(library, colorFeatures);

      info(
        `[recommendations] colour taste from ${colorTaste?.sourceCount ?? 0}/${library.length} library world(s)`,
      );

      set({
        colorState: colorTaste ? 'ready' : 'missing',
        // What is actually compared against, i.e. after the anchor cap.
        colorAnchorCount: colorTaste?.anchors.length ?? 0,
      });
    };

    /**
     * Analyses the thumbnails of the suggestions actually on screen, a batch
     * at a time, re-ranking as it goes. Runs after the first paint so the list
     * is never held up by it.
     */
    const topUpCandidateColors = async (tab: RecommendTab) => {
      const usePalette = get().palette.length > 0;
      if (!usePalette && (colorWeight <= 0 || !colorTaste)) return;

      // With a palette the whole list is analysed rather than the leading
      // stretch of it: the worlds the user is reaching for are precisely the
      // ones their tag ranking buried, so stopping at 60 would hide them.
      const limit = usePalette ? DISCOVERY_MAX_RESULTS : MAX_COLOR_CANDIDATES;

      const targets = missingColorTargets(
        tabs[tab].results.map((entry) => entry.world),
        colorFeatures,
        limit,
      );
      if (targets.length === 0) return;

      set({ colorProgress: { done: 0, total: targets.length } });

      const outcome = await analyzeColorsInBatches(targets, colorFeatures, {
        onBatch: ({ done, total }) => {
          set({ colorProgress: { done, total } });
          rerank(tab);
        },
      });
      if (outcome.error) {
        error(`[recommendations] colour analysis failed: ${outcome.error}`);
      }

      set({ colorProgress: null });
    };

    /** Shared by initialize() and refresh(); rebuilds the profile every time. */
    const runFetch = async (tab: RecommendTab) => {
      const settings = await loadSettings();

      const [libraryResult, hiddenResult] = await Promise.all([
        commands.getAllWorlds(),
        commands.getHiddenWorlds(),
      ]);
      if (libraryResult.status !== 'ok') throw new Error(libraryResult.error);

      library = libraryResult.data;
      // Hidden worlds are the app-wide "do not show me this" list, so they
      // are the only exclusion list recommendations need.
      hiddenIds =
        hiddenResult.status === 'ok'
          ? hiddenResult.data.map((world) => world.worldId)
          : [];
      activeExcludedTags = settings.excludedTags;

      if (isOfficialTab(tab)) {
        const sort = OFFICIAL_SORTS[tab];
        info(`[recommendations] official listing: sort=${sort}`);

        tabs[tab].candidates = await fetchOfficial(sort, settings.excludedTags);
        tabs[tab].lastFetchedAt = Date.now();

        set({
          manualTags: settings.manualTags,
          excludedTags: settings.excludedTags,
          lastFetchedAt: tabs[tab].lastFetchedAt,
          errorMessage: null,
        });
        rerank(tab);
        return;
      }

      profile = buildPreferenceProfile(library, settings.manualTags);
      const tags = candidateTags(profile, CANDIDATE_TAG_LIMIT);
      info(
        `[recommendations] ${tab} tab: profile built from ${profile.taggedWorldCount}/${profile.totalWorldCount} worlds, querying tags: ${tags.join(', ')}`,
      );

      // Same tags, different question: the popular tab asks the API for each
      // tag's best-loved worlds, the new tab for its most recent ones.
      const sort = tab === 'new' ? 'publicationDate' : 'popularity';

      // Sequential on purpose: these are many VRChat API calls in a row and
      // firing them in parallel is the fastest way to trip the rate limiter.
      const taggedCandidates =
        tags.length > 0
          ? await fetchByTags(tags, settings.excludedTags, sort)
          : [];

      // The new tab also pulls the plain newest-worlds pages. Plenty of worlds
      // are published with tags the profile has never seen, and this is what
      // lets one of those surface if it matches on anything at all.
      const freshCandidates =
        tab === 'new' ? await fetchNewArrivals(settings.excludedTags) : [];

      tabs[tab].candidates = [...taggedCandidates, ...freshCandidates];
      tabs[tab].lastFetchedAt = Date.now();

      set({
        profile,
        manualTags: settings.manualTags,
        excludedTags: settings.excludedTags,
        lastFetchedAt: tabs[tab].lastFetchedAt,
        errorMessage: null,
      });
      rerank(tab);

      // Colour only refines an order that already exists, so it is loaded
      // after the first ranking is on screen.
      await loadColorTaste(tab);
      rerank(tab);
      await topUpCandidateColors(tab);
    };

    return {
      tab: 'popular',
      newWindow: DEFAULT_NEW_WINDOW,
      outOfWindowCount: 0,
      palette: [],
      profile: null,
      results: [],
      manualTags: [],
      excludedTags: [],
      isLoading: false,
      isRefreshing: false,
      lastFetchedAt: null,
      errorMessage: null,
      colorState: 'off',
      colorAnchorCount: 0,
      colorProgress: null,

      initialize: async () => {
        const { tab, isLoading, isRefreshing } = get();
        if (isLoading || isRefreshing) return;

        const fetchedAt = tabs[tab].lastFetchedAt;
        if (fetchedAt && Date.now() - fetchedAt < CACHE_TTL_MS) return;

        set({ isLoading: true, errorMessage: null });
        try {
          await runFetch(tab);
        } catch (e) {
          error(`[recommendations] initialize failed: ${e}`);
          set({ errorMessage: String(e) });
        } finally {
          set({ isLoading: false });
        }
      },

      refresh: async () => {
        if (get().isRefreshing) return;

        set({ isRefreshing: true, errorMessage: null });
        try {
          await runFetch(get().tab);
        } catch (e) {
          error(`[recommendations] refresh failed: ${e}`);
          set({ errorMessage: String(e) });
        } finally {
          set({ isRefreshing: false });
        }
      },

      setTab: (tab: RecommendTab) => {
        if (get().tab === tab) return;

        // Whatever this tab had last time goes up immediately; initialize()
        // then fetches only if it was never loaded or has gone stale.
        set({
          tab,
          results: tabs[tab].results,
          lastFetchedAt: tabs[tab].lastFetchedAt,
          colorProgress: null,
          outOfWindowCount: 0,
          errorMessage: null,
        });

        // Re-ranking the cached pool costs nothing and restores the counts
        // that belong to this tab.
        if (tabs[tab].candidates.length > 0) rerank(tab);

        void get().initialize();
      },

      setNewWindow: (id: string) => {
        if (get().newWindow === id) return;
        // Purely a filter over what has already been fetched.
        set({ newWindow: id });
        rerank('new');
      },

      setPalette: (palette: ColorPaletteId[]) => {
        set({ palette });

        // No refetch: this only changes how the worlds already fetched are
        // ordered, plus the thumbnails needed to do it.
        void (async () => {
          const tab = get().tab;
          await loadColorTaste(tab);
          rerank(tab);
          await topUpCandidateColors(tab);
        })();
      },

      setManualTags: async (tags: string[]) => {
        const result = await commands.setRecommendManualTags(tags);
        if (result.status !== 'ok') {
          error(`[recommendations] saving manual tags failed: ${result.error}`);
          return;
        }
        set({ manualTags: tags });
        invalidateAllTabs();
        scheduleAutoRefresh();
      },

      setExcludedTags: async (tags: string[]) => {
        const result = await commands.setRecommendExcludedTags(tags);
        if (result.status !== 'ok') {
          error(
            `[recommendations] saving excluded tags failed: ${result.error}`,
          );
          return;
        }
        set({ excludedTags: tags });
        invalidateAllTabs();
        scheduleAutoRefresh();
      },

      hideWorld: async (worldId: string) => {
        try {
          await saveAndHideWorld(worldId);

          // Remembered here too, or the next re-rank would bring it back.
          hiddenIds.push(worldId);
          for (const tab of RECOMMEND_TABS) {
            tabs[tab].results = tabs[tab].results.filter(
              (entry) => entry.world.worldId !== worldId,
            );
          }
          set({ results: tabs[get().tab].results });
        } catch (e) {
          error(`[recommendations] hiding a world failed: ${e}`);
        }
      },

      updateWorld: (worldId: string, updates: Partial<WorldDisplayData>) => {
        for (const tab of RECOMMEND_TABS) {
          tabs[tab].results = tabs[tab].results.map((entry) =>
            entry.world.worldId === worldId
              ? { ...entry, world: { ...entry.world, ...updates } }
              : entry,
          );
        }
        set({ results: tabs[get().tab].results });
      },
    };
  },
);
