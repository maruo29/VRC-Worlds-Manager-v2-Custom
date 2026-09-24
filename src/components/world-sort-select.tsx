'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { useLocalization } from '@/hooks/use-localization';
import type { WorldDisplayData } from '@/lib/bindings';

/**
 * `relevance` is whatever order the page produced (recommendation score,
 * relatedness, and so on) and is therefore always the default.
 */
export type WorldSortKey =
  | 'relevance'
  | 'name'
  | 'visits'
  | 'favorites'
  | 'updated'
  | 'dateAdded';

export type SortDirection = 'asc' | 'desc';

/** Sorts any list of items that can point at a world. */
export function sortWorldItems<T>(
  items: T[],
  getWorld: (item: T) => WorldDisplayData,
  key: WorldSortKey,
  direction: SortDirection,
): T[] {
  if (key === 'relevance') return items;

  const factor = direction === 'asc' ? 1 : -1;

  return items.slice().sort((a, b) => {
    const left = getWorld(a);
    const right = getWorld(b);

    switch (key) {
      case 'name':
        return left.name.localeCompare(right.name) * factor;
      case 'visits':
        return (left.visits - right.visits) * factor;
      case 'favorites':
        return (left.favorites - right.favorites) * factor;
      case 'updated': {
        const l = Date.parse(left.lastUpdated) || 0;
        const r = Date.parse(right.lastUpdated) || 0;
        return (l - r) * factor;
      }
      case 'dateAdded': {
        // Worlds that are not in the library have no date; keep them last
        // whichever way round the sort is pointing.
        const l = Date.parse(left.dateAdded);
        const r = Date.parse(right.dateAdded);
        if (Number.isNaN(l) && Number.isNaN(r)) return 0;
        if (Number.isNaN(l)) return 1;
        if (Number.isNaN(r)) return -1;
        return (l - r) * factor;
      }
      default:
        return 0;
    }
  });
}

interface WorldSortSelectProps {
  sortKey: WorldSortKey;
  direction: SortDirection;
  onSortKeyChange: (key: WorldSortKey) => void;
  onDirectionChange: (direction: SortDirection) => void;
  /** Wording for the page's own ordering, e.g. "relevance" or "recommended". */
  relevanceLabel: string;
}

export function WorldSortSelect({
  sortKey,
  direction,
  onSortKeyChange,
  onDirectionChange,
  relevanceLabel,
}: WorldSortSelectProps) {
  const { t } = useLocalization();

  const options: { value: WorldSortKey; label: string }[] = [
    { value: 'relevance', label: relevanceLabel },
    { value: 'name', label: t('world-sort:name') },
    { value: 'visits', label: t('world-sort:visits') },
    { value: 'favorites', label: t('world-sort:favorites') },
    { value: 'updated', label: t('world-sort:updated') },
    { value: 'dateAdded', label: t('world-sort:date-added') },
  ];

  return (
    <div className="flex items-center gap-1">
      <Select
        value={sortKey}
        onValueChange={(value) => onSortKeyChange(value as WorldSortKey)}
      >
        <SelectTrigger className="h-9 w-[170px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        disabled={sortKey === 'relevance'}
        aria-label={t('world-sort:toggle-direction')}
        title={t('world-sort:toggle-direction')}
        onClick={() => onDirectionChange(direction === 'desc' ? 'asc' : 'desc')}
      >
        {direction === 'desc' ? (
          <ArrowDownWideNarrow className="h-4 w-4" />
        ) : (
          <ArrowUpNarrowWide className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
