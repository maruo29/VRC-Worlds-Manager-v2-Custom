import type { ColorFeatures, WorldDisplayData } from '@/lib/bindings';

/** Must match HUE_BINS + ACHROMATIC_BINS in color_service.rs. */
export const TOTAL_BINS = 20;

let counter = 0;

export function makeWorld(
  overrides: Partial<WorldDisplayData> = {},
): WorldDisplayData {
  counter += 1;
  return {
    worldId: `wrld_${String(counter).padStart(8, '0')}-0000-0000-0000-000000000000`,
    name: `World ${counter}`,
    thumbnailUrl: 'https://api.vrchat.cloud/api/1/file/file_x/1/file',
    authorName: 'author',
    favorites: 0,
    lastUpdated: '2020-01-01T00:00:00.000Z',
    publicationDate: null,
    visits: 0,
    dateAdded: '',
    platform: 'PC',
    folders: [],
    tags: [],
    capacity: 16,
    isPhotographed: false,
    isShared: false,
    isFavorite: false,
    ...overrides,
  };
}

/** Author tags in the raw VRChat form. */
export function tagged(...tags: string[]): string[] {
  return tags.map((tag) => `author_tag_${tag}`);
}

/**
 * A histogram with the given bins filled (shares summing to 1, the remainder
 * going to the mid-lightness achromatic bin) plus mean tone values.
 */
export function makeFeatures(options: {
  bins?: Record<number, number>;
  lightness?: number;
  saturation?: number;
}): ColorFeatures {
  const histogram = new Array<number>(TOTAL_BINS).fill(0);
  let used = 0;
  for (const [bin, share] of Object.entries(options.bins ?? {})) {
    histogram[Number(bin)] = share;
    used += share;
  }
  // Whatever is left is grey, so every histogram still sums to one.
  histogram[17] += Math.max(0, 1 - used);

  return {
    histogram,
    meanLightness: options.lightness ?? 0.5,
    meanSaturation: options.saturation ?? 0.5,
    lightnessSpread: 0.2,
  };
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO timestamp this many days before `now`. */
export function daysAgo(days: number, now: number): string {
  return new Date(now - days * DAY_MS).toISOString();
}
