'use client';

import { create } from 'zustand';
import { commands } from '@/lib/bindings';
import { error, info } from '@tauri-apps/plugin-log';

/**
 * Worlds that have actually been visited, for the mark on the card.
 *
 * The backing list grows rather than being recomputed: VRChat keeps only a
 * handful of log files, so anything not captured while it was there is gone
 * for good. The first refresh also folds in VRChat's own recently-visited
 * listing, which reaches further back than the logs do.
 */
interface VisitedWorldsState {
  worldIds: Set<string>;
  isLoaded: boolean;
  isRefreshing: boolean;

  /** Reads the stored list; refreshes it once per session on first call. */
  load: () => Promise<void>;
  /** Re-reads VRChat's logs and history. Only ever adds. */
  refresh: () => Promise<void>;
  isVisited: (worldId: string) => boolean;
}

export const useVisitedWorldsStore = create<VisitedWorldsState>((set, get) => {
  let refreshedThisSession = false;

  const read = async () => {
    const visited = await commands.getVisitedWorlds();
    set({
      worldIds: new Set(visited.map((entry) => entry.worldId)),
      isLoaded: true,
    });
  };

  return {
    worldIds: new Set<string>(),
    isLoaded: false,
    isRefreshing: false,

    load: async () => {
      if (get().isLoaded) return;
      await read();

      // One scan per session: the logs only change while VRChat is running,
      // and the live watcher records those arrivals as they happen.
      if (!refreshedThisSession) {
        refreshedThisSession = true;
        void get().refresh();
      }
    },

    refresh: async () => {
      if (get().isRefreshing) return;
      set({ isRefreshing: true });
      try {
        const result = await commands.refreshVisitedWorlds();
        if (result.status !== 'ok') {
          error(`[visited] refresh failed: ${result.error}`);
          return;
        }
        info(`[visited] ${result.data} world(s) known`);
        await read();
      } finally {
        set({ isRefreshing: false });
      }
    },

    isVisited: (worldId: string) => get().worldIds.has(worldId),
  };
});
