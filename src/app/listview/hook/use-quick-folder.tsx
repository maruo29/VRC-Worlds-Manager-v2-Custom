'use client';

import { create } from 'zustand';
import { commands } from '@/lib/bindings';
import { error } from '@tauri-apps/plugin-log';

/**
 * The "quick folder": a built-in folder that every world card can be dropped
 * into with a single checkbox, without opening the add-to-folder dialog.
 *
 * It is an ordinary user folder underneath, so it shows up as a folder tag on
 * the cards and works with sharing, sorting and the folder view. It is created
 * on demand and pinned to the top of the sidebar list.
 */
interface QuickFolderState {
  /** Feature switch from the settings page. */
  isEnabled: boolean;
  name: string;
  isLoaded: boolean;
  /** True once the folder is known to exist, so we only create it once. */
  isEnsured: boolean;
  /**
   * Worlds currently in the quick folder. Kept here rather than read off each
   * card's folder list, so the checkbox is correct even on pages whose worlds
   * come from the API and carry no folder membership.
   */
  memberIds: Set<string>;
  /** Feature switch for the built-in favourite/photographed/shared view. */
  isStatusEnabled: boolean;
  /** User order of the built-in library entries. */
  libraryItemOrder: string[];

  load: () => Promise<void>;
  loadMembers: () => Promise<void>;
  setMemberOptimistically: (worldId: string, isMember: boolean) => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  /** Keeps the stored name in step when the folder is renamed in the UI. */
  setName: (name: string) => Promise<void>;
  setStatusEnabled: (enabled: boolean) => Promise<void>;
  setLibraryItemOrder: (order: string[]) => Promise<void>;
  markEnsured: () => void;
}

export const useQuickFolderStore = create<QuickFolderState>((set, get) => ({
  isEnabled: true,
  name: '',
  isLoaded: false,
  isEnsured: false,
  memberIds: new Set<string>(),
  isStatusEnabled: true,
  libraryItemOrder: [],

  load: async () => {
    if (get().isLoaded) return;

    const [enabled, name, statusEnabled, order] = await Promise.all([
      commands.getQuickFolderEnabled(),
      commands.getQuickFolderName(),
      commands.getStatusFolderEnabled(),
      commands.getLibraryItemOrder(),
    ]);

    if (enabled.status !== 'ok' || name.status !== 'ok') {
      error('[quick-folder] failed to load preferences');
      return;
    }

    set({
      isEnabled: enabled.data,
      name: name.data,
      isStatusEnabled:
        statusEnabled.status === 'ok' ? statusEnabled.data : true,
      libraryItemOrder: order.status === 'ok' ? order.data : [],
      isLoaded: true,
    });
  },

  loadMembers: async () => {
    const { name } = get();
    if (!name) return;

    const result = await commands.getWorlds(name);
    if (result.status !== 'ok') {
      // The folder may simply not exist yet; that is not worth a toast.
      set({ memberIds: new Set<string>() });
      return;
    }

    set({ memberIds: new Set(result.data.map((world) => world.worldId)) });
  },

  setMemberOptimistically: (worldId: string, isMember: boolean) =>
    set((state) => {
      const next = new Set(state.memberIds);
      if (isMember) next.add(worldId);
      else next.delete(worldId);
      return { memberIds: next };
    }),

  setEnabled: async (enabled: boolean) => {
    const result = await commands.setQuickFolderEnabled(enabled);
    if (result.status !== 'ok') {
      error(`[quick-folder] failed to save the setting: ${result.error}`);
      return;
    }
    set({ isEnabled: enabled });
  },

  setName: async (name: string) => {
    const result = await commands.setQuickFolderName(name);
    if (result.status !== 'ok') {
      error(`[quick-folder] failed to save the new name: ${result.error}`);
      return;
    }
    set({ name });
  },

  setStatusEnabled: async (enabled: boolean) => {
    const result = await commands.setStatusFolderEnabled(enabled);
    if (result.status !== 'ok') {
      error(`[status-folder] failed to save the setting: ${result.error}`);
      return;
    }
    set({ isStatusEnabled: enabled });
  },

  setLibraryItemOrder: async (order: string[]) => {
    // Applied locally first so the drag lands without a round trip.
    set({ libraryItemOrder: order });
    const result = await commands.setLibraryItemOrder(order);
    if (result.status !== 'ok') {
      error(`[library-order] failed to save the order: ${result.error}`);
    }
  },

  markEnsured: () => set({ isEnsured: true }),
}));
