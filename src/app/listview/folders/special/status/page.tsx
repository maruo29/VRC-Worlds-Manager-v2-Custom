'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalization } from '@/hooks/use-localization';
import { Button } from '@/components/ui/button';
import { Camera, Share2, Star, RefreshCw } from 'lucide-react';
import { SpecialFolders } from '@/types/folders';
import { WorldGrid } from '../../../components/world-grid';
import { WorldGridSkeleton } from '../../../components/world-grid/skeleton';
import { useWorlds } from '../../../hook/use-worlds';
import { usePopupStore } from '../../../hook/usePopups/store';
import type { WorldDisplayData } from '@/lib/bindings';
import {
  WorldSortSelect,
  sortWorldItems,
  type SortDirection,
  type WorldSortKey,
} from '@/components/world-sort-select';

type StatusFlag = 'isFavorite' | 'isPhotographed' | 'isShared';

/**
 * Built-in view over the three per-world marks. The point is that each mark is
 * one button away from being shown or hidden, rather than a sort option buried
 * in a menu.
 */
export default function StatusWorldsPage() {
  const { t } = useLocalization();
  const gridRef = useRef<HTMLDivElement>(null);
  const { worlds, isLoading, refresh } = useWorlds(SpecialFolders.Status);

  // Toggling a mark on a card changes what belongs here, so re-read the list.
  // useWorlds already loads on mount, so only react to later changes.
  const membershipVersion = usePopupStore((s) => s.membershipVersion);
  const lastSeenMembership = useRef(membershipVersion);
  useEffect(() => {
    if (lastSeenMembership.current === membershipVersion) return;
    lastSeenMembership.current = membershipVersion;
    refresh();
  }, [membershipVersion]);

  const [sortKey, setSortKey] = useState<WorldSortKey>('relevance');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const [activeFlags, setActiveFlags] = useState<Record<StatusFlag, boolean>>({
    isFavorite: true,
    isPhotographed: true,
    isShared: true,
  });

  const toggleFlag = (flag: StatusFlag) =>
    setActiveFlags((flags) => ({ ...flags, [flag]: !flags[flag] }));

  const filters: {
    flag: StatusFlag;
    label: string;
    icon: typeof Star;
    activeClass: string;
  }[] = [
    {
      flag: 'isFavorite',
      label: t('world-card:favorite'),
      icon: Star,
      activeClass: 'bg-yellow-500/80 text-white hover:bg-yellow-600/90',
    },
    {
      flag: 'isPhotographed',
      label: t('world-card:photographed'),
      icon: Camera,
      activeClass: 'bg-green-500/80 text-white hover:bg-green-600/90',
    },
    {
      flag: 'isShared',
      label: t('world-card:shared'),
      icon: Share2,
      activeClass: 'bg-blue-500/80 text-white hover:bg-blue-600/90',
    },
  ];

  const counts = useMemo(() => {
    const result: Record<StatusFlag, number> = {
      isFavorite: 0,
      isPhotographed: 0,
      isShared: 0,
    };
    for (const world of worlds) {
      if (world.isFavorite) result.isFavorite += 1;
      if (world.isPhotographed) result.isPhotographed += 1;
      if (world.isShared) result.isShared += 1;
    }
    return result;
  }, [worlds]);

  const visibleWorlds: WorldDisplayData[] = useMemo(() => {
    const filtered = worlds.filter((world) =>
      filters.some(({ flag }) => activeFlags[flag] && world[flag]),
    );
    return sortWorldItems(filtered, (world) => world, sortKey, sortDirection);
  }, [worlds, activeFlags, sortKey, sortDirection]);

  const noneActive = filters.every(({ flag }) => !activeFlags[flag]);

  return (
    <div className="p-1 flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between p-4 bg-background">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-xl font-bold">{t('general:status-worlds')}</h1>
          <span className="text-xs text-muted-foreground">
            {t(
              'status-page:shown-count',
              visibleWorlds.length.toString(),
              worlds.length.toString(),
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <WorldSortSelect
            sortKey={sortKey}
            direction={sortDirection}
            onSortKeyChange={setSortKey}
            onDirectionChange={setSortDirection}
            relevanceLabel={t('world-sort:default')}
          />
          <Button
            variant="outline"
            onClick={refresh}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            />
            <span>{t('general:fetch-refresh')}</span>
          </Button>
        </div>
      </div>

      <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
        {filters.map(({ flag, label, icon: Icon, activeClass }) => (
          <Button
            key={flag}
            size="sm"
            variant={activeFlags[flag] ? 'default' : 'outline'}
            onClick={() => toggleFlag(flag)}
            aria-pressed={activeFlags[flag]}
            className={`flex items-center gap-2 ${
              activeFlags[flag] ? activeClass : 'text-muted-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            <span className="font-mono text-xs opacity-80">{counts[flag]}</span>
          </Button>
        ))}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden p-4 pt-2">
        {isLoading && worlds.length === 0 ? (
          <WorldGridSkeleton />
        ) : visibleWorlds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
            <Star className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-lg font-medium">
              {noneActive
                ? t('status-page:no-filter-title')
                : t('status-page:empty-title')}
            </p>
            <p className="text-sm mt-2">
              {noneActive
                ? t('status-page:no-filter-description')
                : t('status-page:empty-description')}
            </p>
          </div>
        ) : (
          <WorldGrid
            worlds={visibleWorlds}
            currentFolder={SpecialFolders.Status}
            containerRef={gridRef}
          />
        )}
      </div>
    </div>
  );
}
