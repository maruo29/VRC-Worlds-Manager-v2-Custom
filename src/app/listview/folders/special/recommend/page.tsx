'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalization } from '@/hooks/use-localization';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import MultiFilterItemSelector from '@/components/multi-filter-item-selector';
import { SpecialFolders } from '@/types/folders';
import { WorldGrid } from '../../../components/world-grid';
import { WorldGridSkeleton } from '../../../components/world-grid/skeleton';
import {
  NEW_WINDOW_OPTIONS,
  OFFICIAL_TABS,
  PERSONAL_TABS,
  isOfficialTab,
  useRecommendationsStore,
} from '../../../hook/use-recommendations';
import { publicationAgeDays } from '@/lib/recommend';
import { ColorPaletteSelect } from '@/components/color-palette-select';
import { ColorSignalStatus } from '@/components/color-signal-status';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  WorldSortSelect,
  sortWorldItems,
  type SortDirection,
  type WorldSortKey,
} from '@/components/world-sort-select';

/** Tags shown as the "your taste" summary. */
const PROFILE_TAG_PREVIEW = 12;

/** Suggestions offered in the manual tag picker, beyond what the profile knows. */
const TAG_SUGGESTION_LIMIT = 60;

/** Results are revealed a page at a time rather than all at once. */
const PAGE_SIZE = 24;

