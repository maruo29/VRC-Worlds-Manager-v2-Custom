'use client';

import { create } from 'zustand';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  register as registerShortcut,
  unregister as unregisterShortcut,
  isRegistered,
} from '@tauri-apps/plugin-global-shortcut';
import { commands, type WorldDisplayData } from '@/lib/bindings';
import { error, info } from '@tauri-apps/plugin-log';
import { useWorldShotsStore } from '@/app/listview/hook/use-world-shots';

/**
 * Visiting a list of worlds one after another, taking a shot in each.
 *
 * Paced at roughly the speed a person hops between worlds, started by hand,
 * cancellable at any point and capped in length. That is partly courtesy to
 * VRChat's servers and partly the point: a tour that ran faster than a human
 * could would be automation of the client rather than a convenience, and
 * VRChat's terms draw the line at use "inconsistent with individual human
 * usage".
 */

/** Worlds per run. Thirty is an evening's shortlist, which is the use case. */
export const MAX_TOUR_WORLDS = 30;

/**
 * How long to wait for one world before giving up on it.
 *
 * Measured: a cold VRChat start took 46 seconds to reach the room plus 20 to
 * load; with the client already up it was 24. A first-time download of a
 * heavy world is slower again, so this is deliberately loose.
 */
const WORLD_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * How long the automatic shot needs before the tour is free to move on.
 *
 * The shots store fires a few seconds after the world reports ready, so this
 * only has to outlast that.
 */
const SHOT_GRACE_MS = 8_000;

/**
 * How long to stand in a world once the shot is taken, before moving on by
 * itself.
 *
 * There is no right number here, which is why it is a choice rather than a
 * constant: how long a world is worth is a property of the world. Waiting for
 * the user is the default behaviour and this is only the safety net that
 * keeps an unattended tour finishing.
 */
export const AUTO_ADVANCE_OPTIONS: { id: string; ms: number | null }[] = [
  { id: '30s', ms: 30_000 },
  { id: '1m', ms: 60_000 },
  { id: '3m', ms: 180_000 },
  { id: 'manual', ms: null },
];

/** Long enough to walk about in and take a shot or two by hand. */
export const DEFAULT_AUTO_ADVANCE = '3m';

/**
 * Key that moves the tour on. Global, because it is pressed while standing in
 * the world with VRChat in front, not with this window focused. Registered
 * only while a tour is running, so it is not quietly held the rest of the
 * time.
 */
export const ADVANCE_SHORTCUT = 'CommandOrControl+Shift+D';

/** Gap before asking VRChat for the next world, so hops stay human-paced. */
const BETWEEN_WORLDS_MS = 3_000;

/**
 * `waiting` is the tour standing in a world with its shot taken, leaving the
 * user to look around until they move it on.
 */
export type TourStatus = 'idle' | 'running' | 'waiting' | 'stopping';

export interface TourEntry {
  worldId: string;
  name: string;
  state: 'pending' | 'visiting' | 'done' | 'failed' | 'skipped';
  /** Why it failed, for the one line the UI shows. */
  detail?: string;
}

interface WorldTourState {
  status: TourStatus;
  entries: TourEntry[];
  /** Index into `entries`, or -1 when not running. */
  currentIndex: number;
  /** Id from AUTO_ADVANCE_OPTIONS. */
  autoAdvance: string;
  /** Epoch ms the tour will move on by itself, or null when it will not. */
  advanceAt: number | null;

