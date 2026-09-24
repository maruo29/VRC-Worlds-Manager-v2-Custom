import { commands } from '@/lib/bindings';
import { useRecommendationsStore } from '@/app/listview/hook/use-recommendations';

/**
 * Which page the app opens on.
 *
 * Stored as an id rather than a route so that the preference file survives the
 * pages being moved around, and so a destination that needs more than a URL
 * (the recommendation tabs, the quick folder's user-chosen name) can be
 * resolved here rather than at every call site.
 */
export const STARTUP_PAGES = [
  'all',
  'find',
  'recommend-popular',
  'recommend-new',
  'quick',
] as const;

export type StartupPageId = (typeof STARTUP_PAGES)[number];

export const DEFAULT_STARTUP_PAGE: StartupPageId = 'all';

const ALL_WORLDS_ROUTE = '/listview/folders/special/all';

const ROUTES: Record<StartupPageId, string> = {
  all: ALL_WORLDS_ROUTE,
  find: '/listview/folders/special/find',
  'recommend-popular': '/listview/folders/special/recommend',
  'recommend-new': '/listview/folders/special/recommend',
  quick: '',
};

export function isStartupPageId(value: string): value is StartupPageId {
  return (STARTUP_PAGES as readonly string[]).includes(value);
}

/**
 * The route to open on startup, falling back to the library whenever the
 * stored choice can no longer be honoured - the quick folder having been
 * switched off since it was picked, for instance.
 */
export async function resolveStartupRoute(): Promise<string> {
  const stored = await commands.getStartupPage();
  const id =
    stored.status === 'ok' && isStartupPageId(stored.data)
      ? stored.data
      : DEFAULT_STARTUP_PAGE;

  if (id === 'quick') {
    const [enabled, name] = await Promise.all([
      commands.getQuickFolderEnabled(),
      commands.getQuickFolderName(),
    ]);

    const usable =
      enabled.status === 'ok' &&
      enabled.data &&
      name.status === 'ok' &&
      name.data.length > 0;

    if (!usable) return ALL_WORLDS_ROUTE;
    return `/listview/folders/userFolder?folderName=${encodeURIComponent(name.data)}`;
  }

  // The two recommendation entries share a route and differ only by which tab
  // is showing, so the choice is made before the page mounts and reads it.
  if (id === 'recommend-popular' || id === 'recommend-new') {
    useRecommendationsStore.setState({
      tab: id === 'recommend-new' ? 'new' : 'popular',
    });
  }

  return ROUTES[id];
}
