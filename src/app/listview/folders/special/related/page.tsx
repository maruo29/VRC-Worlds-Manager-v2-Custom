'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocalization } from '@/hooks/use-localization';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Loader2,
  RefreshCw,
  Share2,
  Search,
  Download,
  Upload,
} from 'lucide-react';
import { SpecialFolders } from '@/types/folders';
import { WorldGrid } from '../../../components/world-grid';
import { WorldGridSkeleton } from '../../../components/world-grid/skeleton';
import { useRelatedWorldsStore } from '../../../hook/use-related-worlds';
import { ColorPaletteSelect } from '@/components/color-palette-select';
import { ColorSignalStatus } from '@/components/color-signal-status';
import {
  WorldSortSelect,
  sortWorldItems,
  type SortDirection,
  type WorldSortKey,
} from '@/components/world-sort-select';
import type { RelatedMode } from '@/lib/related';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  buildSnapshot,
  loadSnapshot,
  saveSnapshot,
  type SearchSnapshot,
} from '@/lib/search-snapshot';
import type { WorldDisplayData } from '@/lib/bindings';

export default function RelatedWorldsPage() {
  const { t } = useLocalization();
  const gridRef = useRef<HTMLDivElement>(null);

  // Off by default: useful when tuning the weights, noise the rest of the time.
  const [showBreakdown, setShowBreakdown] = useState(false);

  const router = useRouter();
  const [sortKey, setSortKey] = useState<WorldSortKey>('relevance');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const {
    seeds,
    mode,
    results,
    genreTagNames,
    derivedTagNames,
    colorState,
    colorProgress,
    palette,
    setPalette,
    includeLibraryWorlds,
    hiddenLibraryCount,
    setIncludeLibraryWorlds,
    hideWorld,
    isLoading,
    errorMessage,
    setMode,
    refresh,
    updateWorld,
  } = useRelatedWorldsStore();

  const sortedResults = useMemo(
    () =>
      sortWorldItems(results, (entry) => entry.world, sortKey, sortDirection),
    [results, sortKey, sortDirection],
  );

  const worlds = useMemo(
    () => sortedResults.map((entry) => entry.world),
    [sortedResults],
  );

  /** Why each world showed up: shared tags, or the same creator. */
  const reasonBadges = useMemo(() => {
    const badges: Record<string, string> = {};
    for (const entry of results) {
      const parts: string[] = [];
      if (showBreakdown) {
        // Raw contributions, so it is obvious which signal is doing the work.
        const scores: string[] = [
          `${t('related-page:breakdown-total')} ${entry.score.toFixed(2)}`,
        ];
        if (entry.tagScore > 0) scores.push(`tag ${entry.tagScore.toFixed(2)}`);
        if (entry.sameAuthor) scores.push(t('related-page:breakdown-author'));
        if (entry.sameFolder) scores.push(t('related-page:breakdown-folder'));
        if (entry.sameGenre) scores.push(t('related-page:breakdown-genre'));
        if (entry.textScore > 0)
          scores.push(
            `${t('related-page:breakdown-text')} ${entry.textScore.toFixed(2)}`,
          );
        if (entry.colorScore > 0)
          scores.push(
            `${t('related-page:breakdown-color')} ${entry.colorScore.toFixed(2)}`,
          );
        badges[entry.world.worldId] = scores.join(' / ');
        continue;
      }

      if (entry.sameAuthor) parts.push(t('related-page:same-author'));
      if (entry.sameFolder) parts.push(t('related-page:same-folder'));
      if (entry.sameGenre) parts.push(t('related-page:same-genre'));
      if (entry.matchedTags.length > 0) {
        const shown = entry.matchedTags.slice(0, 2).join(', ');
        const rest = entry.matchedTags.length - 2;
        parts.push(rest > 0 ? `${shown} +${rest}` : shown);
      }
      if (parts.length > 0) badges[entry.world.worldId] = parts.join(' / ');
    }
    return badges;
  }, [results, t, showBreakdown]);

  const modes: { value: RelatedMode; label: string }[] = [
    { value: 'any', label: t('related-page:mode-any') },
    { value: 'all', label: t('related-page:mode-all') },
  ];

  const hasSeeds = seeds.length > 0;

  /**
   * Hands the tags this page worked out over to the search page, so the user
   * can narrow them further with their own keywords and filters.
   */
  const searchWithTheseTags = () => {
    const tags = Array.from(
      new Set([...seeds.flatMap((seed) => seed.tags), ...derivedTagNames]),
    ).slice(0, 5);

    if (tags.length === 0) return;
    router.push(
      `/listview/folders/special/find?tags=${encodeURIComponent(
        tags.join(','),
      )}&autoSearch=true`,
    );
  };

  // A snapshot replaces what is on screen until the user searches again.
  const [snapshot, setSnapshot] = useState<SearchSnapshot | null>(null);

  const handleExport = async () => {
    try {
      const saved = await saveSnapshot(
        buildSnapshot(
          'related',
          seeds.map((seed) => seed.name).join(', '),
          {
            seeds: seeds.map((seed) => ({
              worldId: seed.worldId,
              name: seed.name,
            })),
            mode,
            genreTagNames,
            derivedTagNames,
          },
          worlds,
        ),
      );
      if (saved) toast(t('snapshot:saved'));
    } catch (e) {
      toast(t('general:error-title'), { description: String(e) });
    }
  };

  const handleImport = async () => {
    try {
      const loaded = await loadSnapshot();
      if (loaded) {
        setSnapshot(loaded);
        toast(t('snapshot:loaded'));
      }
    } catch (e) {
      toast(t('general:error-title'), { description: String(e) });
    }
  };

  const displayedWorlds: WorldDisplayData[] = snapshot
    ? snapshot.worlds
    : worlds;

  const canSearchWithTags =
    seeds.some((seed) => seed.tags.length > 0) || derivedTagNames.length > 0;

  return (
    <div className="p-1 flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between p-4 bg-background">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-xl font-bold">{t('general:related-worlds')}</h1>
          {hasSeeds && (
            <span className="text-xs text-muted-foreground truncate">
              {t('related-page:result-count', results.length.toString())}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            title={t('snapshot:export')}
            onClick={handleExport}
            disabled={worlds.length === 0}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            title={t('snapshot:import')}
            onClick={handleImport}
          >
            <Upload className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={searchWithTheseTags}
            disabled={!canSearchWithTags}
            className="flex items-center gap-2"
          >
            <Search className="h-4 w-4" />
            <span>{t('related-page:search-with-tags')}</span>
          </Button>
          <ColorPaletteSelect value={palette} onChange={setPalette} />
          <WorldSortSelect
            sortKey={sortKey}
            direction={sortDirection}
            onSortKeyChange={setSortKey}
            onDirectionChange={setSortDirection}
            relevanceLabel={t('world-sort:relevance')}
          />
          <Button
            variant="outline"
            onClick={refresh}
            disabled={isLoading || !hasSeeds}
            className="flex items-center gap-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            />
            <span>{t('general:fetch-refresh')}</span>
          </Button>
        </div>
      </div>

      {hasSeeds && (
        <div className="px-4 pb-2 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground shrink-0">
              {t('related-page:based-on')}
            </span>
            {seeds.map((seed) => (
              <Badge
                key={seed.worldId}
                variant="secondary"
                className="cursor-default max-w-[260px] truncate"
                title={`${seed.name} / ${seed.authorName}`}
              >
                {seed.name}
              </Badge>
            ))}
          </div>

          {genreTagNames.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground shrink-0">
                {t('related-page:genre-tags')}
              </span>
              {genreTagNames.map((name) => (
                <Badge key={name} variant="outline" className="cursor-default">
                  {name}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="include-library-worlds"
              checked={includeLibraryWorlds}
              onCheckedChange={(checked) =>
                setIncludeLibraryWorlds(checked === true)
              }
            />
            <label
              htmlFor="include-library-worlds"
              className="text-xs text-muted-foreground cursor-pointer"
            >
              {t('related-page:include-library')}
            </label>
            <Checkbox
              id="show-score-breakdown"
              checked={showBreakdown}
              onCheckedChange={(checked) => setShowBreakdown(checked === true)}
            />
            <label
              htmlFor="show-score-breakdown"
              className="text-xs text-muted-foreground cursor-pointer"
            >
              {t('related-page:show-breakdown')}
            </label>
            <ColorSignalStatus
              colorState={colorState}
              colorProgress={colorProgress}
              palette={palette}
            />
            {!includeLibraryWorlds && hiddenLibraryCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {t(
                  'related-page:hidden-library-count',
                  hiddenLibraryCount.toString(),
                )}
              </span>
            )}
          </div>

          {seeds.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">
                {t('related-page:mode-label')}
              </span>
              {modes.map((entry) => (
                <Button
                  key={entry.value}
                  size="sm"
                  variant={mode === entry.value ? 'default' : 'outline'}
                  onClick={() => setMode(entry.value)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {snapshot && (
        <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">
            {t(
              'snapshot:viewing',
              new Date(snapshot.savedAt).toLocaleString(),
              snapshot.label,
            )}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setSnapshot(null)}
          >
            {t('snapshot:close')}
          </Button>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden p-4 pt-2">
        {snapshot ? (
          <WorldGrid
            worlds={displayedWorlds}
            currentFolder={SpecialFolders.Related}
            containerRef={gridRef}
          />
        ) : !hasSeeds ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
            <Share2 className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-lg font-medium">
              {t('related-page:no-seed-title')}
            </p>
            <p className="text-sm mt-2">
              {t('related-page:no-seed-description')}
            </p>
          </div>
        ) : errorMessage ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
            <p className="text-lg font-medium">{t('related-page:error')}</p>
            <p className="text-sm mt-2 max-w-xl break-words">{errorMessage}</p>
          </div>
        ) : isLoading && worlds.length === 0 ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('related-page:searching')}</span>
            </div>
            <WorldGridSkeleton />
          </div>
        ) : worlds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
            <p className="text-lg font-medium">{t('related-page:empty')}</p>
            <p className="text-sm mt-2">
              {hiddenLibraryCount > 0
                ? t(
                    'related-page:empty-all-in-library',
                    hiddenLibraryCount.toString(),
                  )
                : t('related-page:empty-description')}
            </p>
          </div>
        ) : (
          <WorldGrid
            worlds={worlds}
            currentFolder={SpecialFolders.Related}
            containerRef={gridRef}
            extraBadges={reasonBadges}
            onWorldUpdate={updateWorld}
            onHideWorld={hideWorld}
          />
        )}
      </div>
    </div>
  );
}
