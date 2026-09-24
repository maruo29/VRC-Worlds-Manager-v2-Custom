'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Check, ChevronRight, Loader2, SkipForward, X } from 'lucide-react';
import { useLocalization } from '@/hooks/use-localization';
import {
  ADVANCE_SHORTCUT,
  AUTO_ADVANCE_OPTIONS,
  useWorldTourStore,
} from '@/app/listview/hook/use-world-tour';

/**
 * The tour's progress, floating above whatever page is open.
 *
 * Deliberately always visible while a tour runs: it is the only thing driving
 * VRChat around, so it should be obvious that it is doing so and be one click
 * from stopping.
 */
export function WorldTourProgress() {
  const { t } = useLocalization();
  const {
    status,
    entries,
    currentIndex,
    autoAdvance,
    advanceAt,
    advance,
    setAutoAdvance,
    stop,
    reset,
  } = useWorldTourStore();

  // Only to redraw the countdown; the deadline itself lives in the store.
  const [, tick] = useState(0);
  useEffect(() => {
    if (advanceAt === null) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [advanceAt]);

  if (entries.length === 0) return null;

  const done = entries.filter((entry) => entry.state === 'done').length;
  const failed = entries.filter((entry) => entry.state === 'failed').length;
  const isRunning = status !== 'idle';
  const isWaiting = status === 'waiting';
  const current = currentIndex >= 0 ? entries[currentIndex] : null;

  const secondsLeft =
    advanceAt === null
      ? null
      : Math.max(0, Math.ceil((advanceAt - Date.now()) / 1000));

  return (
    <Card className="fixed bottom-4 right-4 z-50 w-80 p-3 shadow-lg flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {t(
            'world-tour:progress',
            (currentIndex >= 0 ? currentIndex + 1 : entries.length).toString(),
            entries.length.toString(),
          )}
        </span>

        {isRunning ? (
          <Button
            variant="outline"
            size="sm"
            onClick={stop}
            disabled={status === 'stopping'}
            className="h-7 flex items-center gap-1"
          >
            <X className="h-3 w-3" />
            <span className="text-xs">
              {status === 'stopping'
                ? t('world-tour:stopping')
                : t('world-tour:stop')}
            </span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            className="h-7 text-xs"
          >
            {t('world-tour:close')}
          </Button>
        )}
      </div>

      {current && isRunning && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isWaiting ? (
            <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          )}
          <span className="truncate">{current.name}</span>
        </div>
      )}

      {isWaiting && (
        <>
          <Button
            size="sm"
            onClick={advance}
            className="h-8 w-full flex items-center gap-1"
          >
            <ChevronRight className="h-4 w-4" />
            <span className="text-xs">
              {secondsLeft === null
                ? t('world-tour:next')
                : t('world-tour:next-in', secondsLeft.toString())}
            </span>
          </Button>
          <p className="text-[10px] text-muted-foreground">
            {t(
              'world-tour:next-shortcut',
              ADVANCE_SHORTCUT.replace('CommandOrControl', 'Ctrl'),
            )}
          </p>
        </>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Check className="h-3 w-3" />
            {done}
          </span>
          {failed > 0 && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <SkipForward className="h-3 w-3" />
              {t('world-tour:failed-count', failed.toString())}
            </span>
          )}
        </div>

        {isRunning && (
          <Select value={autoAdvance} onValueChange={setAutoAdvance}>
            <SelectTrigger className="h-7 w-[132px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTO_ADVANCE_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {t(`world-tour:auto-${option.id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!isRunning && (
        <p className="text-xs text-muted-foreground">
          {t('world-tour:finished')}
        </p>
      )}
    </Card>
  );
}
