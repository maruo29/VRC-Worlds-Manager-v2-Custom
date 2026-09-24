import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RELATED_WEIGHTS,
  buildRelatedProfile,
  buildTagIdf,
  rankRelated,
  tagWeight,
  toSeed,
} from '@/lib/related';
import { PALETTE_WEIGHT } from '@/lib/color-palette';
import { makeFeatures, makeWorld, tagged } from './fixtures';

describe('buildTagIdf / tagWeight', () => {
  it('rates rare tags near 1, ubiquitous ones near 0, unknown ones 1', () => {
    const library = [
      ...Array.from({ length: 50 }, () => makeWorld({ tags: tagged('room') })),
      makeWorld({ tags: tagged('letter') }),
    ];
    const idf = buildTagIdf(library);

    expect(tagWeight(idf, 'letter')).toBeGreaterThan(0.6);
    expect(tagWeight(idf, 'room')).toBeLessThan(0.01);
    expect(tagWeight(idf, 'never-seen')).toBe(1);
    // Squared, so a rare tag beats a pile of generic ones outright.
    expect(tagWeight(idf, 'letter')).toBeGreaterThan(
      10 * tagWeight(idf, 'room'),
    );
  });
});

describe('buildRelatedProfile', () => {
  const a = toSeed(makeWorld({ tags: tagged('night', 'city') }), 'usr_a');
  const b = toSeed(makeWorld({ tags: tagged('night', 'sea') }), 'usr_b');

  it('any: unions tags, most shared first', () => {
    const profile = buildRelatedProfile([a, b], 'any', ['derived']);
    expect(profile.tags).toEqual(['night', 'city', 'sea', 'derived']);
    expect(profile.requiredTags).toEqual([]);
    expect(profile.seedsPerTag.night).toBe(2);
    // A derived tag counts for half a seed, so a real tag always outranks it.
    expect(profile.seedsPerTag.derived).toBe(1);
    expect(profile.authorIds).toEqual(['usr_a', 'usr_b']);
  });

  it('all: requires the shared tags, and falls back to the union', () => {
    expect(buildRelatedProfile([a, b], 'all').requiredTags).toEqual(['night']);

    const c = toSeed(makeWorld({ tags: tagged('cave') }), 'usr_c');
    const noOverlap = buildRelatedProfile([a, c], 'all');
    expect(noOverlap.requiredTags).toEqual([]);
    // Equal counts fall back to alphabetical order.
    expect(noOverlap.tags).toEqual(['cave', 'city', 'night']);
  });
});

describe('rankRelated', () => {
  const seedWorld = makeWorld({
    name: 'Seed',
    tags: tagged('night', 'letter'),
  });
  const seed = toSeed(seedWorld, 'usr_seed', 'a quiet night letter');
  const profile = buildRelatedProfile([seed], 'any');

  it('orders by evidence and never returns the seed itself', () => {
    const twoTags = makeWorld({
      name: 'both',
      tags: tagged('night', 'letter'),
    });
    const oneTag = makeWorld({ name: 'one', tags: tagged('night') });
    const nothing = makeWorld({ name: 'none', tags: tagged('sky') });

    const ranked = rankRelated([seedWorld, nothing, oneTag, twoTags], profile);
    expect(ranked.map((entry) => entry.world.name)).toEqual(['both', 'one']);
    expect(ranked[0].matchedTags).toEqual(['night', 'letter']);
  });

  it('keeps everything, scored zero, when only re-ordering', () => {
    const nothing = makeWorld({ tags: tagged('sky') });
    const ranked = rankRelated([nothing], profile, { keepUnmatched: true });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBe(0);
  });

  it('the all mode drops candidates missing a required tag', () => {
    const other = toSeed(makeWorld({ tags: tagged('night', 'sea') }), 'usr_o');
    const all = buildRelatedProfile([seed, other], 'all');
    const nightOnly = makeWorld({ tags: tagged('night') });
    const letterOnly = makeWorld({ tags: tagged('letter') });

    const ranked = rankRelated([nightOnly, letterOnly], all);
    expect(ranked.map((entry) => entry.world.worldId)).toEqual([
      nightOnly.worldId,
    ]);
  });

  it('author bonus is full for the first three, then decays', () => {
    const byAuthor = Array.from({ length: 5 }, (_, i) =>
      makeWorld({ name: `author-${i}`, tags: [] }),
    );
    const authorIdByWorldId = Object.fromEntries(
      byAuthor.map((world) => [world.worldId, 'usr_seed']),
    );

    const ranked = rankRelated(byAuthor, profile, { authorIdByWorldId });
    const scores = ranked.map((entry) => entry.score);
    const author = DEFAULT_RELATED_WEIGHTS.author;

    expect(ranked.every((entry) => entry.sameAuthor)).toBe(true);
    expect(scores.slice(0, 3)).toEqual([author, author, author]);
    expect(scores[3]).toBeCloseTo(author * 0.6);
    expect(scores[4]).toBeCloseTo(author * 0.36);
  });

  it('flags folder mates, genre mates and library membership', () => {
    const mate = makeWorld({ tags: [] });
    const ranked = rankRelated([mate], profile, {
      folderMateIds: new Set([mate.worldId]),
      genreMateIds: new Set([mate.worldId]),
      libraryIds: new Set([mate.worldId]),
    });
    expect(ranked[0]).toMatchObject({
      sameFolder: true,
      sameGenre: true,
      isInLibrary: true,
    });
    expect(ranked[0].score).toBeCloseTo(
      DEFAULT_RELATED_WEIGHTS.folder + DEFAULT_RELATED_WEIGHTS.genre,
    );
  });

  it('colour only boosts candidates that matched on something else', () => {
    const seedColor = makeFeatures({ bins: { 9: 0.9 } });
    const lookalike = makeWorld({ tags: tagged('sky') });

    const ranked = rankRelated([lookalike], profile, {
      seedColor,
      colorFeatures: { [lookalike.worldId]: seedColor },
    });
    expect(ranked).toEqual([]);
  });

  it('a palette replaces the seed-colour comparison', () => {
    const blue = makeFeatures({ bins: { 9: 0.9 } });
    const warm = makeWorld({ name: 'warm', tags: tagged('night') });
    const cool = makeWorld({ name: 'cool', tags: tagged('night') });

    const bySeed = rankRelated([warm, cool], profile, {
      seedColor: blue,
      colorFeatures: {
        [warm.worldId]: makeFeatures({ bins: { 1: 0.9 } }),
        [cool.worldId]: blue,
      },
    });
    expect(bySeed[0].world.name).toBe('cool');

    const byPalette = rankRelated([warm, cool], profile, {
      seedColor: blue,
      palette: ['warm'],
      colorFeatures: {
        [warm.worldId]: makeFeatures({ bins: { 1: 0.9 } }),
        [cool.worldId]: blue,
      },
    });
    expect(byPalette[0].world.name).toBe('warm');
    expect(byPalette[0].score - byPalette[1].score).toBeCloseTo(PALETTE_WEIGHT);
  });
});
