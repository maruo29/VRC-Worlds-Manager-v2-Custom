'use client';

import { SaturnIcon } from '../../../components/icons/saturn-icon';
import { GearIcon } from '../../../components/icons/gear-icon';
import { Info, FileQuestion, History, Plus, Folder } from 'lucide-react';
import { SpecialFolders } from '@/types/folders';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { FolderData } from '@/lib/bindings';
import { useState, useEffect, useRef } from 'react';
import { useLocalization } from '@/hooks/use-localization';

import { Separator } from '@/components/ui/separator';

import { SidebarGroup } from '@/components/ui/sidebar';
import { error } from '@tauri-apps/plugin-log';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useFolders } from '@/app/listview/hook/use-folders';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { usePopupStore } from '../hook/usePopups/store';
import { Palette } from 'lucide-react';

// Preset colors for folder tags
const FOLDER_COLORS = [
  { name: 'Purple', value: '#a855f7' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Gray', value: '#6b7280' },
];

const sidebarStyles = {
  container:
    'flex flex-col h-screen w-full border-r border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
  header: 'flex h-14 items-center px-6',
  nav: 'flex-1 space-y-0.5 p-1 pb-0',
  link: 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all hover:bg-accent/50 hover:text-accent-foreground',
  activeLink: 'bg-accent/60 text-accent-foreground',
  footer: 'sticky bottom-0 left-0 mt-auto p-1 pb-2',
};

const SIDEBAR_CLASS = 'app-sidebar';

interface AppSidebarProps {
  sidebarWidth: number;
}

export function AppSidebar({ sidebarWidth }: AppSidebarProps) {
  const { t } = useLocalization();
  const { folders, moveFolder, createFolder, deleteFolder, renameFolder, setFolderColor } =
    useFolders();
  const setPopup = usePopupStore((state) => state.setPopup);

  const [localFolders, setLocalFolders] = useState<FolderData[]>(folders);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Update local folders when prop changes
  useEffect(() => {
    setLocalFolders(folders);
  }, [folders]);

  const handleDragEnd = async (result: any) => {
    if (!result.destination) return;

    const { source, destination } = result;
    const newFolders = Array.from(localFolders);
    const [movedFolder] = newFolders.splice(source.index, 1);
    newFolders.splice(destination.index, 0, movedFolder);

    // Update local state immediately
    setLocalFolders(newFolders);

    try {
      moveFolder(movedFolder.name, destination.index);
    } catch (e) {
      // Revert on error
      setLocalFolders(folders);
      error(`Error moving folder: ${e}`);
    }
  };

  const handleRename = async (folder: string) => {
    const oldName = folder;
    const newName = newFolderName;
    renameFolder(oldName, newName).then(() => {
      setEditingFolder(null);
      setNewFolderName('');
      // If currently viewing this user folder, update the URL so the page title reflects the rename
      const currentFolder = searchParams?.get('folderName');
      if (
        pathname === '/listview/folders/userFolder' &&
        currentFolder === oldName
      ) {
        router.replace(
          `/listview/folders/userFolder?folderName=${encodeURIComponent(newName)}`,
        );
      }
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F8 key handler - prevent focus loss and text selection
      if (e.key === 'F8' && document.activeElement === inputRef.current) {
        // Save current text length to restore cursor position later
        const textLength = inputRef.current?.value.length || 0;

        // Schedule focus restoration after the F8 key event completes
        setTimeout(() => {
          if (inputRef.current) {
            // Restore focus
            inputRef.current.focus();

            // Place cursor at the end of text without selection
            inputRef.current.setSelectionRange(textLength, textLength);
          }
        }, 10);
      }
    };

    // Add global key listener
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Increase the timeout for focusing when editing starts
  useEffect(() => {
    if (editingFolder) {
      // Use a longer timeout to ensure all other events have been processed
      const focusTimer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Optionally select all text for convenience
          inputRef.current.select();
        }
      }, 50); // Increased from 10ms to 50ms

      // Clean up timer on component unmount or when editingFolder changes
      return () => clearTimeout(focusTimer);
    }
  }, [editingFolder]);

  // Improve the click outside handler to be more precise
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Skip if no active editing or during composition
      if (!editingFolder || isComposing) return;

      // Get the clicked element
      const target = event.target as HTMLElement;

      // Check if click is inside the input or its parent container
      if (
        inputRef.current &&
        (inputRef.current === target ||
          inputRef.current.contains(target) ||
          target.closest('.folder-edit-container'))
      ) {
        // Add this class to your container
        return;
      }

      // If we click anywhere else, cancel editing
      setEditingFolder(null);
      setNewFolderName('');
    };

    // Use mousedown instead of click for better timing
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [editingFolder, isComposing]); // Add isComposing to deps

  return (
    <aside className={cn(sidebarStyles.container, SIDEBAR_CLASS)}>
      <header className={sidebarStyles.header}>
        <div className="flex items-center gap-1">
          <h2 className="text-lg font-semibold">VRC Worlds Manager</h2>
          <h3 className="text-sm text-muted-foreground">v2</h3>
        </div>
      </header>
      <Separator className="" />

      <nav className={sidebarStyles.nav}>
        <SidebarGroup>
          <div
            className={`
              px-3 py-2 text-sm font-medium rounded-lg cursor-pointer
              overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-3
              ${pathname === '/listview/folders/special/find' ? sidebarStyles.activeLink : 'hover:bg-accent/50 hover:text-accent-foreground'}
            `}
            onClick={() => {
              if (pathname === '/listview/folders/special/find') return;
              router.push('/listview/folders/special/find');
            }}
          >
            <History className="h-5 w-5" />
            <span className="text-sm font-medium">
              {t('general:find-worlds')}
            </span>
          </div>
        </SidebarGroup>
        <Separator className="my-2" />
        <SidebarGroup>
          <div
            className={`
              px-3 py-2 text-sm font-medium rounded-lg cursor-pointer
              overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-3
              ${pathname === '/listview/folders/special/all' ? sidebarStyles.activeLink : 'hover:bg-accent/50 hover:text-accent-foreground'}
            `}
            onClick={() => {
              if (pathname === '/listview/folders/special/all') return;
              router.push('/listview/folders/special/all');
            }}
          >
            <SaturnIcon className="h-[18px] w-[18px]" />
            <span className="text-sm font-medium">
              {t('general:all-worlds')}
            </span>
          </div>

          <div
            className={`
              px-3 py-2 text-sm font-medium rounded-lg cursor-pointer
              overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-3
              ${pathname === '/listview/folders/special/unclassified'
                ? sidebarStyles.activeLink
                : 'hover:bg-accent/50 hover:text-accent-foreground'
              }
            `}
            onClick={() => {
              if (pathname === '/listview/folders/special/unclassified') return;
              router.push('/listview/folders/special/unclassified');
            }}
          >
            <FileQuestion className="h-5 w-5" />
            <span className="text-sm font-medium">
              {t('general:unclassified-worlds')}
            </span>
          </div>

          <div
            className={`
              px-3 py-2 text-sm font-medium rounded-lg cursor-pointer
              overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-3
              ${pathname === '/listview/folders/special/folder-view'
                ? sidebarStyles.activeLink
                : 'hover:bg-accent/50 hover:text-accent-foreground'
              }
            `}
            onClick={() => {
              if (pathname === '/listview/folders/special/folder-view') return;
              router.push('/listview/folders/special/folder-view');
            }}
          >
            <Folder className="h-5 w-5" />
            <span className="text-sm font-medium">
              {t('general:folder-view')}
            </span>
          </div>
        </SidebarGroup>
        <Separator className="my-2" />
        <SidebarGroup>
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="text-sm font-medium">{t('general:folders')}</span>
          </div>
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="folders">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="h-[calc(100vh-417px)] overflow-x-clip overflow-y-scroll no-webview-scroll-bar pl-8"
                >
                  {localFolders.map((folder, index) => (
                    <Draggable
                      key={folder.name}
                      draggableId={folder.name}
                      index={index}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          style={{
                            ...provided.draggableProps.style,
                            width: `${sidebarWidth - 60}px`,
                          }}
                          className={`
                            px-3 py-2 text-sm font-medium rounded-lg cursor-grab
                            overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-3
                            ${snapshot.isDragging ? 'bg-accent shadow-lg' : ''}
                            ${pathname ===
                              `/listview/folders/userFolder?folderName=${folder.name}`
                              ? sidebarStyles.activeLink
                              : 'hover:bg-accent/50 hover:text-accent-foreground'
                            }
                          `}
                        >
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              <div
                                className="flex items-center w-full cursor-pointer"
                                onClick={() => {
                                  if (
                                    pathname ===
                                    `/listview/folders/userFolder?folderName=${folder.name}`
                                  )
                                    return;
                                  router.push(
                                    `/listview/folders/userFolder?folderName=${folder.name}`,
                                  );
                                }}
                              >
                                {editingFolder === folder.name ? (
                                  <Input
                                    ref={inputRef}
                                    value={newFolderName}
                                    onChange={(e) =>
                                      setNewFolderName(e.target.value)
                                    }
                                    onFocus={() => {
                                      // Clear any pending blur actions
                                      if (blurTimeoutRef.current) {
                                        clearTimeout(blurTimeoutRef.current);
                                        blurTimeoutRef.current = null;
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      // Prevent event bubbling when typing
                                      e.stopPropagation();

                                      if (
                                        e.key === 'Enter' &&
                                        !composingRef.current
                                      ) {
                                        e.preventDefault();
                                        handleRename(folder.name);
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setEditingFolder(null);
                                        setNewFolderName('');
                                      }
                                    }}
                                    onClick={(e) => {
                                      // Prevent click from bubbling to parent
                                      e.preventDefault();
                                      e.stopPropagation();
                                    }}
                                    onCompositionStart={() => {
                                      composingRef.current = true;
                                      setIsComposing(true);
                                    }}
                                    onCompositionEnd={() => {
                                      composingRef.current = false;

                                      // Use a longer timeout for IME operations
                                      setTimeout(() => {
                                        if (inputRef.current) {
                                          const textLength =
                                            inputRef.current.value.length;
                                          inputRef.current.focus();
                                          inputRef.current.setSelectionRange(
                                            textLength,
                                            textLength,
                                          );
                                        }
                                        setIsComposing(false);
                                      }, 150);
                                    }}
                                    className="h-6 py-0 w-full folder-edit-container" // Ensure no horizontal overflow
                                    autoFocus={true}
                                  />
                                ) : (
                                  <span className="flex items-center w-full">
                                    <span className="font-mono text-xs text-muted-foreground w-10 text-left flex-shrink-0">
                                      ({folder.world_count})
                                    </span>
                                    <span className="truncate flex-1 pl-1 cursor-default">
                                      {folder.name}
                                    </span>
                                  </span>
                                )}
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem
                                onClick={() => {
                                  // First set the editing state
                                  setEditingFolder(folder.name);
                                  setNewFolderName(folder.name);
                                  // Use double RAF to ensure DOM has updated and context menu has closed
                                  requestAnimationFrame(() => {
                                    requestAnimationFrame(() => {
                                      inputRef.current?.focus();
                                      inputRef.current?.select(); // Also select the text for convenience
                                    });
                                  });
                                }}
                              >
                                {t('app-sidebar:rename')}
                              </ContextMenuItem>
                              <ContextMenuSub>
                                <ContextMenuSubTrigger className="flex items-center gap-2">
                                  <Palette className="w-4 h-4" />
                                  <span>{t('app-sidebar:folder-color')}</span>
                                </ContextMenuSubTrigger>
                                <ContextMenuSubContent className="w-48">
                                  <ContextMenuItem
                                    onClick={() => setFolderColor(folder.name, null)}
                                  >
                                    <span className="flex items-center gap-2">
                                      <span className="w-4 h-4 rounded-full border border-border bg-transparent" />
                                      Default
                                    </span>
                                  </ContextMenuItem>
                                  {FOLDER_COLORS.map((color) => (
                                    <ContextMenuItem
                                      key={color.name}
                                      onClick={() =>
                                        setFolderColor(folder.name, color.value)
                                      }
                                    >
                                      <span className="flex items-center gap-2">
                                        <span
                                          className="w-4 h-4 rounded-full"
                                          style={{ backgroundColor: color.value }}
                                        />
                                        {color.name}
                                      </span>
                                    </ContextMenuItem>
                                  ))}
                                </ContextMenuSubContent>
                              </ContextMenuSub>
                              <ContextMenuItem
                                className="text-destructive"
                                onClick={() => deleteFolder(folder.name)}
                              >
                                {t('general:delete')}
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
          <Separator className="my-2" />
          <div
            className={`${sidebarStyles.link} cursor-pointer`}
            onClick={() => {
              setPopup('showCreateFolder', true);
            }}
          >
            <Plus className="h-5 w-5" />
            {t('app-sidebar:add-folder')}
          </div>
        </SidebarGroup>
      </nav>
      <Separator />
      <footer className={sidebarStyles.footer}>
        <SidebarGroup>
          <div
            className={`
              px-3 py-2 cursor-pointer text-sm font-medium rounded-lg overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-3
              ${pathname === `/listview/about`
                ? sidebarStyles.activeLink
                : 'hover:bg-accent/50 hover:text-accent-foreground'
              }
            `}
            onClick={() => {
              if (pathname === `/listview/about`) return;
              router.push('/listview/about');
            }}
          >
            <Info className="h-5 w-5" />
            <span>{t('app-sidebar:about')}</span>
          </div>
          <div
            className={`
              px-3 py-2 cursor-pointer text-sm font-medium rounded-lg overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-3
              ${pathname === `/listview/settings`
                ? sidebarStyles.activeLink
                : 'hover:bg-accent/50 hover:text-accent-foreground'
              }
            `}
            onClick={() => {
              if (pathname === `/listview/settings`) return;
              router.push('/listview/settings');
            }}
          >
            <div className="h-5 w-5 flex items-center justify-center">
              <GearIcon className="h-[18px] w-[18px]" />
            </div>
            <span>{t('general:settings')}</span>
          </div>
        </SidebarGroup>
      </footer>
    </aside>
  );
}
