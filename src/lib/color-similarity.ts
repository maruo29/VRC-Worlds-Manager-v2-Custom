import type { ColorFeatures } from '@/lib/bindings';

/**
 * Comparison of the thumbnail colour features produced by the Rust side.
 *
 * Kept apart from the scoring modules that use it so both the related-worlds
 * ranking and the recommendation ranking can share it without importing each
 * other.
 */

/**
 * Raw similarity never reaches 0: measured against a real library, an utterly
 * unrelated world still scores about 0.21, the median sits at 0.40 and only
 * the top 4% clear 0.70. Left as-is the score is a near-constant bonus handed
 * to every candidate rather than a way of telling them apart, so it is
 * rescaled onto that observed range.
 */
export const COLOR_FLOOR = 0.35;
export const COLOR_CEILING = 0.75;

/** Unscaled overlap, exported for tuning and tests. */
export function rawColorSimilarity(a: ColorFeatures, b: ColorFeatures): number {
  if (a.histogram.length !== b.histogram.length) return 0;

  let intersection = 0;
  for (let i = 0; i < a.histogram.length; i += 1) {
    intersection += Math.min(a.histogram[i], b.histogram[i]);
  }

  const lightness = 1 - Math.abs(a.meanLightness - b.meanLightness);
  const saturation = 1 - Math.abs(a.meanSaturation - b.meanSaturation);

  return 0.6 * intersection + 0.25 * lightness + 0.15 * saturation;
}

/**
 * How alike two thumbnails look, 0..1, with the ever-present baseline removed
 * so that only a genuinely close match scores highly.
 */
export function colorSimilarity(a: ColorFeatures, b: ColorFeatures): number {
  const raw = rawColorSimilarity(a, b);
  const scaled = (raw - COLOR_FLOOR) / (COLOR_CEILING - COLOR_FLOOR);
  return Math.min(Math.max(scaled, 0), 1);
}

/** Mean of several thumbnails, so a multi-seed search has one target. */
export function averageColorFeatures(
  features: ColorFeatures[],
): ColorFeatures | null {
  if (features.length === 0) return null;

  const bins = features[0].histogram.length;
  const histogram = new Array<number>(bins).fill(0);
  let meanLightness = 0;
  let meanSaturation = 0;
  let lightnessSpread = 0;

  for (const entry of features) {
    for (let i = 0; i < bins; i += 1) histogram[i] += entry.histogram[i] ?? 0;
    meanLightness += entry.meanLightness;
    meanSaturation += entry.meanSaturation;
    lightnessSpread += entry.lightnessSpread;
  }

  const count = features.length;
  return {
    histogram: histogram.map((value) => value / count),
    meanLightness: meanLightness / count,
    meanSaturation: meanSaturation / count,
    lightnessSpread: lightnessSpread / count,
  };
}
