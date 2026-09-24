import type { WorldDetails, WorldDisplayData } from '@/lib/bindings';

/**
 * Shapes a details record (what the API returns for one world) as the card
 * type the grid renders.
 *
 * The two types are not interchangeable: details know nothing about the
 * user's side of things - folders, when it was saved, whether it is a
 * favourite - so those default to "not in the library" and a caller that
 * knows better passes overrides.
 */
export function detailsToDisplayData(
  details: WorldDetails,
  overrides: Partial<WorldDisplayData> = {},
): WorldDisplayData {
  return {
    worldId: details.worldId,
    name: details.name,
    thumbnailUrl: details.thumbnailUrl,
    authorName: details.authorName,
    favorites: details.favorites,
    lastUpdated: details.lastUpdated,
    publicationDate: details.publicationDate,
    visits: details.visits,
    dateAdded: '',
    platform: details.platform,
    folders: [],
    tags: details.tags,
    capacity: details.capacity,
    isPhotographed: false,
    isShared: false,
    isFavorite: false,
    ...overrides,
  };
}
