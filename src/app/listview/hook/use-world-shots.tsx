'use client';

import { create } from 'zustand';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  register as registerShortcut,
  unregister as unregisterShortcut,
  isRegistered,
} from '@tauri-apps/plugin-global-shortcut';
import { commands, type WorldShot } from '@/lib/bindings';
import { error, info } from '@tauri-apps/plugin-log';

/**
 * Screenshots taken inside a world.
 *
 * A thumbnail is the author's pick; standing in the place is a different
 * thing. The app can go and look: it opens the world in VRChat, watches
 * VRChat's own log for the moment the world finishes loading, and takes a
 * shot then.
 */

/** What VRChat's log watcher sends when a world has finished loading. */
interface WorldEnteredEvent {
  worldId: string;
  worldName: string;
}

/**
 * When to shoot, measured from the world being ready.
 *
 * The first is deliberately early: by the time the world is up, this is what
 * the place looks like from the spawn point. The later ones are only reached
 * when the earlier shot came back essentially black - an unlit intro, a fade,
 * or a gimmick world that stays dark until something is touched. Measured
 * against a real dark world, three shots ten seconds apart were all equally
 * black, so retrying is spaced much wider than that.
 */
const RETRY_DELAYS_MS = [3_000, 18_000, 45_000];

/**
 * How long to keep expecting a world after asking VRChat to open it.
 *
 * Generous because it covers a cold start: measured at 46 seconds to reach
 * the room plus 20 to load, and a first-time download is slower still.
 */
const ARM_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The capture key. Global, because the whole point is to press it while
 * VRChat has focus rather than this app. Chosen to stay clear of VRChat's own
 * bindings, which are single keys and plain modifiers.
 */
export const CAPTURE_SHORTCUT = 'CommandOrControl+Shift+S';

interface WorldShotsState {
  /** True once VRChat's log is being tailed. */
  isWatching: boolean;
  /** The world the user asked to go and look at, if any. */
  armedWorldId: string | null;
  /**
   * The world VRChat is in right now, from its log. This is what the capture
   * key shoots, since the key is pressed with VRChat in front, not the app.
   */
  currentWorldId: string | null;
  currentWorldName: string | null;
  /** Set while a capture is being taken or retried. */
  capturingWorldId: string | null;
  /** Shots by world id, for whatever is on screen. */
  shotsByWorld: Record<string, WorldShot[]>;
  errorMessage: string | null;

