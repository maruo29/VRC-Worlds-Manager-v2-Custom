import { describe, expect, it } from 'vitest';
import { COLOR_PALETTE_IDS, buildPaletteScorer } from '@/lib/color-palette';
import { makeFeatures } from './fixtures';

describe('buildPaletteScorer', () => {
  const warm = makeFeatures({ bins: { 0: 0.5, 1: 0.4 }, lightness: 0.7 });
  const cool = makeFeatures({ bins: { 9: 0.9 }, lightness: 0.2 });
  const grey = makeFeatures({ bins: {}, lightness: 0.5 });

  it('scores nothing with no families selected', () => {
    expect(buildPaletteScorer([], [warm])(warm)).toBe(0);
  });

  it('is calibrated so the best available candidate scores 1', () => {
    const scorer = buildPaletteScorer(['warm'], [warm, cool, grey]);
    expect(scorer(warm)).toBe(1);
    expect(scorer(cool)).toBe(0);
    expect(scorer(grey)).toBe(0);
  });

  it('stretches a scarce family, but not below the noise floor', () => {
    // 10% green would be nothing on the raw scale; among these candidates it
    // is the greenest there is, and the 0.15 floor caps the stretch.
    const faintlyGreen = makeFeatures({ bins: { 5: 0.1 } });
    const scorer = buildPaletteScorer(['green'], [faintlyGreen, grey]);
    expect(scorer(faintlyGreen)).toBeCloseTo(0.1 / 0.15);
  });

  it('AND is a geometric mean that zeroes when a family is absent', () => {
    const scorer = buildPaletteScorer(['warm', 'bright'], [warm, cool, grey]);
    expect(scorer(warm)).toBe(1);
    // Cool is dark and not warm at all.
    expect(scorer(cool)).toBe(0);

    const halfway = makeFeatures({ bins: { 0: 0.45 }, lightness: 0.45 });
    const mixed = buildPaletteScorer(['warm', 'bright'], [warm, halfway]);
    const warmShare = 0.45 / 0.9;
    const brightShare = (0.45 - 0.25) / (0.65 - 0.25);
    expect(mixed(halfway)).toBeCloseTo(Math.sqrt(warmShare * brightShare));
  });

  it('bright and dark read mean lightness, not hue', () => {
    const scorer = buildPaletteScorer(['dark'], [warm, cool]);
    expect(scorer(cool)).toBe(1);
    expect(scorer(warm)).toBe(0);
  });

  it('every declared family has a scorer', () => {
    for (const id of COLOR_PALETTE_IDS) {
      expect(() =>
        buildPaletteScorer([id], [warm, cool, grey])(warm),
      ).not.toThrow();
    }
  });
});
