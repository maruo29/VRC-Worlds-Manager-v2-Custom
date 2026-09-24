import { describe, expect, it } from 'vitest';
import {
  COLOR_CEILING,
  COLOR_FLOOR,
  averageColorFeatures,
  colorSimilarity,
  rawColorSimilarity,
} from '@/lib/color-similarity';
import { makeFeatures } from './fixtures';

describe('rawColorSimilarity', () => {
  it('is 1 for identical features and 0 for mismatched bin counts', () => {
    const a = makeFeatures({ bins: { 3: 0.5, 9: 0.5 }, lightness: 0.4 });
    expect(rawColorSimilarity(a, a)).toBeCloseTo(1);
    expect(rawColorSimilarity(a, { ...a, histogram: [1] })).toBe(0);
  });

  it('never reaches zero, because tone terms always contribute', () => {
    const a = makeFeatures({ bins: { 0: 1 }, lightness: 0, saturation: 0 });
    const b = makeFeatures({ bins: { 9: 1 }, lightness: 1, saturation: 1 });
    // Histograms disjoint, tones opposite: only the achromatic remainder
    // (none here) and the tone terms remain, and both are exactly 0.
    expect(rawColorSimilarity(a, b)).toBeCloseTo(0);

    const c = makeFeatures({ bins: { 9: 1 }, lightness: 0.5, saturation: 0.5 });
    expect(rawColorSimilarity(a, c)).toBeGreaterThan(0);
  });
});

describe('colorSimilarity', () => {
  it('rescales the observed floor..ceiling range onto 0..1', () => {
    const a = makeFeatures({ bins: { 3: 1 } });
    expect(colorSimilarity(a, a)).toBe(1);

    const disjoint = makeFeatures({
      bins: { 9: 1 },
      lightness: 0,
      saturation: 0,
    });
    expect(colorSimilarity(a, disjoint)).toBe(0);
    expect(COLOR_FLOOR).toBeLessThan(COLOR_CEILING);
  });
});

describe('averageColorFeatures', () => {
  it('returns null for nothing and the mean otherwise', () => {
    expect(averageColorFeatures([])).toBeNull();

    const a = makeFeatures({ bins: { 0: 1 }, lightness: 0.2, saturation: 0.2 });
    const b = makeFeatures({ bins: { 9: 1 }, lightness: 0.6, saturation: 0.8 });
    const mean = averageColorFeatures([a, b]);
    expect(mean?.histogram[0]).toBeCloseTo(0.5);
    expect(mean?.histogram[9]).toBeCloseTo(0.5);
    expect(mean?.meanLightness).toBeCloseTo(0.4);
    expect(mean?.meanSaturation).toBeCloseTo(0.5);
  });
});
