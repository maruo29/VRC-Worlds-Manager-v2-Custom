'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, Eye, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { error } from '@tauri-apps/plugin-log';
import { commands, type WorldShot } from '@/lib/bindings';
import { useLocalization } from '@/hooks/use-localization';
import {
  CAPTURE_SHORTCUT,
  useWorldShotsStore,
} from '@/app/listview/hook/use-world-shots';

interface WorldShotsPanelProps {
  worldId: string;
}

/**
 * "Go and look at this world", plus whatever has been captured so far.
 *
 * The thumbnail is the author's pick of the world; these are what it looks
 * like on arrival. Opening the world is one click, and once VRChat reports
 * the world as loaded the shot is taken without further input.
 */
export function WorldShotsPanel({ worldId }: WorldShotsPanelProps) {
  const { t } = useLocalization();
  const {
    armedWorldId,
    capturingWorldId,
    shotsByWorld,
    armFor,
    captureNow,
    loadShots,
    deleteShot,
    startWatching,
  } = useWorldShotsStore();

  const [isOpening, setIsOpening] = useState(false);
  /** Data URLs, loaded only for the shots actually on screen. */
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const shots = shotsByWorld[worldId] ?? [];
  const isArmed = armedWorldId === worldId;
  const isCapturing = capturingWorldId === worldId;

  useEffect(() => {
    loadShots(worldId);
    // Opening a world's details is enough intent to arm the capture key, so
    // it works while VRChat is in front and this window is behind it.
    startWatching();
  }, [worldId, loadShots, startWatching]);

  // Images are read one at a time as they appear, rather than all of a
  // world's history at once.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      for (const shot of shots) {
        if (previews[shot.fileName]) continue;
        const result = await commands.readWorldShot(worldId, shot.fileName);
        if (cancelled || result.status !== 'ok') continue;
        setPreviews((current) => ({
          ...current,
          [shot.fileName]: result.data,
        }));
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, shots.map((shot) => shot.fileName).join(',')]);

  const handleGoAndLook = async () => {
    setIsOpening(true);
    try {
      const region = await commands.getRegion();
      if (region.status !== 'ok') throw new Error(region.error);

      // Invite+ so nobody else is dropped into the shot, and the instance
      // list stays clean. No self-invite: without it the launch URL opens the
      // instance's own page with its Enter button, instead of a notification
      // that has to be found and accepted.
      const created = await commands.createVisitInstance(
        worldId,
        'invite+',
        region.data,
      );
      if (created.status !== 'ok') throw new Error(created.error);

      // Armed before opening, so the log watcher is already listening by the
      // time the world finishes loading.
      await armFor(worldId);

      const opened = await commands.openInstanceInClient(
        created.data.world_id,
        created.data.instance_id,
      );
      if (opened.status !== 'ok') throw new Error(opened.error);

      toast(t('world-shots:opening-title'), {
        description: t('world-shots:opening-description'),
      });
    } catch (e) {
      error(`[shots] could not open the world: ${e}`);
      toast(t('general:error-title'), { description: String(e) });
    } finally {
      setIsOpening(false);
    }
  };

  const handleCaptureNow = async () => {
    const shot = await captureNow(worldId);
    if (!shot) {
      toast(t('general:error-title'), {
        description: t('world-shots:capture-failed'),
      });
      return;
    }
    if (shot.looksBlank) {
      toast(t('world-shots:captured-title'), {
        description: t('world-shots:looks-blank'),
      });
    }
  };

  const formatSize = (bytes: number) => `${Math.round(bytes / 1024)} KB`;
  const formatTaken = (shot: WorldShot) =>
    new Date(shot.takenAt).toLocaleString();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          onClick={handleGoAndLook}
          disabled={isOpening || isArmed}
          className="flex items-center gap-2"
        >
          {isOpening || isArmed ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          <span>
            {isArmed ? t('world-shots:waiting') : t('world-shots:go-and-look')}
          </span>
        </Button>

        <Button
          variant="outline"
          onClick={handleCaptureNow}
          disabled={isCapturing}
          className="flex items-center gap-2"
          title={t('world-shots:capture-now-hint')}
        >
          {isCapturing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          <span>{t('world-shots:capture-now')}</span>
        </Button>
      </div>

      {isArmed && (
        <p className="text-xs text-muted-foreground">
          {t('world-shots:waiting-hint')}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {t(
          'world-shots:shortcut-hint',
          CAPTURE_SHORTCUT.replace('CommandOrControl', 'Ctrl'),
        )}
      </p>

      {shots.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('world-shots:empty')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {shots.map((shot) => (
            <div key={shot.fileName} className="group relative">
              {previews[shot.fileName] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previews[shot.fileName]}
                  alt={formatTaken(shot)}
                  className="w-full rounded-md border"
                />
              ) : (
                <div className="w-full aspect-video rounded-md border bg-muted animate-pulse" />
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[10px] text-muted-foreground truncate">
                  {formatTaken(shot)} · {formatSize(shot.bytes)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => deleteShot(worldId, shot.fileName)}
                  title={t('world-shots:delete')}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
