export enum SpecialFolders {
  All = 'All Worlds',
  Unclassified = 'Unclassified Worlds',
  Find = 'Find Worlds',
  Recommend = 'Recommended Worlds',
  Status = 'Status Worlds',
  Related = 'Related Worlds',
  Hidden = 'Hidden Worlds',
  NotFolder = 'not-a-folder(if you see this, something is wrong! Please report it)',
}

export type FolderType = SpecialFolders | UserFolder;

export type UserFolder = string;

export function isUserFolder(folder: FolderType): folder is UserFolder {
  return !Object.values(SpecialFolders).includes(folder as SpecialFolders);
}

/**
 * Pages whose worlds come from the API rather than the library. Adding one
 * of their worlds has to save it first, and hiding has to go through the
 * page's own action rather than the library's.
 */
export function isApiBackedFolder(folder: FolderType): boolean {
  return (
    folder === SpecialFolders.Find ||
    folder === SpecialFolders.Recommend ||
    folder === SpecialFolders.Related
  );
}