export default function RecommendPage() {
  const { t } = useLocalization();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const gridRef = useRef<HTMLDivElement>(null);
  const [sortKey, setSortKey] = useState<WorldSortKey>('relevance');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const {
    tab,
    setTab,
    newWindow,
    setNewWindow,
    outOfWindowCount,
    profile,
    results,
    manualTags,
    excludedTags,
    isLoading,
    isRefreshing,
    lastFetchedAt,
    errorMessage,
    initialize,
    refresh,
    setManualTags,
    setExcludedTags,
    hideWorld,
    updateWorld,
    colorState,
    colorAnchorCount,
    colorProgress,
    palette,
    setPalette,
  } = useRecommendationsStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  // A new fetch, a different tab, or a narrower window starts the reveal over.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [lastFetchedAt, tab, newWindow]);

  // Sorted before slicing, not after: sorting the 24 cards already on screen
  // only shuffles those, so "most visited" would never reach up into the rest
  // of the list and the control would look like it did nothing.
  const sortedResults = useMemo(
    () =>
      sortWorldItems(results, (entry) => entry.world, sortKey, sortDirection),
    [results, sortKey, sortDirection],
  );

  const scored = useMemo(
    () => sortedResults.slice(0, visibleCount),
    [sortedResults, visibleCount],
  );

  const worlds = useMemo(() => scored.map((entry) => entry.world), [scored]);

  /** "chill, night +2" style caption explaining each suggestion. */
  const reasonBadges = useMemo(() => {
    const badges: Record<string, string> = {};

    for (const entry of scored) {
      const parts: string[] = [];

      // Wherever the tab is about newness the age is the whole point, so it
      // leads - and on the personal tab it also lets the window filter be
      // checked at a glance.
      if (tab === 'new' || tab === 'official-new') {
        const age = publicationAgeDays(entry.world);
        if (age === null) {
          parts.push(t('recommend-page:published-unknown'));
        } else if (age < 1) {
          parts.push(t('recommend-page:published-today'));
        } else {
          parts.push(
            t('recommend-page:published-days-ago', Math.floor(age).toString()),
          );
        }
      }

      if (entry.matchedTags.length > 0) {
        const shown = entry.matchedTags.slice(0, 2).join(', ');
        const rest = entry.matchedTags.length - 2;
        parts.push(
          rest > 0 ? t('recommend-page:reason-more', shown, rest) : shown,
        );
      }

      if (parts.length > 0) badges[entry.world.worldId] = parts.join(' · ');
    }

    return badges;
  }, [scored, tab, t]);

  const tagSuggestions = useMemo(
    () =>
      (profile?.tags ?? [])
        .slice(0, TAG_SUGGESTION_LIMIT)
        .map((entry) => ({ value: entry.tag, label: entry.tag })),
    [profile],
  );

  const isBusy = isLoading || isRefreshing;
  const hasResults = worlds.length > 0;

  const lastFetchedLabel = lastFetchedAt
    ? new Date(lastFetchedAt).toLocaleString()
    : null;

  return (
    <div className="p-1 flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between p-4 bg-background">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-xl font-bold">{t('general:recommend-worlds')}</h1>

          {/* Two groups, labelled, because they answer different questions:
              one is built from this library, the other is what VRChat shows
              everybody. Mixing them in one strip hid that difference. */}
          {[
            { label: t('recommend-page:group-yours'), tabs: PERSONAL_TABS },
            { label: t('recommend-page:group-official'), tabs: OFFICIAL_TABS },
          ].map((group) => (
            <div
              key={group.label}
              className="flex items-center gap-1.5 shrink-0"
            >
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {group.label}
              </span>
              <div className="flex items-center gap-0.5 rounded-md border p-0.5">
                {group.tabs.map((id) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={tab === id ? 'default' : 'ghost'}
                    className="h-7 px-3"
                    title={t(`recommend-page:tab-${id}-hint`)}
                    onClick={() => setTab(id)}
                  >
                    {t(`recommend-page:tab-${id}`)}
                  </Button>
                ))}
              </div>
            </div>
          ))}

          {lastFetchedLabel && (
            <span className="text-xs text-muted-foreground truncate">
              {t('recommend-page:last-updated', lastFetchedLabel)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* An official listing is shown in VRChat's order; a colour
              preference would quietly turn it into something else. */}
          {!isOfficialTab(tab) && (
            <ColorPaletteSelect value={palette} onChange={setPalette} />
          )}
          {tab === 'new' && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground shrink-0">
                {t('recommend-page:window-label')}
              </span>
              <Select value={newWindow} onValueChange={setNewWindow}>
                <SelectTrigger className="h-9 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NEW_WINDOW_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {t(`recommend-page:window-${option.id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <WorldSortSelect
            sortKey={sortKey}
            direction={sortDirection}
            onSortKeyChange={setSortKey}
            onDirectionChange={setSortDirection}
            relevanceLabel={t('world-sort:recommended')}
          />
          <Button
            variant={isSettingsOpen ? 'secondary' : 'outline'}
            onClick={() => setIsSettingsOpen((open) => !open)}
            className="flex items-center gap-2"
          >
            <Settings2 className="h-4 w-4" />
            <span>{t('recommend-page:settings')}</span>
          </Button>
          <Button
            variant="outline"
            onClick={refresh}
            disabled={isBusy}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isBusy ? 'animate-spin' : ''}`} />
            <span>{t('general:fetch-refresh')}</span>
          </Button>
        </div>
      </div>

      {isSettingsOpen && (
        <div className="px-4 pb-2">
          <Card>
            <CardContent className="pt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="RecommendTag">
                  {t('recommend-page:manual-tags')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('recommend-page:manual-tags-description')}
                </p>
                <MultiFilterItemSelector
                  placeholder={t('recommend-page:manual-tags-placeholder')}
                  candidates={tagSuggestions}
                  values={manualTags}
                  onValuesChange={(tags: string[]) => setManualTags(tags)}
                  allowCustomValues={true}
                  maxItems={10}
                  id="RecommendTag"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="RecommendExcludeTag">
                  {t('recommend-page:excluded-tags')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('recommend-page:excluded-tags-description')}
                </p>
                <MultiFilterItemSelector
                  placeholder={t('recommend-page:excluded-tags-placeholder')}
                  candidates={tagSuggestions}
                  values={excludedTags}
                  onValuesChange={(tags: string[]) => setExcludedTags(tags)}
                  allowCustomValues={true}
                  maxItems={10}
                  id="RecommendExcludeTag"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                {t('recommend-page:settings-apply-hint')}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {(colorState !== 'off' || palette.length > 0) && (
        <div className="px-4 pb-2">
          <ColorSignalStatus
            colorState={colorState}
            colorProgress={colorProgress}
            palette={palette}
            anchorCount={colorAnchorCount}
          />
        </div>
      )}

      {profile && profile.tags.length > 0 && (
        <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">
            {t('recommend-page:your-taste')}
          </span>
          {profile.tags.slice(0, PROFILE_TAG_PREVIEW).map((entry) => (
            <Badge
              key={entry.tag}
              variant={entry.isManual ? 'default' : 'secondary'}
              className="cursor-default"
            >
              {entry.tag}
              {entry.worldCount > 0 && (
                <span className="ml-1 opacity-60">{entry.worldCount}</span>
              )}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden p-4 pt-2">
        {errorMessage ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
            <p className="text-lg font-medium">
              {t('recommend-page:error-title')}
            </p>
            <p className="text-sm mt-2 max-w-xl break-words">{errorMessage}</p>
            <Button variant="outline" onClick={refresh} className="mt-4">
              {t('general:fetch-refresh')}
            </Button>
          </div>
        ) : isBusy && !hasResults ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('recommend-page:building')}</span>
            </div>
            <WorldGridSkeleton />
          </div>
        ) : !hasResults ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
            <Sparkles className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-lg font-medium">
              {t('recommend-page:empty-title')}
            </p>
            <p className="text-sm mt-2 max-w-md">
              {tab === 'new' && outOfWindowCount > 0
                ? t('recommend-page:empty-new-window')
                : t('recommend-page:empty-description')}
            </p>
          </div>
        ) : (
          <>
            <WorldGrid
              worlds={worlds}
              currentFolder={SpecialFolders.Recommend}
              containerRef={gridRef}
              extraBadges={reasonBadges}
              onHideWorld={hideWorld}
              onWorldUpdate={updateWorld}
            />
            <div className="shrink-0 flex items-center justify-center gap-3 pt-3">
              <span className="text-xs text-muted-foreground">
                {t(
                  'recommend-page:shown-count',
                  worlds.length.toString(),
                  results.length.toString(),
                )}
                {tab === 'new' && outOfWindowCount > 0 && (
                  <span className="ml-2">
                    {t(
                      'recommend-page:out-of-window',
                      outOfWindowCount.toString(),
                    )}
                  </span>
                )}
              </span>
              {visibleCount < results.length && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                >
                  {t('recommend-page:show-more')}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
