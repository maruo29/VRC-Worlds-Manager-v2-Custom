'use client';

import { AddToFolderDialog } from '../../components/popups/add-to-folder';
import { AddWorldPopup } from '../../components/popups/add-world';
import { AdvancedSearchPanel } from '../../components/popups/advanced-search-panel';
import { CreateFolderDialog } from '../../components/popups/create-folder-popup';
import { DeleteFolderDialog } from '../../components/popups/delete-folder-popup';
import { ImportedFolderContainsHidden } from '../../components/popups/imported-folder-contains-hidden';
import { WorldDetailPopup } from '../../components/popups/world-details';
import { ShareFolderPopup } from '../../components/popups/share-folder-popup';
import { ShareWorldPopup } from '../../components/popups/share-world-popup';
import { usePopupStore } from './store';
import { useSearchParams, usePathname } from 'next/navigation';
import { SpecialFolders, FolderType, isUserFolder } from '@/types/folders';
import { useWorlds } from '../use-worlds';
import { commands } from '@/lib/bindings';
import { error, info } from '@tauri-apps/plugin-log';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useLocalization } from '@/hooks/use-localization';
import { toast } from 'sonner';
import { useEffect, useState, useCallback } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function PopupManager() {
  const {
    showAddToFolder,
    showAddWorld,
    showAdvancedSearchPanel,
    showCreateFolder,
    showDeleteFolder,
    showImportedFolderContainsHidden,
    showWorldDetails,
    showShareFolder,
    showShareWorld,

    showDNDConfirm,
    setPopup,
  } = usePopupStore();

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { t } = useLocalization();

  const currentFolder: FolderType = (() => {
    // Special folders by path
    if (pathname?.includes('/folders/special/all')) return SpecialFolders.All;
    if (pathname?.includes('/folders/special/unclassified'))
      return SpecialFolders.Unclassified;
    if (pathname?.includes('/folders/special/find')) return SpecialFolders.Find;
    if (pathname?.includes('/folders/special/hidden'))
      return SpecialFolders.Hidden;
    // User folder from query param
    const user = searchParams?.get('folderName');
    return (user as FolderType) || SpecialFolders.All;
  })();

  const { refresh } = useWorlds(currentFolder);

  // Helper to fix URLs where colon is stripped by protocol handler
  // e.g., "https//example.com" -> "https://example.com"
  const normalizeUrl = (url: string): string => {
    return url
      .replace(/^https\/\//, 'https://')
      .replace(/^http\/\//, 'http://');
  };

  const processUrl = async (text: string) => {
    // Normalize URL first
    const normalizedText = normalizeUrl(text);
    let worldIdToUse = null;

    // 1. Check if it's a direct World ID
    const worldIdMatch = normalizedText.match(/wrld_[a-zA-Z0-9-]{36}/);
    if (worldIdMatch) {
      worldIdToUse = worldIdMatch[0];
      info(`Detected World ID: ${worldIdToUse}`);
    }

    // 2. Check if it's a VRChat URL
    if (!worldIdToUse && (normalizedText.includes('vrchat.com/home/launch/world/') || normalizedText.includes('vrchat.com/home/world/'))) {
      const match = normalizedText.match(/wrld_[a-zA-Z0-9-]{36}/);
      if (match) {
        worldIdToUse = match[0];
        info(`Detected World ID from VRChat URL: ${worldIdToUse}`);
      }
    }

    // 3. If still unknown, try resolving redirects (Shortened URLs)
    if (!worldIdToUse && (normalizedText.startsWith('http://') || normalizedText.startsWith('https://'))) {
      info(`Attempting to resolve URL: ${normalizedText}`);
      const toastId = toast.loading(t('add-world-dialog:resolving-url'));

      try {
        const resolvedUrl = await invoke<string>('resolve_redirects', { url: normalizedText });
        info(`Resolved URL: ${resolvedUrl}`);

        const resolvedMatch = resolvedUrl.match(/wrld_[a-zA-Z0-9-]{36}/);
        if (resolvedMatch) {
          worldIdToUse = resolvedMatch[0];
          info(`Detected World ID after resolution: ${worldIdToUse}`);
        } else {
          info('Resolved URL does not contain a world ID');
          toast.error(t('add-world-dialog:url-invalid'), {
            description: resolvedUrl
          });
        }
      } catch (err) {
        error(`Failed to resolve URL: ${err}`);
        toast.error(t('add-world-dialog:resolution-failed'), {
          description: String(err)
        });
      } finally {
        toast.dismiss(toastId);
      }
    }

    if (worldIdToUse) {
      info('Valid World ID detected, opening popup');
      // Check if any blocking popup is open
      const isBlockingPopupOpen =
        usePopupStore.getState().showAddToFolder ||
        usePopupStore.getState().showAddWorld ||
        usePopupStore.getState().showAdvancedSearchPanel ||
        usePopupStore.getState().showCreateFolder ||
        usePopupStore.getState().showDeleteFolder ||
        usePopupStore.getState().showImportedFolderContainsHidden ||
        usePopupStore.getState().showWorldDetails ||
        usePopupStore.getState().showShareFolder ||
        usePopupStore.getState().showShareWorld;

      if (isBlockingPopupOpen) {
        setPopup('showDNDConfirm', { url: worldIdToUse });
      } else {
        setPopup('showAddWorld', { initialWorldId: worldIdToUse });
      }
    } else {
      info('Dropped text resulted in no valid World ID');
    }
  };

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };



    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      info('Drop event detected');

      let text = e.dataTransfer?.getData('text/plain');
      if (!text) {
        text = e.dataTransfer?.getData('text/uri-list');
      }

      info(`Dropped text: ${text}`);

      if (!text) {
        if (e.dataTransfer?.files.length) {
          info(`Dropped ${e.dataTransfer.files.length} files`);
        }
        return;
      }

      await processUrl(text);
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [
    showAddToFolder,
    showAddWorld,
    showAdvancedSearchPanel,
    showCreateFolder,
    showDeleteFolder,
    showImportedFolderContainsHidden,
    showWorldDetails,
    showShareFolder,
    showShareWorld,
    setPopup,
    t // Added dependency
  ]);

  // Helper to handle search action
  const handleSearchAction = useCallback((searchText: string) => {
    info(`Search action triggered with: ${searchText}`);
    // Navigate to Find World page with search query
    const searchUrl = `/listview/folders/special/find?q=${encodeURIComponent(searchText)}&autoSearch=true`;
    window.location.href = searchUrl;
  }, []);

  // Startup Deep Link Check
  useEffect(() => {
    const checkStartupArgs = async () => {
      try {
        const startupLink = await invoke<string | null>('get_startup_deep_link');
        if (startupLink) {
          info(`Startup deep link found: ${startupLink}`);
          // Re-use logic for parsing
          const deepLinkPrefix = 'vrc-worlds-manager://';
          let payload = startupLink;
          if (startupLink.includes(deepLinkPrefix)) {
            const parts = startupLink.split(deepLinkPrefix);
            if (parts.length > 1) {
              payload = parts[1];
            }
          }
          if (payload.endsWith('/')) payload = payload.slice(0, -1);
          try { payload = decodeURIComponent(payload); } catch { }

          // Check for search action
          if (payload.startsWith('search/')) {
            const searchText = payload.substring(7); // Remove 'search/' prefix
            handleSearchAction(searchText);
            return;
          }

          await processUrl(payload);
        }
      } catch (e) {
        error(`Failed to check startup args: ${e}`);
      }
    };

    // Small delay to ensure app is fully ready? unique effect usually fine.
    checkStartupArgs();
  }, []); // Empty dependency array = mount only

  // Deep Link Listener
  useEffect(() => {
    const unlisten = listen<string[]>('deep-link-received', async (event) => {
      // event.payload is vec![arg]
      info(`Deep link received: ${JSON.stringify(event)}`);
      const args = event.payload;
      if (!args || args.length === 0) return;

      for (const arg of args) {
        // Robust parsing: look for our protocol or just http
        let payload = arg;
        const deepLinkPrefix = 'vrc-worlds-manager://';

        if (arg.includes(deepLinkPrefix)) {
          // Split just in case there's garbage before (shouldn't be, but valid defense)
          const parts = arg.split(deepLinkPrefix);
          if (parts.length > 1) {
            payload = parts[1];
          }
        }

        // Basic cleanup
        if (payload.endsWith('/')) payload = payload.slice(0, -1);

        // Try to decode
        try {
          payload = decodeURIComponent(payload);
        } catch (e) {
          // ignore
        }

        info(`Processing potential deep link payload: ${payload}`);

        // Check for search action first
        if (payload.startsWith('search/')) {
          const searchText = payload.substring(7); // Remove 'search/' prefix
          handleSearchAction(searchText);
          return;
        }

        // Heuristic: Does it look like a VRChat world ID or URL?
        const isWorldId = payload.match(/wrld_[a-zA-Z0-9-]{36}/);
        const isUrl = payload.includes('http'); // broad check

        if (isWorldId || isUrl) {
          // Show toast for feedback
          toast.info(t('add-world-dialog:resolving-url'), {
            description: payload.substring(0, 50) + (payload.length > 50 ? '...' : '')
          });
          await processUrl(payload);
          return; // Stop after finding one valid link
        }
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);


  return (
    <>
      {showAddToFolder && (
        <AddToFolderDialog
          selectedWorlds={showAddToFolder}
          currentFolder={currentFolder}
          onClose={() => setPopup('showAddToFolder', null)}
        />
      )}
      {showAddWorld && (
        <AddWorldPopup
          currentFolder={currentFolder}
          onClose={() => setPopup('showAddWorld', false)}
          initialWorldId={
            typeof showAddWorld === 'object'
              ? showAddWorld.initialWorldId
              : undefined
          }
        />
      )}
      {showAdvancedSearchPanel && (
        <AdvancedSearchPanel
          onClose={() => setPopup('showAdvancedSearchPanel', false)}
        />
      )}
      <CreateFolderDialog
        open={!!showCreateFolder}
        onOpenChange={(open) => setPopup('showCreateFolder', open)}
      />
      <DeleteFolderDialog
        folderName={showDeleteFolder}
        onOpenChange={(open) => !open && setPopup('showDeleteFolder', null)}
      />
      {showImportedFolderContainsHidden && (
        <ImportedFolderContainsHidden
          open={!!showImportedFolderContainsHidden}
          worlds={showImportedFolderContainsHidden}
          onOpenChange={(open) =>
            !open && setPopup('showImportedFolderContainsHidden', null)
          }
          onConfirm={async (selectedWorldIds) => {
            try {
              // Unhide all
              await Promise.all(
                selectedWorldIds.map((id) => commands.unhideWorld(id)),
              );
              // Optionally add to current user folder
              if (isUserFolder(currentFolder)) {
                await Promise.all(
                  selectedWorldIds.map((id) =>
                    commands.addWorldToFolder(currentFolder, id),
                  ),
                );
              }
              await refresh();
              toast(t('listview-page:restored-hidden-worlds-title'), {
                description: t(
                  'listview-page:restored-hidden-worlds-description',
                  selectedWorldIds.length,
                ),
              });
              setPopup('showImportedFolderContainsHidden', null);
            } catch (e) {
              error(`[PopupManager] restore hidden during import failed: ${e}`);
              toast(t('general:error-title'), {
                description: t('listview-page:error-restore-hidden-worlds'),
              });
            }
          }}
        />
      )}
      {showShareFolder && (
        <ShareFolderPopup
          open={!!showShareFolder}
          onOpenChange={(open) => setPopup('showShareFolder', open)}
          folderName={currentFolder}
        />
      )}
      {showShareWorld && (
        <ShareWorldPopup
          open={!!showShareWorld}
          onOpenChange={(open) =>
            setPopup('showShareWorld', open ? showShareWorld : null)
          }
          worldId={showShareWorld.worldId}
          worldName={showShareWorld.worldName}
        />
      )}
      {showWorldDetails && (
        <WorldDetailPopup
          open={!!showWorldDetails}
          onOpenChange={(open) => {
            if (!open) setPopup('showWorldDetails', null);
          }}
          worldId={showWorldDetails.id}
          currentFolder={currentFolder}
          dontSaveToLocal={showWorldDetails.dontSaveToLocal}
        />
      )}

      {showDNDConfirm && (
        <AlertDialog
          open={!!showDNDConfirm}
          onOpenChange={(open) => !open && setPopup('showDNDConfirm', null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('general:confirmation')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('add-world-dialog:dnd-confirmation')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPopup('showDNDConfirm', null)}>
                {t('general:cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setPopup('showDNDConfirm', null);
                  // Close other popups might be good but tricky to enumerate all resets.
                  // Ideally we reset everything first?
                  // setPopup('resetPopups', undefined) <- not exposed directly as action but we have resetPopups
                  // But resetPopups is on the store. We can just set showAddWorld and let z-index handle or manually close others?
                  // The prompt said "If popup open: Show confirmation dialog -> Open Add World on confirm"
                  // Ideally we should switch context.
                  // Let's rely on setPopup replacing the view or just opening over it?
                  // React state updates are batched.
                  // Actually usePopupStore has resetPopups. Let's use it.
                  usePopupStore.getState().resetPopups();
                  setPopup('showAddWorld', {
                    initialWorldId: showDNDConfirm.url,
                  });
                }}
              >
                {t('general:ok')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