  /** Queues the worlds and starts visiting them. */
  start: (worlds: WorldDisplayData[]) => Promise<void>;
  /** Moves on from the world being looked at right now. */
  advance: () => void;
  setAutoAdvance: (id: string) => void;
  /** Finishes the world in progress, then stops. */
  stop: () => void;
  /** Clears a finished tour from the screen. */
  reset: () => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useWorldTourStore = create<WorldTourState>((set, get) => {
  /** Resolves when the user moves on, or when the safety net fires. */
  let releaseHold: (() => void) | null = null;

  const setEntry = (index: number, patch: Partial<TourEntry>) =>
    set((state) => ({
      entries: state.entries.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      ),
    }));

  /**
   * Opens one world and resolves once VRChat reports it loaded, or times out.
   *
   * The listener is attached before the world is opened, since a cached world
   * can finish loading faster than a round trip through the API.
   */
  const visit = async (worldId: string): Promise<'entered' | 'timeout'> => {
    let announceEntered: (value: 'entered') => void = () => {};
    const entered = new Promise<'entered'>((resolve) => {
      announceEntered = resolve;
    });

    const unlisten: UnlistenFn = await listen<{ worldId: string }>(
      'vrchat-world-entered',
      (event) => {
        if (event.payload.worldId === worldId) announceEntered('entered');
      },
    );

    try {
      const region = await commands.getRegion();
      if (region.status !== 'ok') throw new Error(region.error);

      const created = await commands.createVisitInstance(
        worldId,
        'invite+',
        region.data,
      );
      if (created.status !== 'ok') throw new Error(created.error);

      const opened = await commands.openInstanceInClient(
        created.data.world_id,
        created.data.instance_id,
      );
      if (opened.status !== 'ok') throw new Error(opened.error);

      const timeout = sleep(WORLD_TIMEOUT_MS).then(() => 'timeout' as const);
      return await Promise.race([entered, timeout]);
    } finally {
      unlisten();
    }
  };

  /**
   * Stands in the world until the user moves on, or the chosen safety net
   * expires. Stopping the tour releases it too, so Stop takes effect at once
   * rather than after the wait.
   */
  const holdInWorld = async () => {
    const option = AUTO_ADVANCE_OPTIONS.find(
      (candidate) => candidate.id === get().autoAdvance,
    );
    const limit = option?.ms ?? null;

    set({
      status: 'waiting',
      advanceAt: limit === null ? null : Date.now() + limit,
    });

    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      releaseHold = () => {
        if (timer) clearTimeout(timer);
        releaseHold = null;
        resolve();
      };

      if (limit !== null) timer = setTimeout(() => releaseHold?.(), limit);
    });

    set({ advanceAt: null });
    if (get().status === 'waiting') set({ status: 'running' });
  };

  return {
    status: 'idle',
    entries: [],
    currentIndex: -1,
    autoAdvance: DEFAULT_AUTO_ADVANCE,
    advanceAt: null,

    start: async (worlds: WorldDisplayData[]) => {
      if (get().status !== 'idle') return;

      const entries: TourEntry[] = worlds
        .slice(0, MAX_TOUR_WORLDS)
        .map((world) => ({
          worldId: world.worldId,
          name: world.name,
          state: 'pending',
        }));
      if (entries.length === 0) return;

      set({ status: 'running', entries, currentIndex: 0 });

      // The shot itself is taken by the shots store, which is already
      // listening; the tour only decides where to go and when to move on.
      const shots = useWorldShotsStore.getState();
      await shots.startWatching();

      try {
        if (!(await isRegistered(ADVANCE_SHORTCUT))) {
          await registerShortcut(ADVANCE_SHORTCUT, (event) => {
            if (event.state === 'Pressed') get().advance();
          });
        }
      } catch (e) {
        error(`[tour] could not register ${ADVANCE_SHORTCUT}: ${e}`);
      }

      for (const [index, entry] of entries.entries()) {
        if (get().status === 'stopping') {
          setEntry(index, { state: 'skipped' });
          continue;
        }

        set({ currentIndex: index });
        setEntry(index, { state: 'visiting' });
        info(`[tour] ${index + 1}/${entries.length} ${entry.worldId}`);

        try {
          await shots.armFor(entry.worldId);
          const outcome = await visit(entry.worldId);

          if (outcome === 'timeout') {
            useWorldShotsStore.getState().disarm();
            setEntry(index, { state: 'failed', detail: 'timeout' });
            info(`[tour] timed out on ${entry.worldId}`);
            continue;
          }

          // The shots store captures on the same event; give it room to
          // finish before handing the world over to the user.
          await sleep(SHOT_GRACE_MS);
          setEntry(index, { state: 'done' });

          // The point of a tour is looking at the place, which takes as long
          // as it takes.
          if (index < entries.length - 1) await holdInWorld();
        } catch (e) {
          useWorldShotsStore.getState().disarm();
          error(`[tour] ${entry.worldId} failed: ${e}`);
          setEntry(index, { state: 'failed', detail: String(e) });
        }

        if (index < entries.length - 1) await sleep(BETWEEN_WORLDS_MS);
      }

      try {
        await unregisterShortcut(ADVANCE_SHORTCUT);
      } catch {
        // Never registered, or already gone; nothing to undo.
      }

      set({ status: 'idle', currentIndex: -1, advanceAt: null });
      info('[tour] finished');
    },

    advance: () => releaseHold?.(),

    setAutoAdvance: (id: string) => {
      set({ autoAdvance: id });
      // A change mid-wait takes effect on the next world rather than cutting
      // the current one short, which would be a surprising thing for a
      // dropdown to do.
    },

    stop: () => {
      if (get().status === 'idle' || get().status === 'stopping') return;
      set({ status: 'stopping' });
      useWorldShotsStore.getState().disarm();
      // Released so a tour waiting in a world stops immediately.
      releaseHold?.();
    },

    reset: () =>
      set({ status: 'idle', entries: [], currentIndex: -1, advanceAt: null }),
  };
});
