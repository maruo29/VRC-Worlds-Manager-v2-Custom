import { commands, type WorldDisplayData } from '@/lib/bindings';
import { save, open } from '@tauri-apps/plugin-dialog';

/**
 * A saved copy of a search or related-worlds result, so a set of finds can be
 * put aside and looked at again later without re-running the search (and
 * without the API returning something different in the meantime).
 */
export const SNAPSHOT_FORMAT = 'vrcwm.search-snapshot';
export const SNAPSHOT_VERSION = 1;

export type SnapshotSource = 'find' | 'related';

export interface SearchSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  /** When the search was run, ISO 8601. */
  savedAt: string;
  source: SnapshotSource;
  /** What was searched for, in human readable form. */
  label: string;
  /** Free-form record of the criteria, for reference only. */
  criteria: Record<string, unknown>;
  worlds: WorldDisplayData[];
}

export function buildSnapshot(
  source: SnapshotSource,
  label: string,
  criteria: Record<string, unknown>,
  worlds: WorldDisplayData[],
): SearchSnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    source,
    label,
    criteria,
    worlds,
  };
}

/** Default file name, dated so repeated exports do not collide. */
export function snapshotFileName(source: SnapshotSource, label: string) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const safeLabel = label.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || source;
  return `${source}_${safeLabel}_${stamp}.json`;
}

/** Returns true when the file was written, false when the user cancelled. */
export async function saveSnapshot(snapshot: SearchSnapshot): Promise<boolean> {
  const path = await save({
    defaultPath: snapshotFileName(snapshot.source, snapshot.label),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!path) return false;

  const result = await commands.saveSearchSnapshot(
    path,
    JSON.stringify(snapshot, null, 2),
  );
  if (result.status !== 'ok') throw new Error(result.error);
  return true;
}

/** Returns null when the user cancelled the dialog. */
export async function loadSnapshot(): Promise<SearchSnapshot | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!path || typeof path !== 'string') return null;

  const result = await commands.loadSearchSnapshot(path);
  if (result.status !== 'ok') throw new Error(result.error);

  const parsed = JSON.parse(result.data) as SearchSnapshot;
  if (parsed?.format !== SNAPSHOT_FORMAT || !Array.isArray(parsed.worlds)) {
    throw new Error('Not a search snapshot file');
  }
  return parsed;
}
