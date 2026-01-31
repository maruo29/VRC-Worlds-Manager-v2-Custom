'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocalization } from '@/hooks/use-localization';
import { useFolders } from '@/app/listview/hook/use-folders';
import { commands, WorldDisplayData } from '@/lib/bindings';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Folder, ChevronDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { info, error } from '@tauri-apps/plugin-log';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type FolderSize = 'small' | 'medium' | 'large';

interface FolderCardData {
    name: string;
    worldCount: number;
    thumbnail: string | null;
    color: string | null;
}

const SIZE_CONFIG: Record<FolderSize, { cardWidth: string; imageHeight: string; fontSize: string }> = {
    small: { cardWidth: 'w-32', imageHeight: 'h-20', fontSize: 'text-xs' },
    medium: { cardWidth: 'w-48', imageHeight: 'h-32', fontSize: 'text-sm' },
    large: { cardWidth: 'w-64', imageHeight: 'h-44', fontSize: 'text-base' },
};

export default function FolderViewPage() {
    const { t } = useLocalization();
    const router = useRouter();
    const { folders, isLoading: isFoldersLoading, moveFolder } = useFolders();
    const [folderCards, setFolderCards] = useState<FolderCardData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [viewSize, setViewSize] = useState<FolderSize>('medium');
    const [activeId, setActiveId] = useState<string | null>(null);

    // Initialize sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // Require 8px movement before drag starts
            },
        })
    );

    // Load folder thumbnails
    useEffect(() => {
        const loadFolderData = async () => {
            if (!folders || folders.length === 0) {
                setFolderCards([]);
                setIsLoading(false);
                return;
            }

            // If we already have cards and the length matches, we might want to just update data
            // but for simple sync let's reload if length differs or just initial load
            // To prevent flickering on reorder, we shouldn't wipe state if we have data
            if (folderCards.length === 0) setIsLoading(true);

            const cardDataPromises = folders.map(async (folder) => {
                try {
                    // Check if we already have this folder's data cached in state to avoid reloading formatting
                    const existing = folderCards.find(c => c.name === folder.name);

                    // Get worlds in this folder to find a thumbnail
                    // optimization: only fetch if we don't have it or if we want fresh data
                    const result = await commands.getWorlds(folder.name);
                    let thumbnail = null;
                    let worldCount = 0;

                    if (result.status === 'ok') {
                        worldCount = result.data.length;
                        if (result.data.length > 0) {
                            thumbnail = result.data[0].thumbnailUrl;
                        }
                    }

                    return {
                        name: folder.name,
                        worldCount,
                        thumbnail,
                        color: folder.color ?? null,
                    };
                } catch (e) {
                    error(`Failed to load folder data for ${folder.name}: ${e}`);
                    return {
                        name: folder.name,
                        worldCount: 0,
                        thumbnail: null,
                        color: folder.color ?? null,
                    };
                }
            });

            const cardData = await Promise.all(cardDataPromises);
            setFolderCards(cardData);
            setIsLoading(false);
        };

        loadFolderData();
    }, [folders]);

    const handleFolderClick = (folderName: string) => {
        router.push(`/listview/folders/userFolder?folderName=${encodeURIComponent(folderName)}`);
    };

    const handleDragStart = (event: React.DragEvent | any) => {
        const { active } = event;
        setActiveId(active.id);
    };

    const handleDragEnd = (event: React.DragEvent | any) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        if (active.id !== over.id) {
            const oldIndex = folderCards.findIndex((f) => f.name === active.id);
            const newIndex = folderCards.findIndex((f) => f.name === over.id);

            setFolderCards((items) => {
                return arrayMove(items, oldIndex, newIndex);
            });

            const folderToMove = folderCards[oldIndex];

            // Call backend
            moveFolder(folderToMove.name, newIndex).catch((e) => {
                console.error('Failed to move folder', e);
                // Sync functionality in useFolders will handle revalidation
            });
        }
    };

    const sizeConfig = SIZE_CONFIG[viewSize];

    const activeFolder = activeId ? folderCards.find(f => f.name === activeId) : null;

    return (
        <div className="p-4 flex flex-col h-full min-h-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl font-bold">{t('general:folder-view')}</h1>

                {/* Size selector */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2">
                            {t(`folder-view:size-${viewSize}`)}
                            <ChevronDown className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => setViewSize('small')}>
                            {t('folder-view:size-small')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setViewSize('medium')}>
                            {t('folder-view:size-medium')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setViewSize('large')}>
                            {t('folder-view:size-large')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Folder Grid */}
            <div className="flex-1 overflow-auto">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    {isLoading && folderCards.length === 0 ? (
                        <div className="flex flex-wrap gap-4">
                            {[...Array(6)].map((_, i) => (
                                <Skeleton key={i} className={`${sizeConfig.cardWidth} h-40 rounded-lg`} />
                            ))}
                        </div>
                    ) : folderCards.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-center">
                            <Folder className="h-12 w-12 text-muted-foreground mb-2" />
                            <p className="text-muted-foreground">{t('folder-view:no-folders')}</p>
                        </div>
                    ) : (
                        <SortableContext
                            items={folderCards.map(f => f.name)}
                            strategy={rectSortingStrategy}
                        >
                            <div className="flex flex-wrap gap-4">
                                {folderCards.map((folder) => (
                                    <FolderCardComponent
                                        key={folder.name}
                                        folder={folder}
                                        sizeConfig={sizeConfig}
                                        onClick={() => handleFolderClick(folder.name)}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    )}

                    <DragOverlay>
                        {activeFolder ? (
                            <div style={{ opacity: 0.8 }}>
                                <Card
                                    className={`${sizeConfig.cardWidth} cursor-grabbing overflow-hidden shadow-xl`}
                                    style={{
                                        borderColor: activeFolder.color ?? undefined,
                                        borderWidth: activeFolder.color ? '2px' : undefined,
                                    }}
                                >
                                    <div className={`${sizeConfig.imageHeight} bg-muted relative overflow-hidden`}>
                                        {activeFolder.thumbnail ? (
                                            <img
                                                src={activeFolder.thumbnail}
                                                alt={activeFolder.name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <Folder
                                                    className="h-8 w-8 text-muted-foreground"
                                                    style={{ color: activeFolder.color ?? undefined }}
                                                />
                                            </div>
                                        )}
                                        <div className="absolute bottom-1 right-1 bg-background/80 px-2 py-0.5 rounded text-xs font-medium">
                                            {activeFolder.worldCount}
                                        </div>
                                    </div>
                                    <CardContent className="p-2">
                                        <p className={`${sizeConfig.fontSize} font-medium truncate`} title={activeFolder.name}>
                                            {activeFolder.name}
                                        </p>
                                    </CardContent>
                                </Card>
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            </div>
        </div>
    );
}

interface FolderCardProps {
    folder: FolderCardData;
    sizeConfig: { cardWidth: string; imageHeight: string; fontSize: string };
    onClick: () => void;
}

function FolderCardComponent({ folder, sizeConfig, onClick }: FolderCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: folder.name });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <Card
                className={`${sizeConfig.cardWidth} cursor-pointer hover:bg-accent/50 transition-colors overflow-hidden`}
                onClick={onClick}
                style={{
                    borderColor: folder.color ?? undefined,
                    borderWidth: folder.color ? '2px' : undefined,
                }}
            >
                {/* Thumbnail */}
                <div className={`${sizeConfig.imageHeight} bg-muted relative overflow-hidden`}>
                    {folder.thumbnail ? (
                        <img
                            src={folder.thumbnail}
                            alt={folder.name}
                            className="w-full h-full object-cover pointer-events-none"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <Folder
                                className="h-8 w-8 text-muted-foreground"
                                style={{ color: folder.color ?? undefined }}
                            />
                        </div>
                    )}
                    {/* World count badge */}
                    <div className="absolute bottom-1 right-1 bg-background/80 px-2 py-0.5 rounded text-xs font-medium">
                        {folder.worldCount}
                    </div>
                </div>

                {/* Folder name */}
                <CardContent className="p-2">
                    <p className={`${sizeConfig.fontSize} font-medium truncate`} title={folder.name}>
                        {folder.name}
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
