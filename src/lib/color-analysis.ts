import {
  commands,
  type ColorFeatures,
  type ColorTarget,
  type WorldDisplayData,
} from '@/lib/bindings';

/**
 * Fetching and caching thumbnail colour features, shared by every place that
 * needs them: the settings screen's whole-library analysis and the two
 * discovery pages' top-up of whatever is on screen.
 */

/**
 * Results whose thumbnails get analysed after a discovery fetch.
 *
 * The cached features cover the library, but discovery candidates are by
 * definition worlds the user does not have - so without this the colour term
 * would have nothing to compare against and the setting would appear to do
 * nothing.
 */
export const MAX_COLOR_CANDIDATES = 60;

/** Thumbnails fetched per round trip, so progress moves while it works. */
export const COLOR_BATCH_SIZE = 20;

export type ColorFeatureMap = Record<string, ColorFeatures>;

/**
 * Reads cached features for the given ids into `into`, merging rather than
 * replacing. Never touches the network. Returns false when the read failed.
 */
export async function readColorFeatures(
  worldIds: string[],
  into: ColorFeatureMap,
): Promise<boolean> {
  if (worldIds.length === 0) return true;

  const result = await commands.getColorFeatures(worldIds);
  if (result.status !== 'ok') return false;

  for (const entry of result.data) {
    into[entry.worldId] = entry.features;
  }
  return true;
}

/** The leading `limit` worlds that still have no features and can be fetched. */
export function missingColorTargets(
  worlds: WorldDisplayData[],
  features: ColorFeatureMap,
  limit: number = worlds.length,
): ColorTarget[] {
  return worlds
    .slice(0, limit)
    .filter(
      (world) => !features[world.worldId] && world.thumbnailUrl.length > 0,
    )
    .map((world) => ({ worldId: world.worldId, imageUrl: world.thumbnailUrl }));
}

export interface ColorBatchReport {
  /** Targets handed to the backend so far, including this batch. */
  done: number;
  total: number;
  /** This batch only. */
  analyzed: number;
  failed: number;
  /** Targets in this batch the backend already had cached. */
  skipped: number;
}

export interface AnalyzeColorsOptions {
  batchSize?: number;
  /**
   * Called after every batch, once its features have been merged into the
   * map. Return false to stop early.
   */
  onBatch?: (report: ColorBatchReport) => boolean | void;
}

export interface AnalyzeColorsResult {
  analyzed: number;
  failed: number;
  /** Set when the backend refused a batch outright; the run stops there. */
  error: string | null;
  stoppedEarly: boolean;
}

/**
 * Analyses `targets` a batch at a time, merging each batch's features into
 * `features` before reporting it, so a caller can re-rank as results arrive.
 */
export async function analyzeColorsInBatches(
  targets: ColorTarget[],
  features: ColorFeatureMap,
  options: AnalyzeColorsOptions = {},
): Promise<AnalyzeColorsResult> {
  const { batchSize = COLOR_BATCH_SIZE, onBatch } = options;
  const totals: AnalyzeColorsResult = {
    analyzed: 0,
    failed: 0,
    error: null,
    stoppedEarly: false,
  };

  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);

    const result = await commands.analyzeWorldColors(batch);
    if (result.status !== 'ok') {
      totals.error = result.error;
      totals.stoppedEarly = true;
      break;
    }

    totals.analyzed += result.data.analyzed;
    totals.failed += result.data.failed;

    await readColorFeatures(
      batch.map((target) => target.worldId),
      features,
    );

    const keepGoing = onBatch?.({
      done: Math.min(i + batchSize, targets.length),
      total: targets.length,
      analyzed: result.data.analyzed,
      failed: result.data.failed,
      skipped: result.data.skipped,
    });
    if (keepGoing === false) {
      totals.stoppedEarly = true;
      break;
    }
  }

  return totals;
}
