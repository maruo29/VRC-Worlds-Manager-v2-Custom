import { Camera, Share2, Star } from 'lucide-react';
import Image from 'next/image';
import QPc from '@/../public/icons/VennColorQPc.svg';
import QPcQ from '@/../public/icons/VennColorQPcQ.svg';
import QQ from '@/../public/icons/VennColorQQ.svg';
import { Platform } from '@/types/worlds';
import { CardSize, WorldDisplayData } from '@/lib/bindings';
import { useLocalization } from '@/hooks/use-localization';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useFolders } from '@/app/listview/hook/use-folders';

// Folder tags component with 2-line max and overflow indicator
function FolderTags({ folders, size }: { folders: string[]; size: CardSize }) {
  const { folders: allFolders } = useFolders();

  if (!folders || folders.length === 0) return null;

  const tagSizeClasses: Record<CardSize, string> = {
    Compact: 'text-[10px] px-1.5 py-0.5',
    Normal: 'text-xs px-2 py-0.5',
    Expanded: 'text-xs px-2 py-0.5',
    Original: 'text-xs px-2 py-0.5',
  };

  return (
    <div className="relative overflow-hidden" style={{ maxHeight: '3.5em' }}>
      <div className="flex flex-wrap gap-1">
        {folders.map((folderName, index) => {
          const folderData = allFolders.find((f) => f.name === folderName);
          // @ts-ignore
          const bgColor = folderData?.color || '#9333ea'; // Default purple
          return (
            <span
              key={index}
              className={`inline-block text-white rounded ${tagSizeClasses[size]} whitespace-nowrap`}
              style={{ backgroundColor: bgColor }}
            >
              {folderName}
            </span>
          );
        })}
      </div>
      {folders.length > 3 && (
        <div className="absolute bottom-0 right-0 bg-gradient-to-l from-card via-card to-transparent pl-4 pr-1 text-muted-foreground text-xs">
          …
        </div>
      )}
    </div>
  );
}

interface WorldCardPreviewProps {
  size: CardSize;
  world: WorldDisplayData;
  onToggleFavorite?: (worldId: string, current: boolean) => void;
  onTogglePhotographed?: (worldId: string, current: boolean) => void;
  onToggleShared?: (worldId: string, current: boolean) => void;
}

export function WorldCardPreview(props: WorldCardPreviewProps) {
  const { size, world, onToggleFavorite, onTogglePhotographed, onToggleShared } = props;
  const { t } = useLocalization();
  const sizeClasses: Record<CardSize, string> = {
    Compact: 'w-48 h-32',
    Normal: 'w-52 h-48',
    Expanded: 'w-64 h-64',
    Original: 'w-64 h-44',
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onToggleFavorite?.(world.worldId, !world.isFavorite);
  };

  const handlePhotographedClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onTogglePhotographed?.(world.worldId, !world.isPhotographed);
  };

  const handleSharedClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onToggleShared?.(world.worldId, !world.isShared);
  };

  const preventPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className={`border rounded-lg shadow hover:shadow-md transition-all duration-300 ${sizeClasses[size]} bg-card text-card-foreground overflow-hidden flex flex-col`}
    >
      <div className="relative w-full h-2/3 shrink-0">
        <div className="absolute top-2 right-2 z-10 bg-black/50 rounded-full p-1">
          {world.platform == Platform.CrossPlatform ? (
            <Image
              src={QPcQ}
              alt={t('world-card:cross-platform')}
              width={24}
              height={24}
              loading="lazy"
            />
          ) : world.platform == Platform.PC ? (
            <Image
              src={QPc}
              alt={t('world-card:pc')}
              width={24}
              height={24}
              loading="lazy"
            />
          ) : (
            <Image
              src={QQ}
              alt={t('world-card:quest')}
              width={24}
              height={24}
              loading="lazy"
            />
          )}
        </div>

        {/* Status flags overlay */}
        <div className="absolute bottom-2 right-2 z-10 flex gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`p-1.5 rounded-full cursor-pointer backdrop-blur-md transition-colors ${world.isFavorite ? 'bg-yellow-500/80 text-white hover:bg-yellow-600/90' : 'bg-black/40 text-white/70 hover:bg-black/60 hover:text-white'}`}
                  onClick={handleFavoriteClick}
                  onDoubleClick={preventPropagation}
                  onMouseDown={preventPropagation}
                >
                  <Star className="w-3.5 h-3.5" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('world-card:favorite')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`p-1.5 rounded-full cursor-pointer backdrop-blur-md transition-colors ${world.isPhotographed ? 'bg-green-500/80 text-white hover:bg-green-600/90' : 'bg-black/40 text-white/70 hover:bg-black/60 hover:text-white'}`}
                  onClick={handlePhotographedClick}
                  onDoubleClick={preventPropagation}
                  onMouseDown={preventPropagation}
                >
                  <Camera className="w-3.5 h-3.5" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('world-card:photographed')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`p-1.5 rounded-full cursor-pointer backdrop-blur-md transition-colors ${world.isShared ? 'bg-blue-500/80 text-white hover:bg-blue-600/90' : 'bg-black/40 text-white/70 hover:bg-black/60 hover:text-white'}`}
                  onClick={handleSharedClick}
                  onDoubleClick={preventPropagation}
                  onMouseDown={preventPropagation}
                >
                  <Share2 className="w-3.5 h-3.5" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('world-card:shared')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <img
          src={world.thumbnailUrl}
          alt={world.name}
          className={`w-full h-full object-cover`}
          draggable="false"
          loading="lazy"
        />
      </div>

      {/* Various size renderings... */}

      {size === 'Compact' && (
        <div className="p-2 flex-1 flex flex-col justify-center overflow-hidden">
          <h3 className="font-medium truncate text-sm">{world.name}</h3>
          <FolderTags folders={world.folders} size={size} />
        </div>
      )}

      {size === 'Normal' && (
        <div className="p-2 space-y-1 flex-1 flex flex-col justify-center overflow-hidden">
          <h3 className="font-medium truncate text-base">{world.name}</h3>
          <FolderTags folders={world.folders} size={size} />
        </div>
      )}

      {size === 'Expanded' && (
        <div className="p-2 space-y-1 flex-1 flex flex-col overflow-hidden">
          <h3 className="font-medium truncate text-lg">{world.name}</h3>
          <FolderTags folders={world.folders} size={size} />
        </div>
      )}

      {size === 'Original' && (
        <div className="p-2 flex-1 flex flex-col overflow-hidden">
          <h3 className="font-medium truncate text-base">{world.name}</h3>
          <FolderTags folders={world.folders} size={size} />
        </div>
      )}
    </div>
  );
}