  /** Starts tailing VRChat's log. Idempotent. */
  startWatching: () => Promise<void>;
  stopWatching: () => Promise<void>;
  /** Expect this world next, and shoot it when it loads. */
  armFor: (worldId: string) => Promise<void>;
  disarm: () => void;
  /** Takes a shot right now, whatever world is on screen. */
  captureNow: (worldId: string) => Promise<WorldShot | null>;
  loadShots: (worldId: string) => Promise<void>;
  deleteShot: (worldId: string, fileName: string) => Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useWorldShotsStore = create<WorldShotsState>((set, get) => {
  let unlisten: UnlistenFn | null = null;
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  const clearArm = () => {
    if (armTimer) clearTimeout(armTimer);
    armTimer = null;
    set({ armedWorldId: null });
  };

  /**
   * Takes a shot, and only retries when the frame came back blank. A world
   * that photographs fine first time costs exactly one image.
   */
  const captureWithRetries = async (worldId: string) => {
    set({ capturingWorldId: worldId, errorMessage: null });

    try {
      for (const [attempt, delay] of RETRY_DELAYS_MS.entries()) {
        await sleep(
          attempt === 0 ? delay : delay - RETRY_DELAYS_MS[attempt - 1],
        );

        // A retry is only valid while VRChat is still in the same world. On a
        // tour the next world is already loading by then, and on foot the
        // user may simply have left - either way the frame would be filed
        // under the wrong world.
        if (get().currentWorldId !== worldId) {
          info(`[shots] left ${worldId} before the retry; stopping`);
          return;
        }

        const result = await commands.captureWorldShot(worldId);
        if (result.status !== 'ok') {
          error(`[shots] capture failed: ${result.error}`);
          set({ errorMessage: result.error });
          return;
        }

        await get().loadShots(worldId);

        if (!result.data.looksBlank) {
          info(`[shots] captured ${worldId} on attempt ${attempt + 1}`);
          return;
        }

        // A blank frame is kept: it is still a record of arriving, and the
        // user may well want to see that the world opens in the dark.
        info(`[shots] ${worldId} looked blank, attempt ${attempt + 1}`);
      }
    } finally {
      set({ capturingWorldId: null });
    }
  };

  return {
    isWatching: false,
    armedWorldId: null,
    currentWorldId: null,
    currentWorldName: null,
    capturingWorldId: null,
    shotsByWorld: {},
    errorMessage: null,

    startWatching: async () => {
      if (get().isWatching) return;

      const started = await commands.startVrchatLogWatch();
      if (started.status !== 'ok') {
        error(`[shots] could not watch the VRChat log: ${started.error}`);
        set({ errorMessage: started.error });
        return;
      }

      if (!unlisten) {
        unlisten = await listen<WorldEnteredEvent>(
          'vrchat-world-entered',
          (event) => {
            const { armedWorldId } = get();
            info(
              `[shots] entered ${event.payload.worldId} (${event.payload.worldName})`,
            );

            // Tracked whether or not this world was asked for, so the capture
            // key always knows where the shot belongs.
            set({
              currentWorldId: event.payload.worldId,
              currentWorldName: event.payload.worldName,
            });

            // Only shoot the world that was actually asked for. Wandering off
            // somewhere else should not quietly fill the library with shots.
            if (!armedWorldId || armedWorldId !== event.payload.worldId) return;

            clearArm();
            void captureWithRetries(event.payload.worldId);
          },
        );
      }

      // Fails when something else already owns the combination; that is worth
      // saying out loud rather than leaving a key that quietly does nothing.
      try {
        if (!(await isRegistered(CAPTURE_SHORTCUT))) {
          await registerShortcut(CAPTURE_SHORTCUT, (event) => {
            if (event.state !== 'Pressed') return;
            const { currentWorldId } = get();
            if (!currentWorldId) {
              info('[shots] capture key pressed, but no world is loaded');
              return;
            }
            void get().captureNow(currentWorldId);
          });
        }
      } catch (e) {
        error(`[shots] could not register ${CAPTURE_SHORTCUT}: ${e}`);
      }

      set({ isWatching: true });
    },

    stopWatching: async () => {
      await commands.stopVrchatLogWatch();
      try {
        await unregisterShortcut(CAPTURE_SHORTCUT);
      } catch {
        // Never registered, or already gone; nothing to undo.
      }
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
      clearArm();
      set({ isWatching: false });
    },

    armFor: async (worldId: string) => {
      await get().startWatching();
      if (!get().isWatching) return;

      if (armTimer) clearTimeout(armTimer);
      set({ armedWorldId: worldId });

      // Give up quietly rather than shooting whatever world is entered an
      // hour later.
      armTimer = setTimeout(() => {
        info(`[shots] gave up waiting for ${worldId}`);
        clearArm();
      }, ARM_TIMEOUT_MS);
    },

    disarm: clearArm,

    captureNow: async (worldId: string) => {
      set({ capturingWorldId: worldId, errorMessage: null });
      try {
        const result = await commands.captureWorldShot(worldId);
        if (result.status !== 'ok') {
          set({ errorMessage: result.error });
          return null;
        }
        await get().loadShots(worldId);
        return result.data;
      } finally {
        set({ capturingWorldId: null });
      }
    },

    loadShots: async (worldId: string) => {
      const result = await commands.getWorldShots(worldId);
      if (result.status !== 'ok') {
        error(`[shots] listing failed: ${result.error}`);
        return;
      }
      set((state) => ({
        shotsByWorld: { ...state.shotsByWorld, [worldId]: result.data },
      }));
    },

    deleteShot: async (worldId: string, fileName: string) => {
      const result = await commands.deleteWorldShot(worldId, fileName);
      if (result.status !== 'ok') {
        error(`[shots] delete failed: ${result.error}`);
        set({ errorMessage: result.error });
        return;
      }
      await get().loadShots(worldId);
    },
  };
});
