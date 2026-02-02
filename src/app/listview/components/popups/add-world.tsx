import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Check, Loader2, Plus } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useFolders } from '../../hook/use-folders';
import { usePopupStore } from '@/app/listview/hook/usePopups/store';
import {
  commands,
  WorldDetails,
  CardSize,
  WorldDisplayData,
} from '@/lib/bindings';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { WorldCardPreview } from '@/components/world-card';
import { useLocalization } from '@/hooks/use-localization';
import { info, error as logError } from '@tauri-apps/plugin-log';
import { useWorlds } from '../../hook/use-worlds';
import { FolderType } from '@/types/folders';

interface AddWorldPopupProps {
  currentFolder: FolderType;
  onClose: () => void;
  initialWorldId?: string;
}

export function AddWorldPopup({ onClose, currentFolder, initialWorldId }: AddWorldPopupProps) {
  const { t } = useLocalization();
  const [worldInput, setWorldInput] = useState<string>(initialWorldId || '');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [previewWorld, setPreviewWorld] = useState<WorldDetails | null>(null);
  const [isDuplicate, setIsDuplicate] = useState<boolean>(false);

  const [existingWorlds, setExistingWorlds] = useState<string[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);

  const { addWorld, getAllWorlds } = useWorlds(currentFolder);
  const { folders } = useFolders();

  useEffect(() => {
    async function fetchWorlds() {
      setIsLoading(true);
      try {
        const worlds = await getAllWorlds();
        setExistingWorlds(worlds.map((world) => world.worldId));
      } catch (e) {
        // handle error if needed
      } finally {
        setIsLoading(false);
      }
    }
    fetchWorlds();

  }, [getAllWorlds]);

  useEffect(() => {
    if (initialWorldId) {
      handleCheckWorldId(initialWorldId);
    }
  }, [initialWorldId]);

  // Parse input to extract world ID
  const parseWorldId = (input: string): string | null => {
    // Remove trailing slashes and whitespace
    const cleaned = input.trim();

    // Extract world ID from URL or direct input
    const worldIdMatch = cleaned.match(
      /wrld_[a-zA-Z0-9]{8}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{12}/,
    );

    if (worldIdMatch) {
      return worldIdMatch[0];
    }

    // If there's a slash, try extracting from a URL pattern
    if (cleaned.includes('/')) {
      // Handle URLs like vrchat.com/home/world/wrld_1234...
      const parts = cleaned.split('/');
      for (const part of parts) {
        if (part.startsWith('wrld_')) {
          // Further clean up any query parameters
          return part.split('?')[0];
        }
      }
    }

    // Check if it's just a simple wrld_ ID
    if (cleaned.startsWith('wrld_')) {
      return cleaned;
    }

    return null;
  };

  const handleCheckWorldId = async (input: string) => {
    setIsLoading(true);
    setError(null);
    setPreviewWorld(null);
    setIsDuplicate(false);

    const parsedWorldId = parseWorldId(input);
    info(`Checking world ID: ${parsedWorldId}`);

    if (!parsedWorldId) {
      setError(
        'Invalid world ID format. Please enter a valid VRChat world ID (wrld_...)',
      );
      logError('Invalid world ID format');
      setIsLoading(false);
      return;
    }

    // Check if the world is already in the collection
    if (existingWorlds.includes(parsedWorldId)) {
      setIsDuplicate(true);
    }

    try {
      // Invoke the Tauri command to fetch world details
      const worldDetails = await commands.checkWorldInfo(parsedWorldId);
      if (!worldDetails) {
        setError('World not found. Please check the ID or URL.');
        setIsLoading(false);
        return;
      }

      if (worldDetails.status === 'ok') {
        setPreviewWorld(worldDetails.data);
      } else {
        setError(worldDetails.error);
      }
    } catch (err) {
      setError(`Failed to fetch world details: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    // If we have a preview world, use its ID
    if (previewWorld) {
      setIsLoading(true);
      try {
        await addWorld(previewWorld.worldId);

        // Add to selected folders
        if (selectedFolders.length > 0) {
          await Promise.all(
            selectedFolders.map((folderName) =>
              commands.addWorldToFolder(folderName, previewWorld.worldId)
            )
          );
        }

        setWorldInput('');
        setPreviewWorld(null);
        setSelectedFolders([]);
        onClose();
      } catch (e) {
        // Error is handled in addWorld mostly, but safeguard here
        logError(`Error adding world: ${e}`);
      } finally {
        setIsLoading(false);
      }
      return;
    }
  };

  const handleCancel = () => {
    setWorldInput('');
    setError(null);
    setPreviewWorld(null);
    setSelectedFolders([]);
    setIsDuplicate(false);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('add-world-dialog:add')}</DialogTitle>
          <DialogDescription>
            {t('add-world-dialog:description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Input
              id="world-id"
              value={worldInput}
              onChange={(e) => setWorldInput(e.target.value)}
              placeholder={t('add-world-dialog:placeholder')}
              className="col-span-3"
              autoFocus
            />
            <Button
              variant="outline"
              className="col-span-1"
              onClick={() => handleCheckWorldId(worldInput)}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('add-world-dialog:check')
              )}
            </Button>
          </div>

          {/* Error message */}
          {error && (
            <Alert variant="destructive" className="col-span-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* World preview card */}
          {previewWorld && (
            <Card className="col-span-4">
              <CardHeader>
                <CardTitle>{t('add-world-dialog:preview')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between">
                  <WorldCardPreview
                    size="Normal"
                    world={{
                      worldId: previewWorld.worldId,
                      name: previewWorld.name,
                      thumbnailUrl: previewWorld.thumbnailUrl,
                      authorName: previewWorld.authorName,
                      favorites: previewWorld.favorites,
                      lastUpdated: previewWorld.lastUpdated,
                      visits: previewWorld.visits,
                      dateAdded: new Date().toISOString(),
                      platform: previewWorld.platform,
                      folders: [],
                      tags: [],
                      capacity: previewWorld.capacity,
                      isPhotographed: false,
                      isShared: false,
                      isFavorite: false,
                    }}
                    onTogglePhotographed={() => { }}
                    onToggleShared={() => { }}
                  />
                  <div className="flex flex-col gap-4">
                    <div>
                      <div className="text-sm font-semibold mb-2">
                        {t('world-detail:details')}
                      </div>
                      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                        <div className="text-gray-500">
                          {' '}
                          {t('add-world-dialog:author')}{' '}
                        </div>
                        <div className="truncate w-[100px]">
                          {previewWorld.authorName}
                        </div>

                        <div className="text-gray-500">
                          {t('world-detail:visits')}
                        </div>
                        <div>{previewWorld.visits}</div>

                        <div className="text-gray-500">
                          {t('world-detail:capacity')}
                        </div>
                        <div>
                          {previewWorld.recommendedCapacity
                            ? `${previewWorld.recommendedCapacity} (${t('world-detail:max')} ${previewWorld.capacity})`
                            : previewWorld.capacity}
                        </div>

                        {previewWorld.publicationDate && (
                          <>
                            <div className="text-gray-500">
                              {t('world-detail:published')}
                            </div>
                            <div>
                              {
                                new Date(previewWorld.publicationDate)
                                  .toISOString()
                                  .split('T')[0]
                              }
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Duplicate warning */}
          {isDuplicate && (
            <Alert className="col-span-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="pt-1">
                {t('add-world-dialog:duplicate-warning')}
              </AlertDescription>
            </Alert>
          )}

          {/* Folder selection */}
          {previewWorld && (
            <div className="flex flex-col gap-2 col-span-4">
              <Label>{t('general:folders')}</Label>
              <div className="border rounded-md p-2 h-32 overflow-y-auto no-webview-scroll-bar">
                <div className="flex flex-wrap gap-2">
                  {folders.length > 0 ? (
                    folders.map((folder) => (
                      <div key={folder.name} className="flex items-center space-x-2 bg-secondary/50 p-1 rounded-md pr-2">
                        <Checkbox
                          id={`folder-${folder.name}`}
                          checked={selectedFolders.includes(folder.name)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedFolders([...selectedFolders, folder.name]);
                            } else {
                              setSelectedFolders(selectedFolders.filter((f) => f !== folder.name));
                            }
                          }}
                        />
                        <label
                          htmlFor={`folder-${folder.name}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer select-none"
                        >
                          {folder.name}
                        </label>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground w-full">{t('general:no-folders')}</div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start pl-2 text-muted-foreground hover:text-foreground h-8"
                    onClick={() => usePopupStore.getState().setPopup('showCreateFolder', true)}
                  >
                    <Plus className="h-3 w-3 mr-2" />
                    <span className="text-xs">{t('app-sidebar:add-folder')}</span>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between">
          <Button variant="outline" onClick={handleCancel}>
            {t('general:cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              isLoading ||
              !worldInput ||
              !!error ||
              !!isDuplicate ||
              !previewWorld
            }
          >
            {t('add-world-dialog:add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
