import type { ColorFeatures } from '@/lib/bindings';

/**
 * Explicit colour families the user can ask for, as an alternative to the
 * colour preference inferred from their library.
 *
 * The inferred preference is honest but self-reinforcing: a library full of
 * dim, muted chill worlds keeps recommending dim, muted chill worlds, and
 * there is no way to say "today I want somewhere bright and green". These
 * families are that override.
 *
 * The bin layout mirrors color_service.rs: 16 hue bins of 22.5 degrees, then
 * four achromatic bins split by lightness. Pixels below the saturation floor,
 * or very dark or very light, are counted as achromatic rather than as a hue,
 * so a "green" world means visibly green, not merely foliage-shaped.
 */

/** Must match HUE_BINS in color_service.rs. */
const HUE_BINS = 16;

/** Must match ACHROMATIC_BINS in color_service.rs. */
const ACHROMATIC_BINS = 4;

export type ColorPaletteId =
  | 'warm'
  | 'cool'
  | 'green'
  | 'purple'
  | 'mono'
  | 'bright'
  | 'dark';

interface PaletteDefinition {
  id: ColorPaletteId;
  /** Histogram bins that count towards this family, when it is hue-based. */
  bins?: number[];
  /** Otherwise the family is a tone, scored from mean lightness. */
  tone?: 'bright' | 'dark';
}

/**
 * Measured against a real 637-thumbnail cache, the share of pixels each family
 * claims: warm and cool clear 30% on roughly 40% of worlds, monochrome on 46%,
 * while green and purple do so on only 3-4%. The rare two are kept because
 * when they do match they are unmistakable - picking green narrows hard, which
 * is the point of picking it.
 */
export const COLOR_PALETTES: PaletteDefinition[] = [
  // 337.5-90 degrees: red, orange, yellow.
  { id: 'warm', bins: [15, 0, 1, 2, 3] },
  // 157.5-270 degrees: cyan through blue.
  { id: 'cool', bins: [7, 8, 9, 10, 11] },
  // 90-157.5 degrees.
  { id: 'green', bins: [4, 5, 6] },
  // 270-337.5 degrees: violet, magenta, pink.
  { id: 'purple', bins: [12, 13, 14] },
  // Everything the histogram could not call a hue.
  {
    id: 'mono',
    bins: Array.from({ length: ACHROMATIC_BINS }, (_, i) => HUE_BINS + i),
  },
  { id: 'bright', tone: 'bright' },
  { id: 'dark', tone: 'dark' },
];

export const COLOR_PALETTE_IDS: ColorPaletteId[] = COLOR_PALETTES.map(
  (palette) => palette.id,
);

/**
 * Weight of an explicitly chosen palette.
 *
 * Deliberately not the colour-strength setting: that setting governs a
 * background hint, whereas picking a palette from a menu is a direct
 * instruction, and it would be baffling for it to do nothing because a slider
 * elsewhere is off. Sized to sit between the genre and author bonuses, so the
 * chosen colours rise to the top without erasing every other signal.
 */
export const PALETTE_WEIGHT = 2.0;

/**
 * Lightness at which "bright" starts counting and where it is fully bright.
 * The library median sits at 0.345, so these straddle it.
 */
const BRIGHT_FLOOR = 0.25;
const BRIGHT_CEILING = 0.65;

const DARK_FLOOR = 0.45;
const DARK_CEILING = 0.1;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

/** 0..1 for one family: the share of the thumbnail it accounts for. */
function singlePaletteScore(
  features: ColorFeatures,
  palette: PaletteDefinition,
): number {
  if (palette.tone === 'bright') {
    return clamp01(
      (features.meanLightness - BRIGHT_FLOOR) / (BRIGHT_CEILING - BRIGHT_FLOOR),
    );
  }
  if (palette.tone === 'dark') {
    return clamp01(
      (DARK_FLOOR - features.meanLightness) / (DARK_FLOOR - DARK_CEILING),
    );
  }

  // The uncalibrated share of the thumbnail; buildPaletteScorer stretches it
  // against what the candidates actually offer.
  return clamp01(
    (palette.bins ?? []).reduce(
      (sum, bin) => sum + (features.histogram[bin] ?? 0),
      0,
    ),
  );
}

/**
 * Share at which a family is treated as fully matched when the candidates
 * offer nothing better.
 *
 * Families differ enormously in how common they are: measured over a real
 * 637-thumbnail library, the top tenth of worlds are 87% warm, but the top
 * tenth are only 5% green, because foliage photographs dark and desaturated
 * and lands in the achromatic bins. Scored raw, picking green moved the
 * ranking by a sixth of a point and was useless. So each family is stretched
 * against how much of it the candidates actually contain - "greenest
 * available" rather than "at least half green".
 *
 * The floor stops that stretch from amplifying noise: when the best candidate
 * is barely green at all, it must not be promoted as though it were a forest.
 */
const MIN_PALETTE_CEILING = 0.15;

/** Where in the candidates' own range a family counts as fully matched. */
const PALETTE_CALIBRATION_HIGH = 0.9;

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.round(fraction * (sorted.length - 1))];
}

/**
 * Builds a 0..1 scorer for a set of families combined with AND, calibrated
 * against the candidates it will be used on.
 *
 * The geometric mean is the soft version of AND: it still falls to zero the
 * moment one family is absent, but a world that is strongly one and mildly the
 * other beats a world that is mildly both. Note that two hue families share
 * one pixel budget, so "warm and green" can never score near 1 - it does not
 * need to, since the score is only ever compared against other candidates.
 */
export function buildPaletteScorer(
  selected: ColorPaletteId[],
  candidates: ColorFeatures[],
): (features: ColorFeatures) => number {
  const active = selected
    .map((id) => COLOR_PALETTES.find((entry) => entry.id === id))
    .filter((palette): palette is PaletteDefinition => Boolean(palette));

  if (active.length === 0) return () => 0;

  const ceilings = active.map((palette) => {
    const scores = candidates
      .map((features) => singlePaletteScore(features, palette))
      .sort((a, b) => a - b);
    return Math.max(
      percentile(scores, PALETTE_CALIBRATION_HIGH),
      MIN_PALETTE_CEILING,
    );
  });

  return (features: ColorFeatures) => {
    let product = 1;
    for (const [index, palette] of active.entries()) {
      product *= clamp01(
        singlePaletteScore(features, palette) / ceilings[index],
      );
    }
    return product ** (1 / active.length);
  };
}
