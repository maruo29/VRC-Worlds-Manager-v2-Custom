import { WorldCardPreview } from '@/components/world-card';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FolderType, SpecialFolders } from '@/types/folders';
import { CardSize, WorldDisplayData } from '@/lib/bindings';
import { useLocalization } from '@/hooks/use-localization';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  Square,
  Check,
  Plus,
  Share2,
  Ban,
  Sparkles,
  Crosshair,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import * as Portal from '@radix-ui/react-portal';
import { info, error } from '@tauri-apps/plugin-log';
import { commands } from '@/lib/bindings';
import { Badge } from '@/components/ui/badge';
import { useFolders } from '../../hook/use-folders';
import { useWorldGrid } from './hook';
import { useSelectedWorldsStore } from '../../hook/use-selected-worlds';
import { useMarqueeSelection } from './use-marquee-selection';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useWorldTourStore } from '../../hook/use-world-tour';
import { useVisitedWorldsStore } from '../../hook/use-visited-worlds';

interface WorldGridProps {
  worlds: WorldDisplayData[];
  // Used for virtualized scrolling
  containerRef: React.RefObject<HTMLDivElement | null>;
  currentFolder: FolderType;
  // Optional interaction flags for special embeds (e.g., selection-only dialog)
  disableCardClick?: boolean;
  alwaysShowSelection?: boolean;
  onWorldUpdate?: (worldId: string, updates: Partial<WorldDisplayData>) => void;
  /** Caption per world id shown under its name, e.g. why it was recommended. */
  extraBadges?: Record<string, string>;
  /** When set, adds a "hide this world" entry to the context menu. */
  onHideWorld?: (worldId: string) => void;
}

