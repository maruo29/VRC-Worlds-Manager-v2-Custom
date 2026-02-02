'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useLocalization } from '@/hooks/use-localization';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  CircleHelpIcon,
  Loader2,
  RefreshCw,
  Search,
  Square,
  CheckSquare,
} from 'lucide-react';
import { commands, WorldDisplayData } from '@/lib/bindings';
import { SpecialFolders } from '@/types/folders';
import { info, error } from '@tauri-apps/plugin-log';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { WorldGrid } from '../../../components/world-grid';
import { WorldGridSkeleton } from '../../../components/world-grid/skeleton';
import MultiFilterItemSelector from '@/components/multi-filter-item-selector';
import { useSelectedWorldsStore } from '../../../hook/use-selected-worlds';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { useFolders } from '@/app/listview/hook/use-folders';

export default function FindWorldsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLocalization();
  const [activeTab, setActiveTab] = useState('recently-visited');
  const [recentlyVisitedWorlds, setRecentlyVisitedWorlds] = useState<
    WorldDisplayData[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<WorldDisplayData[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSort, setSelectedSort] = useState('popularity');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedExcludedTags, setSelectedExcludedTags] = useState<string[]>(
    [],
  );
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreResults, setHasMoreResults] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const findGridRef = useRef<HTMLDivElement>(null);
  const {
    isSelectionMode,
    toggleSelectionMode,
    clearFolderSelections,
    selectAllWorlds,
    getSelectedWorlds,
  } = useSelectedWorldsStore();

  const selectedWorlds = Array.from(getSelectedWorlds(SpecialFolders.Find));
  const selectedWorldIdSet = new Set(selectedWorlds);

  // Check if all recently visited worlds are selected
  const allSelected =
    recentlyVisitedWorlds.length > 0 &&
    selectedWorlds.length === recentlyVisitedWorlds.length &&
    recentlyVisitedWorlds.every((world) =>
      selectedWorldIdSet.has(world.worldId),
    );

  const handleSelectAll = () => {
    if (allSelected) {
      clearFolderSelections(SpecialFolders.Find);
    } else {
      const worldIds = recentlyVisitedWorlds.map((world) => world.worldId);
      selectAllWorlds(SpecialFolders.Find, worldIds);
    }
  };

  const { importFolder } = useFolders();

  // Fetch all local worlds to map status
  const [localWorldsMap, setLocalWorldsMap] = useState<Map<string, WorldDisplayData>>(new Map());

  // Function to refresh local worlds map and return it
  const refreshLocalWorldsMap = useCallback(async () => {
    try {
      const result = await commands.getAllWorlds();
      if (result.status === 'ok') {
        const map = new Map<string, WorldDisplayData>();
        result.data.forEach((w) => map.set(w.worldId, w));
        setLocalWorldsMap(map);
        return map;
      }
    } catch (e) {
      error(`Failed to fetch local worlds for mapping: ${e}`);
    }
    return new Map<string, WorldDisplayData>();
  }, []);

  // Initial fetch of local worlds
  useEffect(() => {
    refreshLocalWorldsMap();
  }, [refreshLocalWorldsMap]);

  const fetchRecentlyVisitedWorlds = useCallback(async () => {
    try {
      setIsLoading(true);
      // Ensure we have fresh local data before merging
      const currentMap = await refreshLocalWorldsMap();

      const worlds = await commands.getRecentlyVisitedWorlds();
      if (worlds.status !== 'ok') {
        throw new Error(worlds.error);
      } else {
        info(`Fetched recently visited worlds: ${worlds.data.length}`);

        // Merge local data (tags, favorite status, etc.)
        const mergedWorlds = worlds.data.map((world) => {
          const localData = currentMap.get(world.worldId);
          if (localData) {
            return {
              ...world,
              folders: localData.folders,
              isFavorite: localData.isFavorite,
              isPhotographed: localData.isPhotographed,
            };
          }
          return world;
        });

        setRecentlyVisitedWorlds(mergedWorlds);
      }
      toast(t('find-page:fetch-recently-visited-worlds'), {
        description: t(
          'find-page:fetch-recently-visited-worlds-success',
          worlds.data.length,
        ),
        duration: 1000,
      });
    } catch (err) {
      error(`Error fetching recently visited worlds: ${String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, [t, refreshLocalWorldsMap]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // CTRL + R - Reload worlds (only in recently-visited tab)
      if (e.ctrlKey && e.key === 'r' && activeTab === 'recently-visited') {
        e.preventDefault();
        fetchRecentlyVisitedWorlds();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, fetchRecentlyVisitedWorlds]);

  // subscribe to deep link events
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    (async () => {
      unsubscribe = await onOpenUrl((urls) => {
        info(`deep link: ${JSON.stringify(urls)}`);
        //vrc-worlds-manager://vrcwm.raifaworks.com/folder/import/${uuid}
        //call handleImportFolder with the uuid
        const importRegex =
          /vrc-worlds-manager:\/\/vrcwm\.raifaworks\.com\/folder\/import\/([a-zA-Z0-9-]+)/;
        const match = urls[0].match(importRegex);
        if (match && match[1]) {
          const uuid = match[1];
          importFolder(uuid);
        }
      });
    })();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // Add this state variable to track if a search has been performed
  const [hasSearched, setHasSearched] = useState(false);

  // Track if we've already processed the query params (to avoid re-triggering)
  const [hasProcessedUrlParams, setHasProcessedUrlParams] = useState(false);

  // Keep selectedSort in sync: when a search query is present, force sort to 'relevance'
  useEffect(() => {
    if (searchQuery.trim() !== '') {
      // Only update when it's not already 'relevance' to avoid unnecessary state updates
      setSelectedSort((prev) => (prev === 'relevance' ? prev : 'relevance'));
    }
  }, [searchQuery]);

  // Backoff control for load-more errors
  const [loadMoreBackoffUntil, setLoadMoreBackoffUntil] = useState<
    number | null
  >(null);

  // Fetch recently visited worlds on initial load
  useEffect(() => {
    // Only fetch if empty and not loading. 
    // Optimization: Also could check if we have map loaded?
    // refreshLocalWorldsMap is called in fetchRecentlyVisitedWorlds anyway.
    if (recentlyVisitedWorlds.length === 0 && !isLoading) {
      fetchRecentlyVisitedWorlds();
    }
  }, [recentlyVisitedWorlds.length, isLoading, fetchRecentlyVisitedWorlds]);

  // Load tags when the search tab is active
  useEffect(() => {
    const loadTags = async () => {
      try {
        const result = await commands.getTagsByCount();
        if (result.status === 'ok') {
          setAvailableTags(result.data);
        }
      } catch (err) {
        error(`Failed to load tags: ${err}`);
      }
    };

    if (activeTab === 'search') {
      loadTags();
    }
  }, [activeTab]);

  // Handle auto-search from URL query params (triggered by deep link)
  useEffect(() => {
    if (hasProcessedUrlParams) return;

    const queryParam = searchParams.get('q');
    const autoSearch = searchParams.get('autoSearch');

    if (queryParam && autoSearch === 'true') {
      info(`Auto-search triggered from URL params: ${queryParam}`);
      setHasProcessedUrlParams(true);

      // Switch to search tab
      setActiveTab('search');

      // Set the search query
      setSearchQuery(queryParam);

      // Clear URL params to avoid re-triggering on refresh
      router.replace('/listview/folders/special/find', { scroll: false });

      // Trigger search after a short delay to let state update
      setTimeout(() => {
        handleSearchFromUrl(queryParam);
      }, 100);
    }
  }, [searchParams, hasProcessedUrlParams, router]);

  // Separate function for URL-triggered search to avoid dependency issues
  const handleSearchFromUrl = async (query: string) => {
    setHasSearched(true);
    setIsSearching(true);
    setCurrentPage(1);
    setSearchResults([]);
    setHasMoreResults(true);

    try {
      const result = await commands.searchWorlds(
        'relevance', // Always use relevance for text search
        [],
        [],
        query,
        1,
      );

      if (result.status === 'ok') {
        info(`Auto-search results: ${result.data.length} worlds found`);
        const processedData = result.data; // Note: Auto-search also needs merging if desired, but less criticial for initial load
        setSearchResults(processedData);
        setHasMoreResults(result.data.length > 0);

        if (result.data.length === 0) {
          toast(t('find-page:no-more-results'), {
            description: t('find-page:try-different-search'),
          });
        }
      } else {
        throw new Error(result.error);
      }
    } catch (err) {
      error(`Auto-search error: ${err}`);
      toast(t('find-page:search-error'), {
        description: String(err),
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = async (loadMore = false) => {
    // Respect backoff if trying to auto load more
    if (loadMore && loadMoreBackoffUntil && Date.now() < loadMoreBackoffUntil) {
      return;
    }

    let currentMap = localWorldsMap;
    if (!loadMore) {
      // Only set this flag when performing a new search, not when loading more
      setHasSearched(true);
      // Refresh local map on new search to be fresh, and wait for it
      currentMap = await refreshLocalWorldsMap();
    }

    if (loadMore) {
      setIsLoadingMore(true);
    } else {
      setIsSearching(true);
      setCurrentPage(1); // Reset page when performing a new search
      setSearchResults([]); // Clear previous results
      setHasMoreResults(true); // Assume there are more results
    }

    try {
      const page = loadMore ? currentPage + 1 : 1;

      const result = await commands.searchWorlds(
        selectedSort,
        selectedTags,
        selectedExcludedTags,
        searchQuery,
        page,
      );

      if (result.status === 'ok') {
        info(`Search results: ${result.data.length} worlds found`);

        const processResults = (worlds: WorldDisplayData[]) => {
          return worlds.map((world) => {
            const localData = currentMap.get(world.worldId);
            if (localData) {
              return {
                ...world,
                folders: localData.folders,
                isFavorite: localData.isFavorite,
                isPhotographed: localData.isPhotographed,
                // prefer local data for mutable fields if needed, 
                // but search result might be more up to date for visits/etc.
                // keeping search result metadata but overlaying user status
              };
            }
            return world;
          });
        };

        const processedData = processResults(result.data);

        if (loadMore) {
          // Append new results to existing ones
          setSearchResults((prev) => [...prev, ...processedData]);
          setCurrentPage(currentPage + 1);
          setLoadMoreBackoffUntil(null); // reset backoff after success
        } else {
          // Replace results for new search
          setSearchResults(processedData);
          setCurrentPage(1);
        }

        // Check if we've reached the end of results
        setHasMoreResults(result.data.length > 0);

        if (result.data.length === 0 && !loadMore) {
          toast(t('find-page:no-more-results'), {
            description: t('find-page:try-different-search'),
          });
        }
      } else {
        throw new Error(result.error);
      }
    } catch (err) {
      error(`Search error: ${err}`);
      toast(t('find-page:search-error'), {
        description: String(err),
      });

      // Apply a brief backoff and nudge scroll up so the sentinel isn't intersecting
      if (loadMore) {
        const backoffMs = 2500; // 2-3 seconds backoff
        setLoadMoreBackoffUntil(Date.now() + backoffMs);
        info(`Load-more backoff applied for ${backoffMs}ms; nudging scroll up`);
        const scroller = findGridRef.current;
        try {
          if (scroller) {
            scroller.scrollBy({ top: -100, behavior: 'smooth' });
          } else if (typeof window !== 'undefined') {
            window.scrollBy({ top: -100, behavior: 'smooth' });
          }
        } catch (_) {
          // noop
        }
      }
    } finally {
      setIsLoadingMore(false);
      setIsSearching(false);
    }
  };

  // Add this useEffect to observe when user scrolls to bottom
  useEffect(() => {
    // Only observe if we have results and more results are available
    if (
      !searchResults.length ||
      !hasMoreResults ||
      isLoadingMore ||
      isSearching
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // When the load more indicator comes into view
        if (entries[0].isIntersecting) {
          handleSearch(true);
        }
      },
      { threshold: 0.5 }, // Trigger when element is 50% visible
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [searchResults, hasMoreResults, isLoadingMore, isSearching]);

  // no external select-all; handled by grid internally when needed

  return (
    <div className="p-1 flex flex-col h-full min-h-0">
      {/* added min-h-0 */}
      {/* Header with title and reload button */}
      <div className="flex items-center justify-between p-4 bg-background">
        <h1 className="text-xl font-bold">{t('general:find-worlds')}</h1>

        <div className="flex items-center">
          {isSelectionMode &&
            activeTab === 'recently-visited' &&
            recentlyVisitedWorlds.length > 0 && (
              <Button
                variant="outline"
                onClick={handleSelectAll}
                className="mr-2 flex items-center gap-2 cursor-pointer"
              >
                <span>
                  {allSelected
                    ? t('general:clear-all')
                    : t('general:select-all')}
                </span>
              </Button>
            )}
          <Button
            variant="outline"
            onClick={fetchRecentlyVisitedWorlds}
            disabled={activeTab !== 'recently-visited' || isLoading}
            className={`ml-2 flex items-center gap-2 ${activeTab !== 'recently-visited' ? 'invisible' : ''
              }`}
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            />
            <span>{t('general:fetch-refresh')}</span>
          </Button>
          <Button
            variant={isSelectionMode ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => {
              if (isSelectionMode) {
                clearFolderSelections(SpecialFolders.Find);
                toggleSelectionMode();
              } else {
                toggleSelectionMode();
              }
            }}
            className={`ml-2 h-9 w-9 ${activeTab !== 'recently-visited' ? 'invisible' : ''
              }`}
          >
            {isSelectionMode ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Tab bar with full-width tabs */}
      <div className="bg-background px-4 pb-2">
        <Tabs
          defaultValue="recently-visited"
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full"
        >
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="recently-visited">
              {t('find-page:recently-visited')}
            </TabsTrigger>
            <TabsTrigger value="search">
              {t('find-page:search-worlds')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Search and filter controls - moved into the search tab content scroll container below */}

      {/* Main content area */}
      <div>
        {activeTab === 'recently-visited' && (
          <div className="flex flex-col gap-2">
            {isLoading ? (
              <WorldGridSkeleton />
            ) : recentlyVisitedWorlds.length > 0 ? (
              <WorldGrid
                worlds={recentlyVisitedWorlds}
                currentFolder={SpecialFolders.Find}
                containerRef={findGridRef}
                onWorldUpdate={(worldId, updates) => {
                  setRecentlyVisitedWorlds((prev) =>
                    prev.map((w) => (w.worldId === worldId ? { ...w, ...updates } : w)),
                  );
                  setLocalWorldsMap((prevMap) => {
                    const newMap = new Map(prevMap);
                    const existing = newMap.get(worldId);
                    if (existing) {
                      newMap.set(worldId, { ...existing, ...updates });
                    } else {
                      // Should we add it if not found?
                      // If favorited, maybe?
                    }
                    return newMap;
                  });
                }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-64">
                <p className="text-muted-foreground">
                  {t('find-page:no-recently-visited-worlds')}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'search' && (
          <div className="flex-1 min-h-0">
            {/* new scroll container for search tab */}
            <div className="sticky top-0 z-40 bg-background border-b">
              {/* sticky header now inside scroller */}
              <Card className=" mx-4 border-0 shadow-none">
                <CardContent className="pt-4 space-y-4">
                  {/* First row: Search input, Sort dropdown, and Search button */}
                  <div className="flex gap-4 items-end">
                    {/* Search text input */}
                    <div className="flex flex-col gap-2 w-3/5">
                      <Label htmlFor="search-query">
                        {t('find-page:search-query')}
                      </Label>
                      <Input
                        id="search-query"
                        placeholder={t('find-page:search-placeholder')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>

                    {/* Sort options */}
                    <div className="flex flex-col gap-2 w-2/5">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="sort">{t('find-page:sort-by')}</Label>
                        {searchQuery.trim() !== '' && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <CircleHelpIcon className="w-3 h-3 m-0" />
                              </TooltipTrigger>
                              <TooltipContent>
                                {t('find-page:sort-relevant-tooltip')}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                      <Select
                        value={selectedSort}
                        onValueChange={setSelectedSort}
                        disabled={searchQuery.trim() !== ''}
                      >
                        <SelectTrigger id="sort">
                          <SelectValue
                            placeholder={t('find-page:sort-popularity')}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="popularity">
                            {t('find-page:sort-popularity')}
                          </SelectItem>
                          <SelectItem value="heat">
                            {t('find-page:sort-heat')}
                          </SelectItem>
                          <SelectItem value="random">
                            {t('find-page:sort-random')}
                          </SelectItem>
                          <SelectItem value="favorites">
                            {t('find-page:sort-favorites')}
                          </SelectItem>
                          <SelectItem value="publicationDate">
                            {t('find-page:sort-publication-date')}
                          </SelectItem>
                          <SelectItem value="created">
                            {t('find-page:sort-created')}
                          </SelectItem>
                          <SelectItem value="updated">
                            {t('find-page:sort-updated')}
                          </SelectItem>
                          <SelectItem value="relevance">
                            {t('find-page:sort-relevant')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Second row: Tag filters */}
                  <div className="flex gap-4 items-start">
                    {/* Tag combobox */}
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <Label htmlFor="tag">{t('find-page:tag')}</Label>
                      <MultiFilterItemSelector
                        placeholder={t('find-page:tag-placeholder')}
                        candidates={availableTags.map((tag) => ({
                          value: tag,
                          label: tag,
                        }))}
                        values={selectedTags}
                        onValuesChange={setSelectedTags}
                        allowCustomValues={true}
                        maxItems={5}
                        id="Tag"
                      />
                    </div>

                    {/* Exclude Tag combobox */}
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="exclude-tag">
                          {t('find-page:exclude-tag')}
                        </Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <CircleHelpIcon className="w-3 h-3 m-0" />
                            </TooltipTrigger>
                            <TooltipContent>
                              {t('find-page:exclude-tag-tooltip')}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <MultiFilterItemSelector
                        placeholder={t('find-page:exclude-tag-placeholder')}
                        candidates={[...availableTags].reverse().map((tag) => ({
                          value: tag,
                          label: tag,
                        }))}
                        values={selectedExcludedTags}
                        onValuesChange={setSelectedExcludedTags}
                        allowCustomValues={true}
                        maxItems={5}
                        id="ExcludeTag"
                      />
                    </div>
                    {/* Search button */}
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <Label className="invisible">
                        Invisible Label to align the button!
                        {/* <3 ciel-chan */}
                      </Label>
                      <Button
                        className="flex-shrink-0"
                        onClick={() => handleSearch(false)}
                        disabled={isSearching}
                      >
                        {isSearching ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t('find-page:searching')}
                          </>
                        ) : (
                          <>
                            <Search className="mr-2 h-4 w-4" />
                            {t('find-page:search-button')}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-4 p-4">
              {/* original search tab content */}
              {/* Search results */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {hasSearched && searchResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
                    <Search className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-lg font-medium">{t('listview-page:no-search-results')}</p>
                    <p className="text-sm mt-2">{t('listview-page:try-different-keywords')}</p>
                  </div>
                ) : !hasSearched && searchResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
                    <Search className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-lg font-medium">{t('listview-page:start-search-title')}</p>
                    <p className="text-sm mt-2">{t('listview-page:start-search-description')}</p>
                  </div>
                ) : (
                  <>
                    {isSearching && searchResults.length === 0 && (
                      <WorldGridSkeleton />
                    )}
                    {searchResults.length > 0 && (
                      <>
                        <WorldGrid
                          worlds={searchResults}
                          currentFolder={SpecialFolders.Find}
                          containerRef={findGridRef}
                          onWorldUpdate={(worldId, updates) => {
                            setSearchResults((prev) =>
                              prev.map((w) => (w.worldId === worldId ? { ...w, ...updates } : w)),
                            );
                            setLocalWorldsMap((prevMap) => {
                              const newMap = new Map(prevMap);
                              const existing = newMap.get(worldId);
                              if (existing) {
                                newMap.set(worldId, { ...existing, ...updates });
                              }
                              return newMap;
                            });
                          }}
                        />

                        <div ref={loadMoreRef} className="p-4 flex justify-center shrink-0">
                          {isLoadingMore ? (
                            <div className="w-full max-w-screen-lg">
                              <WorldGridSkeleton count={6} />
                            </div>
                          ) : hasMoreResults ? (
                            <p className="text-sm text-muted-foreground">
                              {t('find-page:scroll-for-more')}
                            </p>
                          ) : (
                            searchResults.length > 0 && (
                              <p className="text-sm text-muted-foreground">
                                {t('find-page:no-more-results')}
                              </p>
                            )
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
