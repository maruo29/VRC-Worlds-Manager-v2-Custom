import { describe, expect, it } from 'vitest';
import {
  MANUAL_TAG_WEIGHT,
  MAX_COLOR_ANCHORS,
  authorTagsOf,
  buildColorTaste,
  buildPreferenceProfile,
  candidateTags,
  isPublishedWithin,
  normalizeTag,
  publicationAgeDays,
  rankCandidates,
  scoreWorld,
  tasteWeight,
} from '@/lib/recommend';
import { PALETTE_WEIGHT } from '@/lib/color-palette';
import { daysAgo, makeFeatures, makeWorld, tagged } from './fixtures';

const NOW = Date.parse('2026-09-01T00:00:00.000Z');

describe('normalizeTag / authorTagsOf', () => {
  it('keeps only author tags, lower-cased and de-duplicated', () => {
    expect(normalizeTag('author_tag_Chill')).toBe('chill');
    expect(normalizeTag('system_approved')).toBeNull();
    expect(normalizeTag('author_tag_   ')).toBeNull();

    const world = makeWorld({
      tags: ['author_tag_Chill', 'author_tag_chill', 'system_approved'],
    });
    expect(authorTagsOf(world)).toEqual(['chill']);
  });
});

describe('tasteWeight', () => {
  it('favourites and filed worlds count for more', () => {
    expect(tasteWeight(makeWorld())).toBe(1);
    expect(tasteWeight(makeWorld({ isFavorite: true }))).toBe(3);
    expect(tasteWeight(makeWorld({ folders: ['a'] }))).toBeCloseTo(1.6);
  });
});

describe('buildPreferenceProfile', () => {
  it('damps counts and ranks manual tags above every auto tag', () => {
    const library = [
      ...Array.from({ length: 9 }, () => makeWorld({ tags: tagged('chill') })),
      makeWorld({ tags: tagged('rare') }),
      makeWorld({ tags: [] }),
    ];
    const profile = buildPreferenceProfile(library, ['Letter ']);

    expect(profile.totalWorldCount).toBe(11);
    expect(profile.taggedWorldCount).toBe(10);
    expect(profile.manualTags).toEqual(['letter']);

    const [first, second, third] = profile.tags;
    expect(first).toMatchObject({
      tag: 'letter',
      isManual: true,
      worldCount: 0,
    });
    expect(first.weight).toBe(MANUAL_TAG_WEIGHT);
    expect(second).toMatchObject({ tag: 'chill', worldCount: 9 });
    expect(second.weight).toBe(1);
    // sqrt(1) / sqrt(9): the rare tag is worth a third, not a ninth.
    expect(third.tag).toBe('rare');
    expect(third.weight).toBeCloseTo(1 / 3);
  });

  it('candidateTags puts manual tags first and honours the limit', () => {
    const library = [
      makeWorld({ tags: tagged('a', 'b', 'c') }),
      makeWorld({ tags: tagged('a') }),
    ];
    const profile = buildPreferenceProfile(library, ['z']);
    expect(candidateTags(profile, 2)).toEqual(['z', 'a']);
  });
});

describe('publication windows', () => {
  it('treats unknown publication dates as outside any window', () => {
    const undated = makeWorld({ publicationDate: null });
    expect(publicationAgeDays(undated, NOW)).toBeNull();
    expect(isPublishedWithin(undated, 365, NOW)).toBe(false);

    const recent = makeWorld({ publicationDate: daysAgo(3, NOW) });
    expect(publicationAgeDays(recent, NOW)).toBeCloseTo(3);
    expect(isPublishedWithin(recent, 7, NOW)).toBe(true);
    expect(isPublishedWithin(recent, 2, NOW)).toBe(false);
  });
});

describe('scoreWorld', () => {
  const profile = buildPreferenceProfile([
    makeWorld({ tags: tagged('chill') }),
    makeWorld({ tags: tagged('chill') }),
    makeWorld({ tags: tagged('night') }),
  ]);

  it('scores zero with no matching tag, regardless of popularity', () => {
    const scored = scoreWorld(
      makeWorld({ tags: tagged('horror'), favorites: 100000 }),
      profile,
      NOW,
    );
    expect(scored.score).toBe(0);
    expect(scored.matchedTags).toEqual([]);
  });

  it('lists matched tags strongest first and adds bounded bonuses', () => {
    const base = scoreWorld(
      makeWorld({ tags: tagged('night', 'chill') }),
      profile,
      NOW,
    );
    expect(base.matchedTags).toEqual(['chill', 'night']);

    const popular = scoreWorld(
      makeWorld({ tags: tagged('night', 'chill'), favorites: 1_000_000 }),
      profile,
      NOW,
    );
    // Popularity can never add more than a quarter of a point.
    expect(popular.score - base.score).toBeLessThanOrEqual(0.25);

    const fresh = scoreWorld(
      makeWorld({
        tags: tagged('night', 'chill'),
        publicationDate: daysAgo(0, NOW),
      }),
      profile,
      NOW,
    );
    expect(fresh.score - base.score).toBeCloseTo(0.35);
  });
});

