import {
  CardSize,
  commands,
  WorldDisplayData,
  VisibleButtons,
} from '@/lib/bindings';
import { usePopupStore } from '../../hook/usePopups/store';
import { toast } from 'sonner';
import { useLocalization } from '@/hooks/use-localization';
import { use, useEffect, useMemo, useState } from 'react';
import { error } from '@tauri-apps/plugin-log';
import { useSelectedWorldsStore } from '../../hook/use-selected-worlds';
import { useFolders } from '../../hook/use-folders';
import { useWorlds, useWorldsStore } from '../../hook/use-worlds';
import { useQuickFolderStore } from '../../hook/use-quick-folder';
import { useRelatedWorldsStore } from '../../hook/use-related-worlds';
import { useWorldFiltersStore } from '../../hook/use-filters';
import { usePathname, useRouter } from 'next/navigation';
import path from 'path';
import {
  FolderType,
  isUserFolder,
  SpecialFolders,
  isApiBackedFolder,
} from '@/types/folders';

export function useWorldGrid(
  currentFolder: FolderType,
  worlds: WorldDisplayData[],
  onWorldUpdate?: (worldId: string, updates: Partial<WorldDisplayData>) => void,
) {
  const { t } = useLocalization();
  const setPopup = usePopupStore((state) => state.setPopup);

  const {
    getSelectedWorlds,
    isSelectionMode,
    toggleSelectionMode,
    toggleWorldSelection,
    selectAllWorlds,
    clearFolderSelections,
  } = useSelectedWorldsStore();

  const { refresh } = useWorlds(currentFolder);

  const [cardSize, setCardSize] = useState<CardSize>('Normal');

  useEffect(() => {
    loadCardSize();
  }, []);

  const loadCardSize = async () => {
    try {
      const result = await commands.getCardSize();
      if (result.status === 'ok') {
        setCardSize(result.data);
      }
    } catch (e) {
      error(`Failed to load card size: ${e}`);
      toast(t('general:error-title'), {
        description: t('listview-page:error-load-card-size'),
      });
    }
  };

  const [visibleButtons, setVisibleButtons] = useState<VisibleButtons>({
    favorite: true,
    photographed: true,
    shared: true,
  });

  useEffect(() => {
    loadVisibleButtons();
  }, []);

  const loadVisibleButtons = async () => {
    try {
      const result = await commands.getVisibleButtons();
      if (result.status === 'ok') {
        setVisibleButtons(result.data);
      }
    } catch (e) {
      error(`Failed to load visible buttons: ${e}`);
    }
  };

  const selectedWorlds = Array.from(getSelectedWorlds(currentFolder));

  const toggleWorld = (worldId: string) => {
    toggleWorldSelection(currentFolder, worldId);
  };

  const clearSelection = () => {
    clearFolderSelections(currentFolder);
  };

  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        (isSelectionMode || selectedWorlds.length > 0)
      ) {
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleEscKey);
    return () => window.removeEventListener('keydown', handleEscKey);
    // Without these deps the listener was re-registered on every render.
  }, [isSelectionMode, selectedWorlds.length, currentFolder]);

  const isFindPage = isApiBackedFolder(currentFolder);
  const isSpecialFolder = !isUserFolder(currentFolder);
  const isHiddenFolder = currentFolder === SpecialFolders.Hidden;

  // Every world already in the library, for the "Added" badge on API-backed
  // pages. Fetched only when membership actually changes - the displayed
  // worlds change far more often (paging, filtering) and refetching the whole
  // library each time was two IPC round trips per keystroke-sized update.
  const [libraryWorldIds, setLibraryWorldIds] = useState<Set<string>>(
    () => new Set(),
  );
  // respond to membership changes triggered by dialogs
  const membershipVersion = usePopupStore((s) => s.membershipVersion);
  useEffect(() => {
    if (!isFindPage) return; // Only needed for API-backed pages

    let cancelled = false;

    const loadLibraryWorldIds = async () => {
      try {
        const existingWorldsResult = await commands.getAllWorlds();
        if (existingWorldsResult.status !== 'ok') {
          error(`Error fetching worlds: ${existingWorldsResult.error}`);
          throw new Error(existingWorldsResult.error);
        }

        const hiddenWorldsResult = await commands.getHiddenWorlds();
        if (hiddenWorldsResult.status !== 'ok') {
          error(`Error fetching hidden worlds: ${hiddenWorldsResult.error}`);
          throw new Error(hiddenWorldsResult.error);
        }

        if (cancelled) return;

        // "Already added" means filed somewhere, not merely present in the
        // data. Removing a world from its last folder leaves the record
        // behind - 110 of 547 worlds were in that state - and badging those
        // as added hid exactly the worlds worth rediscovering.
        //
        // Hidden worlds keep the badge: hiding strips a world from every
        // folder, and a world the user asked never to see again should not
        // come back looking new.
        const filed = existingWorldsResult.data
          .filter((world) => world.folders.length > 0)
          .map((world) => world.worldId);
        const hidden = hiddenWorldsResult.data.map((world) => world.worldId);

        setLibraryWorldIds(new Set([...filed, ...hidden]));
      } catch (err) {
        error(`Error checking world existence: ${err}`);
      }
    };

    loadLibraryWorldIds();

    return () => {
      cancelled = true;
    };
  }, [isFindPage, membershipVersion]);

  // One-click "quick folder" checkbox shown on every card.
  const {
    isEnabled: quickFolderEnabled,
    name: quickFolderName,
    memberIds: quickFolderMemberIds,
    load: loadQuickFolder,
    loadMembers: loadQuickFolderMembers,
    setMemberOptimistically: setQuickFolderMember,
  } = useQuickFolderStore();
  const bumpMembershipVersion = usePopupStore((s) => s.bumpMembershipVersion);
  const updateWorldProperty = useWorldsStore((s) => s.updateWorldProperty);
  const addWorldToFolder = useWorldsStore((s) => s.addWorldToFolder);
  const [pendingQuickToggles, setPendingQuickToggles] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    loadQuickFolder();
  }, [loadQuickFolder]);

  // Re-read membership whenever anything (this checkbox, the dialog, the
  // folder view) changes what is in a folder.
  useEffect(() => {
    if (!quickFolderEnabled || !quickFolderName) return;
    loadQuickFolderMembers();
  }, [
    quickFolderEnabled,
    quickFolderName,
    membershipVersion,
    loadQuickFolderMembers,
  ]);

  const isInQuickFolder = (world: WorldDisplayData) =>
    quickFolderMemberIds.has(world.worldId);

  const handleToggleQuickFolder = async (world: WorldDisplayData) => {
    if (!quickFolderName || pendingQuickToggles.has(world.worldId)) return;

    const wasMember = isInQuickFolder(world);

    // Taking a world out of the quick folder is the moment it gets filed
    // properly, so hand it to the add-to-folder dialog with the quick folder
    // already unticked instead of just dropping it.
    if (wasMember) {
      setPopup('addToFolderPreRemove', [quickFolderName]);
      setPopup('showAddToFolder', [world]);
      return;
    }

    const nextFolders = [...world.folders, quickFolderName];

    setPendingQuickToggles((pending) => new Set(pending).add(world.worldId));
    // Optimistic: the checkbox has to feel instant.
    setQuickFolderMember(world.worldId, true);
    updateWorldProperty(world.worldId, { folders: nextFolders });
    onWorldUpdate?.(world.worldId, { folders: nextFolders });

    try {
      // Goes through the store so worlds coming from the API get saved to the
      // library first.
      await addWorldToFolder(quickFolderName, world.worldId);
      bumpMembershipVersion();
    } catch (e) {
      error(`Failed to toggle the quick folder: ${e}`);
      setQuickFolderMember(world.worldId, false);
      updateWorldProperty(world.worldId, { folders: world.folders });
      onWorldUpdate?.(world.worldId, { folders: world.folders });
      toast(t('general:error-title'), {
        description: t('world-grid:quick-folder-error'),
      });
    } finally {
      setPendingQuickToggles((pending) => {
        const next = new Set(pending);
        next.delete(world.worldId);
        return next;
      });
    }
  };

  const existingWorldIds = useMemo(() => {
    if (!isFindPage || libraryWorldIds.size === 0) return new Set<string>();
    return new Set(
      worlds
        .map((world) => world.worldId)
        .filter((worldId) => libraryWorldIds.has(worldId)),
    );
  }, [isFindPage, worlds, libraryWorldIds]);

  const selectAllFindPage = () => {
    const worldsToSelect = worlds
      .filter((world) => !existingWorldIds.has(world.worldId))
      .map((world) => world.worldId);
    selectAllWorlds(currentFolder, worldsToSelect);
  };

  const router = useRouter();

  /** Uses the current selection when there is one, otherwise the clicked card. */
  const seedsFor = (world: WorldDisplayData) =>
    isSelectionMode && selectedWorlds.includes(world.worldId)
      ? worlds.filter((candidate) => selectedWorlds.includes(candidate.worldId))
      : [world];

  const handleFindRelated = (world: WorldDisplayData) => {
    useRelatedWorldsStore.getState().search(seedsFor(world));
    router.push('/listview/folders/special/related');
  };

  /**
   * Same analysis, but stays put: the search page then folds relatedness into
   * whatever the user is searching for.
   */
  const handleSetRelatedBase = (world: WorldDisplayData) => {
    const seeds = seedsFor(world);
    useRelatedWorldsStore.getState().search(seeds);
    toast(t('world-grid:related-base-set-title'), {
      description:
        seeds.length === 1
          ? seeds[0].name
          : t('world-grid:related-base-set-multi', seeds.length),
    });
  };

  const handleOpenWorldDetails = (
    worldId: string,
    dontSaveToLocal?: boolean,
  ) => {
    setPopup('showWorldDetails', {
      id: worldId,
      dontSaveToLocal: dontSaveToLocal ?? false,
    });
  };

  const handleShareWorld = (worldId: string, worldName: string) => {
    setPopup('showShareWorld', { worldId, worldName });
  };

  // pass the worldId of the world that was selected. This only gets used if
  const handleOpenFolderDialog = (worldId: string) => {
    const idsToAdd =
      isSelectionMode && selectedWorlds.includes(worldId)
        ? Array.from(selectedWorlds)
        : [worldId];

    const worldsToAdd = worlds.filter((world) =>
      idsToAdd.includes(world.worldId),
    );
    setPopup('showAddToFolder', worldsToAdd);
  };

  const handleDeleteWorld = async (worldId: string) => {
    try {
      const result = await commands.deleteWorld(worldId);

      if (result.status === 'error') {
        toast(t('general:error-title'), {
          description: t('listview-page:error-delete-world'),
        });
        return;
      }

      await refresh();
      toast(t('general:success-title'), {
        description: t('listview-page:world-deleted-success'),
      });
    } catch (e) {
      error(`Failed to delete world: ${e}`);
      toast(t('general:error-title'), {
        description: t('listview-page:error-delete-world'),
      });
    }
  };

  const handleRemoveFromCurrentFolder = async (worldId: string) => {
    const worldsToRemove =
      isSelectionMode && selectedWorlds.includes(worldId)
        ? Array.from(selectedWorlds)
        : [worldId];

    removeWorldsFromFolder(worldsToRemove);
  };

  const removeWorldsFromFolder = async (worldIds: string[]) => {
    try {
      const removedWorlds = worldIds;

      // Remove all worlds from folder in parallel
      await Promise.all(
        worldIds.map((id) => commands.removeWorldFromFolder(currentFolder, id)),
      );

      toast(t('listview-page:worlds-removed-title'), {
        description: (
          <span>{t('listview-page:removed-from-folder', currentFolder)}</span>
        ),
        action: {
          label: t('listview-page:undo-button'),
          onClick: async () => {
            try {
              // Restore all worlds to folder in parallel
              await Promise.all(
                removedWorlds.map((id) =>
                  commands.addWorldToFolder(currentFolder, id),
                ),
              );

              await refresh();
              toast(t('listview-page:restored-title'), {
                description: t('listview-page:worlds-restored-to-folder'),
              });
            } catch (e) {
              error(`Failed to restore worlds: ${e}`);
              toast(t('general:error-title'), {
                description: t('listview-page:error-restore-worlds'),
              });
            }
          },
        },
      });

      await refresh();
    } catch (e) {
      error(`Failed to remove worlds from folder: ${e}`);
      toast(t('general:error-title'), {
        description: t('listview-page:error-remove-from-folder'),
      });
    }
  };

  const handleHideWorld = async (worldId: string[], worldName: string[]) => {
    try {
      // Store original folder information for each world before hiding
      const worldFoldersMap = new Map<string, string[]>();

      // Get folder information for each world
      for (const id of worldId) {
        const world = worlds.find((w) => w.worldId === id);
        if (world) {
          worldFoldersMap.set(id, [...world.folders]);
        }
      }

      // Hide worlds in parallel instead of one by one
      await Promise.all(worldId.map((id) => commands.hideWorld(id)));

      toast(t('listview-page:worlds-hidden-title'), {
        description:
          worldName.length > 1
            ? t(
                'listview-page:worlds-hidden-multiple',
                worldName[0],
                worldName.length - 1,
              )
            : t('listview-page:worlds-hidden-single', worldName[0]),
        action: {
          label: t('listview-page:undo-button'),
          onClick: async () => {
            try {
              // Parallel unhide and folder restoration
              await Promise.all(
                worldId.map(async (id) => {
                  await commands.unhideWorld(id);

                  // Restore folders for this world
                  const originalFolders = worldFoldersMap.get(id);
                  if (originalFolders?.length) {
                    await Promise.all(
                      originalFolders.map((folder) =>
                        commands.addWorldToFolder(folder, id),
                      ),
                    );
                  }
                }),
              );

              await refresh();
              toast(t('listview-page:restored-title'), {
                description: t('listview-page:worlds-restored'),
              });
            } catch (e) {
              error(`Failed to restore worlds: ${e}`);
              toast(t('general:error-title'), {
                description: t('listview-page:error-restore-worlds'),
              });
            }
          },
        },
      });

      await refresh();
    } catch (e) {
      error(`Failed to hide world: ${e}`);
      toast(t('general:error-title'), {
        description: t('listview-page:error-hide-world'),
      });
    }
  };

  const handleRestoreWorld = async (worldIds: string[]) => {
    try {
      const restoredWorlds = worldIds;

      // Unhide all worlds in parallel
      await Promise.all(worldIds.map((id) => commands.unhideWorld(id)));

      toast(t('listview-page:restored-title'), {
        description: t('listview-page:worlds-restored'),
        action: {
          label: t('listview-page:undo-button'),
          onClick: async () => {
            try {
              // Hide all worlds in parallel
              await Promise.all(
                restoredWorlds.map((id) => commands.hideWorld(id)),
              );

              await refresh();
              toast(t('listview-page:worlds-hidden-title'), {
                description: t('listview-page:worlds-hidden-again'),
              });
            } catch (e) {
              error(`Failed to restore worlds: ${e}`);
              toast(t('general:error-title'), {
                description: t('listview-page:error-hide-world'),
              });
            }
          },
        },
      });

      await refresh();
    } catch (e) {
      error(`Failed to restore worlds: ${e}`);
      toast(t('general:error-title'), {
        description: t('listview-page:error-restore-worlds'),
      });
    }
  };

  const handleSetPhotographed = async (
    worldId: string,
    isPhotographed: boolean,
  ) => {
    // Optimistic update - instantly update UI in both stores
    useWorldsStore.getState().updateWorldProperty(worldId, { isPhotographed });
    onWorldUpdate?.(worldId, { isPhotographed });

    // Also update filteredWorlds for immediate UI refresh
    const currentFiltered = useWorldFiltersStore.getState().filteredWorlds;
    useWorldFiltersStore
      .getState()
      .setFilteredWorlds(
        currentFiltered.map((w) =>
          w.worldId === worldId ? { ...w, isPhotographed } : w,
        ),
      );
    try {
      await commands.setWorldPhotographed(worldId, isPhotographed);
    } catch (e) {
      // Revert on error
      useWorldsStore
        .getState()
        .updateWorldProperty(worldId, { isPhotographed: !isPhotographed });
      onWorldUpdate?.(worldId, { isPhotographed: !isPhotographed });

      useWorldFiltersStore
        .getState()
        .setFilteredWorlds(
          useWorldFiltersStore
            .getState()
            .filteredWorlds.map((w) =>
              w.worldId === worldId
                ? { ...w, isPhotographed: !isPhotographed }
                : w,
            ),
        );
      error(`Failed to set photographed status: ${e}`);
      toast(t('general:error-title'), {
        description: t('general:error-description'),
      });
    }
  };

  const handleSetShared = async (worldId: string, isShared: boolean) => {
    // Optimistic update - instantly update UI in both stores
    useWorldsStore.getState().updateWorldProperty(worldId, { isShared });
    onWorldUpdate?.(worldId, { isShared });

    // Also update filteredWorlds for immediate UI refresh
    const currentFiltered = useWorldFiltersStore.getState().filteredWorlds;
    useWorldFiltersStore
      .getState()
      .setFilteredWorlds(
        currentFiltered.map((w) =>
          w.worldId === worldId ? { ...w, isShared } : w,
        ),
      );
    try {
      await commands.setWorldShared(worldId, isShared);
    } catch (e) {
      // Revert on error
      useWorldsStore
        .getState()
        .updateWorldProperty(worldId, { isShared: !isShared });
      onWorldUpdate?.(worldId, { isShared: !isShared });

      useWorldFiltersStore
        .getState()
        .setFilteredWorlds(
          useWorldFiltersStore
            .getState()
            .filteredWorlds.map((w) =>
              w.worldId === worldId ? { ...w, isShared: !isShared } : w,
            ),
        );
      error(`Failed to set shared status: ${e}`);
      toast(t('general:error-title'), {
        description: t('general:error-description'),
      });
    }
  };

  const handleSetFavorite = async (worldId: string, isFavorite: boolean) => {
    // Optimistic update - instantly update UI in both stores
    useWorldsStore.getState().updateWorldProperty(worldId, { isFavorite });
    onWorldUpdate?.(worldId, { isFavorite });

    // Also update filteredWorlds for immediate UI refresh
    const currentFiltered = useWorldFiltersStore.getState().filteredWorlds;
    useWorldFiltersStore
      .getState()
      .setFilteredWorlds(
        currentFiltered.map((w) =>
          w.worldId === worldId ? { ...w, isFavorite } : w,
        ),
      );
    try {
      await commands.setWorldFavorite(worldId, isFavorite);
    } catch (e) {
      // Revert on error
      useWorldsStore
        .getState()
        .updateWorldProperty(worldId, { isFavorite: !isFavorite });
      onWorldUpdate?.(worldId, { isFavorite: !isFavorite });

      useWorldFiltersStore
        .getState()
        .setFilteredWorlds(
          useWorldFiltersStore
            .getState()
            .filteredWorlds.map((w) =>
              w.worldId === worldId ? { ...w, isFavorite: !isFavorite } : w,
            ),
        );
      error(`Failed to set favorite status: ${e}`);
      toast(t('general:error-title'), {
        description: t('general:error-description'),
      });
    }
  };

  return {
    cardSize,
    quickFolderEnabled,
    quickFolderName,
    isInQuickFolder,
    handleToggleQuickFolder,
    pendingQuickToggles,
    selectedWorlds,
    selectAllWorlds,
    toggleWorld,
    clearSelection,
    isSelectionMode,
    selectAllFindPage,
    handleOpenFolderDialog,
    handleOpenWorldDetails,
    handleFindRelated,
    handleSetRelatedBase,
    handleShareWorld,
    handleDeleteWorld,
    handleRemoveFromCurrentFolder,
    removeWorldsFromFolder,
    handleHideWorld,
    handleRestoreWorld,
    handleSetFavorite,
    handleSetPhotographed,
    handleSetShared,
    isFindPage,
    isSpecialFolder,
    isHiddenFolder,
    existingWorldIds,
    visibleButtons,
  };
}
