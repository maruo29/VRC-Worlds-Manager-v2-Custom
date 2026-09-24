import { describe, expect, it } from 'vitest';
import { textOverlap, textTokens } from '@/lib/text-similarity';

describe('textTokens', () => {
  it('drops short latin words and all-hiragana bigrams', () => {
    const tokens = textTokens('The Big Room へあてて');
    expect(tokens.has('the')).toBe(true);
    expect(tokens.has('big')).toBe(true);
    expect(tokens.has('room')).toBe(true);
    expect(tokens.has('へあ')).toBe(false);
  });

  it('emits kanji bigrams and single kanji, normalised', () => {
    const tokens = textTokens('夏の夕暮れ');
    expect(tokens.has('夏')).toBe(true);
    expect(tokens.has('夕暮')).toBe(true);
    expect(tokens.has('夏の')).toBe(true);
    // NFKC folds full-width latin to ascii and lower-cases it.
    expect(textTokens('ＲＯＯＭ').has('room')).toBe(true);
  });
});

describe('textOverlap', () => {
  it('is an overlap coefficient over the smaller set', () => {
    const seed = textTokens('summer night beach party');
    const candidate = textTokens('summer night');
    expect(textOverlap(seed, candidate)).toBe(1);
    expect(textOverlap(candidate, seed)).toBe(1);
  });

  it('refuses to score a single-token set', () => {
    expect(textOverlap(textTokens('summer'), textTokens('summer night'))).toBe(
      0,
    );
  });

  it('is zero with nothing in common', () => {
    expect(
      textOverlap(textTokens('summer night'), textTokens('cold cave')),
    ).toBe(0);
  });
});