export function WorldGrid({
  worlds,
  containerRef,
  currentFolder,
  disableCardClick = false,
  alwaysShowSelection = false,
  onWorldUpdate,
  extraBadges,
  onHideWorld,
}: WorldGridProps) {
  const { t } = useLocalization();

  const startTour = useWorldTourStore((state) => state.start);
  const isTouring = useWorldTourStore((state) => state.status !== 'idle');

  const isVisited = useVisitedWorldsStore((state) => state.isVisited);
  const loadVisited = useVisitedWorldsStore((state) => state.load);
  useEffect(() => {
    loadVisited();
  }, [loadVisited]);

  const {
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
    isFindPage,
    isSpecialFolder,
    isHiddenFolder,
    existingWorldIds,
    handleSetFavorite,
    handleSetPhotographed,
    handleSetShared,
    visibleButtons,
  } = useWorldGrid(currentFolder, worlds, onWorldUpdate);

  const gap = 16;
  const cardWidths: Record<CardSize, number> = {
    Compact: 192, // w-48 = 12rem = 192px
    Normal: 208, // w-52 = 13rem = 208px
    Expanded: 256, // w-64 = 16rem = 256px
    Original: 256, // w-64 = 16rem = 256px
  };
  const cardW = cardWidths[cardSize];

  // Use CSS Grid auto-fill for responsive layout - no manual calculation needed

  const [dialogConfig, setDialogConfig] = useState<{
    type: 'remove' | 'hide';
    worldId: string;
    worldName?: string;
    isOpen: boolean;
  } | null>(null);

  const handleDialogClose = () => {
    setDialogConfig((prev) => (prev ? { ...prev, isOpen: false } : null));
    setTimeout(() => setDialogConfig(null), 150);
  };

  const handleSelect = (worldId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    toggleWorld(worldId);
  };

  const gridElementRef = useRef<HTMLDivElement | null>(null);
  const setSelection = useSelectedWorldsStore((s) => s.setSelection);
  const selectionAtDragStart = useRef<string[]>([]);

  const handleMarqueeChange = useCallback(
    (worldIds: string[], additive: boolean) => {
      const next = additive
        ? Array.from(new Set([...selectionAtDragStart.current, ...worldIds]))
        : worldIds;
      setSelection(currentFolder, next);
    },
    [currentFolder, setSelection],
  );

  const handleMarqueeStart = useCallback(() => {
    selectionAtDragStart.current = Array.from(
      useSelectedWorldsStore.getState().getSelectedWorlds(currentFolder),
    );
    if (!useSelectedWorldsStore.getState().isSelectionMode) {
      useSelectedWorldsStore.getState().toggleSelectionMode();
    }
  }, [currentFolder]);

  const { handleMouseDown, marqueeRect, didDragRef } = useMarqueeSelection({
    gridRef: gridElementRef,
    enabled: !disableCardClick,
    onSelectionChange: handleMarqueeChange,
    onDragStart: handleMarqueeStart,
  });

  const cardHeights: Record<CardSize, number> = {
    Compact: 128, // h-32
    Normal: 192, // h-48
    Expanded: 256, // h-64
    Original: 176, // h-44
  };
  const cardH = cardHeights[cardSize];

  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(1);

  const setGridRef = useCallback(
    (node: HTMLDivElement | null) => {
      gridElementRef.current = node;
      if (containerRef) {
        (
          containerRef as React.MutableRefObject<HTMLDivElement | null>
        ).current = node;
      }
      setGridEl(node);
    },
    [containerRef],
  );

  // Column count has to be derived by hand: the rows are absolutely
  // positioned by the virtualizer, so auto-fill cannot do it for us.
  useEffect(() => {
    if (!gridEl) return;

    const measure = () => {
      const style = getComputedStyle(gridEl);
      const innerWidth =
        gridEl.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      setColumnCount(
        Math.max(1, Math.floor((innerWidth + gap) / (cardW + gap))),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(gridEl);
    return () => observer.disconnect();
  }, [gridEl, cardW, gap]);

  const rowCount = Math.ceil(worlds.length / columnCount);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridEl,
    estimateSize: () => cardH + gap,
    overscan: 5,
  });

  const renderCard = (world: WorldDisplayData) => {
    const isSelected = selectedWorlds.includes(world.worldId);
    return (
      <ContextMenu key={world.worldId}>
        <ContextMenuTrigger asChild>
          <div
            id={world.worldId}
            data-world-card={world.worldId}
            onClick={() => {
              if (disableCardClick) return;
              if (didDragRef.current) return;
              if (isFindPage) {
                // Only set dontSaveToLocal on worlds not already in collection
                handleOpenWorldDetails(
                  world.worldId,
                  !existingWorldIds.has(world.worldId),
                );
              } else {
                // dontSaveToLocal defaults to false when omitted
                handleOpenWorldDetails(world.worldId);
              }
            }}
            className="group relative w-fit h-fit rounded-lg overflow-hidden"
          >
            {isSelected && (
              <div className="absolute inset-0 rounded-lg border-2 border-primary pointer-events-none z-10" />
            )}
            <WorldCardPreview
              size={cardSize}
              world={world}
              caption={extraBadges?.[world.worldId]}
              isVisibleButtons={visibleButtons}
              onToggleFavorite={handleSetFavorite}
              onTogglePhotographed={handleSetPhotographed}
              onToggleShared={handleSetShared}
            />
            {quickFolderEnabled &&
              quickFolderName &&
              !isSelectionMode &&
              !alwaysShowSelection && (
                <div className="absolute top-2 left-2 z-10" data-no-marquee>
                  <div
                    role="checkbox"
                    aria-checked={isInQuickFolder(world)}
                    title={quickFolderName}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleToggleQuickFolder(world);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`w-6 h-6 rounded-md border flex items-center justify-center cursor-pointer backdrop-blur-md transition-colors ${
                      isInQuickFolder(world)
                        ? 'bg-primary/90 border-primary text-primary-foreground'
                        : 'bg-black/40 border-white/60 text-transparent hover:bg-black/60'
                    } ${
                      pendingQuickToggles.has(world.worldId)
                        ? 'opacity-60 pointer-events-none'
                        : ''
                    }`}
                  >
                    <Check className="w-4 h-4" />
                  </div>
                </div>
              )}
            {/* Bottom left, in one row: the right is taken by the card's
                action buttons, and these two can appear together. */}
            <div className="absolute bottom-[70px] left-2 z-10 flex items-center gap-1.5">
              {isFindPage && existingWorldIds.has(world.worldId) && (
                <Badge className="bg-green-100 text-green-700 border-green-300 hover:bg-green-100 hover:border-green-300 cursor-default">
                  {t('world-grid:exists-in-collection')}
                </Badge>
              )}
              {isVisited(world.worldId) && (
                <div
                  className="w-6 h-6 rounded-full bg-black/50 border border-white/50 backdrop-blur-md flex items-center justify-center text-emerald-300"
                  title={t('world-grid:visited')}
                >
                  <Check className="w-4 h-4" />
                </div>
              )}
            </div>
            {(isSelectionMode || alwaysShowSelection) && (
              <div
                className="absolute top-2 left-2 z-10 flex items-center gap-2"
                data-no-marquee
              >
                {isSelected ? (
                  <div
                    className="relative w-10 h-10 flex items-center justify-center cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(world.worldId, e);
                    }}
                  >
                    <Square className="w-5 h-5 z-10 text-primary" />
                    <div className="absolute inset-[12px] bg-background rounded" />
                    <Check className="absolute inset-0 m-auto w-3 h-3 text-primary" />
                  </div>
                ) : (
                  <div
                    className="relative w-10 h-10 flex items-center justify-center cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(world.worldId, e);
                    }}
                  >
                    <Square className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              // The selection when there is one, so a marquee drag over a
              // shortlist tours exactly that shortlist.
              const chosen = selectedWorlds.includes(world.worldId)
                ? worlds.filter((candidate) =>
                    selectedWorlds.includes(candidate.worldId),
                  )
                : [world];
              startTour(chosen);
            }}
            disabled={isTouring}
          >
            <Eye className="w-4 h-4 mr-2" />
            {t('world-tour:visit-in-order')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              handleFindRelated(world);
            }}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {t('world-grid:find-related')}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              handleSetRelatedBase(world);
            }}
          >
            <Crosshair className="w-4 h-4 mr-2" />
            {t('world-grid:set-related-base')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          {isFindPage ? (
            <>
              <ContextMenuItem
                onSelect={(e) => {
                  handleOpenFolderDialog(world.worldId);
                }}
              >
                {t('world-grid:add-title')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={(e) => {
                  handleShareWorld(world.worldId, world.name);
                }}
              >
                <Share2 className="w-4 h-4 mr-2" />
                {t('world-grid:share-world')}
              </ContextMenuItem>
              {onHideWorld && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => {
                      onHideWorld(world.worldId);
                    }}
                    className="text-destructive"
                  >
                    <Ban className="w-4 h-4 mr-2" />
                    {t('general:hide-title')}
                  </ContextMenuItem>
                </>
              )}
            </>
          ) : !isHiddenFolder ? (
            <>
              <ContextMenuItem
                onSelect={(e) => {
                  handleOpenFolderDialog(world.worldId);
                }}
              >
                {t('world-grid:move-title')}
              </ContextMenuItem>
              {!isSpecialFolder && (
                <ContextMenuItem
                  onSelect={(e) => {
                    handleRemoveFromCurrentFolder(world.worldId);
                  }}
                  className="text-destructive"
                >
                  {t('world-grid:remove-title')}
                </ContextMenuItem>
              )}
              <ContextMenuItem
                onSelect={(e) => {
                  const worldsToHide =
                    selectedWorlds.length > 0 &&
                    selectedWorlds.includes(world.worldId)
                      ? Array.from(selectedWorlds)
                      : [world.worldId];
                  const worldNames = worldsToHide
                    .map(
                      (id) => worlds.find((w) => w.worldId === id)?.name || '',
                    )
                    .filter(Boolean);
                  handleHideWorld(worldsToHide, worldNames);
                }}
                className="text-destructive"
              >
                {t('general:hide-title')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={(e) => {
                  handleShareWorld(world.worldId, world.name);
                }}
              >
                <Share2 className="w-4 h-4 mr-2" />
                {t('world-grid:share-world')}
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem
                onSelect={(e) => {
                  const worldsToRestore =
                    selectedWorlds.length > 0 &&
                    selectedWorlds.includes(world.worldId)
                      ? Array.from(selectedWorlds)
                      : [world.worldId];
                  handleRestoreWorld?.(worldsToRestore);
                }}
              >
                {t('world-grid:restore-world')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={(e) => {
                  handleShareWorld(world.worldId, world.name);
                }}
              >
                <Share2 className="w-4 h-4 mr-2" />
                {t('world-grid:share-world')}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <div
      ref={setGridRef}
      onMouseDown={handleMouseDown}
      className="pt-2 relative flex-1 overflow-auto p-4"
    >
      {marqueeRect && (
        <div
          className="pointer-events-none absolute z-30 rounded-sm border border-primary bg-primary/20"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      )}
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
          width: '100%',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const first = virtualRow.index * columnCount;
          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 top-0 w-full justify-items-center"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                gap: `${gap}px`,
              }}
            >
              {worlds
                .slice(first, first + columnCount)
                .map((world) => renderCard(world))}
            </div>
          );
        })}
      </div>

      {/* Portaled AlertDialogs */}
      <Portal.Root>
        {dialogConfig && (
          <AlertDialog
            open={dialogConfig.isOpen}
            onOpenChange={(open) => {
              if (!open) handleDialogClose();
            }}
          >
            <AlertDialogContent onEscapeKeyDown={handleDialogClose}>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {dialogConfig.type === 'remove'
                    ? t('world-grid:remove-title')
                    : t('general:hide-title')}
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  {dialogConfig.type === 'remove' ? (
                    <p>{t('world-grid:remove-description')}</p>
                  ) : (
                    <>
                      <p>{t('world-grid:hide-description')}</p>
                      <p className="text-muted-foreground">
                        {t('world-grid:hide-note')}
                      </p>
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={handleDialogClose}>
                  {t('general:cancel')}
                </AlertDialogCancel>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (dialogConfig.type === 'remove') {
                      removeWorldsFromFolder([dialogConfig.worldId]);
                    } else if (dialogConfig.worldName) {
                      handleHideWorld?.(
                        [dialogConfig.worldId],
                        [dialogConfig.worldName],
                      );
                    }
                    handleDialogClose();
                  }}
                >
                  {dialogConfig.type === 'remove'
                    ? t('world-grid:remove-button')
                    : t('general:hide-title')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </Portal.Root>

      {isFindPage && selectedWorlds.length > 0 && (
        <div
          className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 flex justify-center pointer-events-none w-full"
          // Offset is controlled by CSS variable to avoid hardcoding sidebar width
          style={{ left: 'calc(50% + var(--sidebar-offset, 0px))' }}
        >
          <div className="pointer-events-auto relative inline-block">
            <div
              className="absolute inset-0 rounded-lg bg-background"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
              aria-hidden="true"
            />
            <Button
              variant="default"
              size="lg"
              className="rounded-lg flex items-center gap-2 px-4 py-3 relative"
              onClick={() => handleOpenFolderDialog(selectedWorlds[0])}
            >
              <Plus className="w-5 h-5" />
              <span className="text-md font-semibold">
                {t('world-grid:add-multiple', selectedWorlds.length)}
              </span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