describe('rankCandidates', () => {
  const library = [
    makeWorld({ tags: tagged('chill') }),
    makeWorld({ tags: tagged('night') }),
  ];
  const profile = buildPreferenceProfile(library);

  it('dedupes, drops library/ignored/excluded worlds and unmatched ones', () => {
    const dup = makeWorld({ tags: tagged('chill') });
    const ignored = makeWorld({ tags: tagged('chill') });
    const excluded = makeWorld({ tags: tagged('chill', 'horror') });
    const unmatched = makeWorld({ tags: tagged('sky') });
    const kept = makeWorld({ tags: tagged('night') });

    const ranked = rankCandidates(
      [dup, dup, library[0], ignored, excluded, unmatched, kept],
      profile,
      {
        excludedTags: [' Horror '],
        ignoredWorldIds: [ignored.worldId],
        now: NOW,
      },
    );

    expect(ranked.map((entry) => entry.world.worldId)).toEqual([
      dup.worldId,
      kept.worldId,
    ]);
  });

  it('keeps unmatched worlds when asked, scored zero', () => {
    const unmatched = makeWorld({ tags: tagged('sky') });
    const ranked = rankCandidates([unmatched], profile, {
      requireTagMatch: false,
      now: NOW,
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBe(0);
  });

  it('breaks score ties by name', () => {
    const b = makeWorld({ name: 'Bravo', tags: tagged('chill') });
    const a = makeWorld({ name: 'Alpha', tags: tagged('chill') });
    const ranked = rankCandidates([b, a], profile, { now: NOW });
    expect(ranked.map((entry) => entry.world.name)).toEqual(['Alpha', 'Bravo']);
  });
});

describe('colour taste', () => {
  it('builds anchors heaviest first and caps them', () => {
    const worlds = Array.from({ length: MAX_COLOR_ANCHORS + 5 }, (_, i) =>
      makeWorld({ isFavorite: i === 0 }),
    );
    const features = Object.fromEntries(
      worlds.map((world) => [world.worldId, makeFeatures({})]),
    );

    const taste = buildColorTaste(worlds, features);
    expect(taste?.sourceCount).toBe(MAX_COLOR_ANCHORS + 5);
    expect(taste?.anchors).toHaveLength(MAX_COLOR_ANCHORS);
    expect(taste?.anchors[0].weight).toBe(3);

    expect(buildColorTaste(worlds, {})).toBeNull();
  });

  it('only ever boosts a world that already matched on tags', () => {
    const library = [makeWorld({ tags: tagged('chill') })];
    const profile = buildPreferenceProfile(library);
    const taste = buildColorTaste(library, {
      [library[0].worldId]: makeFeatures({ bins: { 9: 0.9 } }),
    });

    const lookalike = makeWorld({ tags: tagged('sky') });
    const ranked = rankCandidates([lookalike], profile, {
      now: NOW,
      color: {
        taste,
        featuresByWorldId: {
          [lookalike.worldId]: makeFeatures({ bins: { 9: 0.9 } }),
        },
        weight: 5,
      },
    });
    expect(ranked).toEqual([]);
  });

  it('spreads calibrated colour across the candidates', () => {
    const library = [makeWorld({ tags: tagged('chill') })];
    const profile = buildPreferenceProfile(library);
    const blue = makeFeatures({ bins: { 9: 0.9 }, lightness: 0.3 });
    const taste = buildColorTaste(library, { [library[0].worldId]: blue });

    const candidates = [
      makeWorld({ name: 'blue', tags: tagged('chill') }),
      makeWorld({ name: 'mid', tags: tagged('chill') }),
      makeWorld({ name: 'orange', tags: tagged('chill') }),
    ];
    const ranked = rankCandidates(candidates, profile, {
      now: NOW,
      color: {
        taste,
        featuresByWorldId: {
          [candidates[0].worldId]: blue,
          [candidates[1].worldId]: makeFeatures({ bins: { 9: 0.4, 1: 0.4 } }),
          [candidates[2].worldId]: makeFeatures({
            bins: { 1: 0.9 },
            lightness: 0.8,
          }),
        },
        weight: 1,
      },
    });

    expect(ranked.map((entry) => entry.world.name)).toEqual([
      'blue',
      'mid',
      'orange',
    ]);
    expect(ranked[0].colorScore).toBe(1);
    expect(ranked[2].colorScore).toBe(0);
  });

  it('an explicit palette replaces the taste term and ignores the weight', () => {
    const library = [makeWorld({ tags: tagged('chill') })];
    const profile = buildPreferenceProfile(library);
    const blue = makeFeatures({ bins: { 9: 0.9 } });
    const taste = buildColorTaste(library, { [library[0].worldId]: blue });

    const warm = makeWorld({ name: 'warm', tags: tagged('chill') });
    const cool = makeWorld({ name: 'cool', tags: tagged('chill') });
    const ranked = rankCandidates([cool, warm], profile, {
      now: NOW,
      color: {
        taste,
        featuresByWorldId: {
          [warm.worldId]: makeFeatures({ bins: { 1: 0.9 } }),
          [cool.worldId]: blue,
        },
        weight: 0,
        palette: ['warm'],
      },
    });

    expect(ranked.map((entry) => entry.world.name)).toEqual(['warm', 'cool']);
    expect(ranked[0].score - ranked[1].score).toBeCloseTo(PALETTE_WEIGHT);
  });
});
