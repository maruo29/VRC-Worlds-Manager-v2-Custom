'use client';

import { useLocalization } from '@/hooks/use-localization';
import type { ColorPaletteId } from '@/lib/color-palette';

export type ColorSignalState = 'off' | 'ready' | 'missing';

interface ColorSignalStatusProps {
  colorState: ColorSignalState;
  colorProgress: { done: number; total: number } | null;
  palette: ColorPaletteId[];
  /**
   * How many library thumbnails the taste profile compares against. Only
   * the recommendations page has one; where it is absent, a ready signal
   * says nothing.
   */
  anchorCount?: number;
}

/**
 * One line saying what the colour signal is doing right now, shared by the
 * discovery pages so they describe the same states in the same words.
 * Renders nothing when there is nothing worth saying.
 */
export function ColorSignalStatus({
  colorState,
  colorProgress,
  palette,
  anchorCount,
}: ColorSignalStatusProps) {
  const { t } = useLocalization();

  if (colorProgress) {
    return (
      <span className="text-xs text-muted-foreground">
        {t(
          'color-signal:analyzing',
          colorProgress.done.toString(),
          colorProgress.total.toString(),
        )}
      </span>
    );
  }

  if (palette.length > 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {t(
          'color-palette:active',
          palette.map((id) => t(`color-palette:${id}`)).join(' + '),
        )}
      </span>
    );
  }

  if (colorState === 'ready' && anchorCount !== undefined) {
    return (
      <span className="text-xs text-muted-foreground">
        {t('color-signal:taste-ready', anchorCount.toString())}
      </span>
    );
  }

  if (colorState === 'missing') {
    return (
      <span className="text-xs text-amber-600 dark:text-amber-400">
        {t('color-signal:not-analyzed')}
      </span>
    );
  }

  return null;
}
