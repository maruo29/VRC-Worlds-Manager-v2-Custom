import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The browser extension's world matching. It is plain JavaScript loaded as a
 * content script, so it is required here rather than imported.
 */
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../..');
const match = require(path.join(root, 'browser-extension/vwm-match.js'));

const ID_A = 'wrld_2f2da470-0242-467e-90a8-5532b95017c6';
const ID_B = 'wrld_696b04e5-42f3-4cfc-a25d-24ada228983e';

describe('extractWorldIds', () => {
  it('finds full ids, dedupes, and ignores truncated display text', () => {
    const text = `${ID_A} https://vrchat.com/home/world/${ID_A} ${ID_B.toUpperCase()} wrld_2f2da470-02…`;
    expect(match.extractWorldIds(text)).toEqual([ID_A, ID_B]);
  });

  it('returns nothing for text without an id', () => {
    expect(match.extractWorldIds('vrchat.com/home/world/wrl…')).toEqual([]);
    expect(match.extractWorldIds(undefined)).toEqual([]);
  });
});

describe('looksLikeWorldLink / hasIntroTag', () => {
  it('flags links worth resolving and nothing else', () => {
    expect(match.looksLikeWorldLink('vrchat.com/home/world/wrl…')).toBe(true);
    expect(match.looksLikeWorldLink('vrcw.net/world/detail/…')).toBe(true);
    expect(match.looksLikeWorldLink('vrch.at/abcd')).toBe(true);
    expect(match.looksLikeWorldLink('youtube.com/watch?v=…')).toBe(false);
  });

  it('recognises the intro hashtag in any case', () => {
    expect(match.hasIntroTag('良い #VRChat_world紹介 です')).toBe(true);
    expect(match.hasIntroTag('#vrchat_world紹介')).toBe(true);
    expect(match.hasIntroTag('#VRChat_world')).toBe(false);
  });
});

describe('normalize', () => {
  it('folds width and case and drops punctuation, emoji and spaces', () => {
    expect(match.normalize('「Ｓｉｌｅｎｔ　Dawn」✨！')).toBe('silentdawn');
  });
});

describe('nameVariants', () => {
  it('covers bracketed tags and bilingual names', () => {
    expect(match.nameVariants('【JP】Tutorial world')).toEqual([
      'jptutorialworld',
      'tutorialworld',
    ]);
    expect(match.nameVariants('教堂 ｜ Church')).toEqual([
      '教堂church',
      'church',
      '教堂',
    ]);
  });

  it('drops forms too short to be distinctive', () => {
    // One kanji, or two Latin letters, match ordinary text far too easily.
    expect(match.nameVariants('夏')).toEqual([]);
    expect(match.nameVariants('AB')).toEqual([]);
    // Two kanji are enough.
    expect(match.nameVariants('教堂')).toEqual(['教堂']);
  });
});

describe('matchByName', () => {
  const library = [
    { id: ID_A, name: '夏休みのご予定は？', author: '犬のジョン／inunojohn' },
    { id: ID_B, name: '教堂 ｜ Church', author: 'Kaori' },
    { id: 'dayspring', name: 'Dayspring - 夜明け', author: '_you5248' },
    { id: 'series-1', name: 'Silent Dawn', author: 'Mizuha' },
    { id: 'series-2', name: 'Silent Dawn 2', author: 'Mizuha' },
    { id: 'namesake', name: 'Silent Dawn 2', author: 'SomeoneElse' },
    { id: 'short', name: '夏', author: 'Someone' },
    { id: 'common', name: 'Home', author: 'Builder' },
  ];
  const index = match.buildNameIndex(library);
  const found = (text: string) =>
    match
      .matchByName(text, index)
      .map(
        (m: { world: { id: string }; strength: string }) =>
          `${m.world.id}:${m.strength}`,
      );

  it('matches a typical intro tweet on name and author', () => {
    const tweet = [
      'ワールド名：夏休みのご予定は？',
      '作者：犬のジョンさん',
      'ギミックが楽しい🌻',
      '#VRChat_world紹介',
    ].join(' ');
    expect(found(tweet)).toEqual([`${ID_A}:nameAndAuthor`]);
  });

  it('matches the tweet reported from the real timeline', () => {
    const tweet =
      'Yu-kichi(ゆーきち) @Yukichi26990880 ワールド名　Dayspring - 夜明け By _you5248 #VRChat_world紹介';
    expect(found(tweet)).toEqual(['dayspring:nameAndAuthor']);
  });

  it('lets half of a bilingual name count when the author backs it', () => {
    expect(found('「教堂」by Kaori さん')).toEqual([`${ID_B}:nameAndAuthor`]);
  });

  it('reports a whole name on its own as a weaker match', () => {
    expect(found('夏休みのご予定は？ に行ってきた')).toEqual([
      `${ID_A}:nameOnly`,
    ]);
    expect(found('Dayspring - 夜明け 綺麗だった')).toEqual([
      'dayspring:nameOnly',
    ]);
  });

  it('never matches half a name, or a short name, with nothing to back it', () => {
    // "夜明け" alone is an ordinary word; "教堂" too short without Kaori.
    expect(found('夜明けの海がきれい')).toEqual([]);
    expect(found('教堂に行った')).toEqual([]);
    // "Home" is a whole name, but four letters meet too much text.
    expect(found('Home sweet home')).toEqual([]);
  });

  it('does not match on the author alone', () => {
    expect(found('犬のジョンさんの新作')).toEqual([]);
  });

  it('prefers the longer name within a series', () => {
    expect(found('Silent Dawn 2 / Mizuha')).toEqual(['series-2:nameAndAuthor']);
    expect(found('Silent Dawn / Mizuha')).toEqual(['series-1:nameAndAuthor']);
  });

  it('drops a namesake once the real world matched with its author', () => {
    // "Silent Dawn 2" by SomeoneElse shares the name, but the tweet names
    // Mizuha, so it is not a second world in the tweet.
    expect(found('Silent Dawn 2 by Mizuha')).not.toContain(
      'namesake:nameOnly',
    );
  });

  it('reports every world when a tweet introduces several', () => {
    expect(
      found('夏休みのご予定は？(犬のジョン) と 教堂 (Kaori) #VRChat_world紹介'),
    ).toEqual([`${ID_A}:nameAndAuthor`, `${ID_B}:nameAndAuthor`]);
  });

  it('never matches a name too short to be distinctive', () => {
    expect(found('夏 Someone')).toEqual([]);
  });
});

describe('extension sources', () => {
  // Chrome and Firefox load separate folders; the shared scripts must not
  // drift apart between them.
  it.each(['vwm-match.js', 'background.js', 'twitter.js'])(
    '%s is identical in both extensions',
    (file) => {
      const chrome = readFileSync(path.join(root, 'browser-extension', file));
      const firefox = readFileSync(path.join(root, 'firefox-extension', file));
      expect(firefox.equals(chrome)).toBe(true);
    },
  );
});
