import { commands } from '@/lib/bindings';

/**
 * Hides a world that may not be in the library yet.
 *
 * Hiding is a library operation, so a world that came straight from the API
 * (a recommendation, a related-world result) has to be saved first. Once
 * hidden it is in the app-wide "do not show me this" list and can be restored
 * from the hidden folder like any other.
 */
export async function saveAndHideWorld(worldId: string): Promise<void> {
  const saved = await commands.getWorld(worldId, false);
  if (saved.status !== 'ok') throw new Error(saved.error);

  const hidden = await commands.hideWorld(worldId);
  if (hidden.status !== 'ok') throw new Error(hidden.error);
}
