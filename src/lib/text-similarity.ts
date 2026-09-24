/**
 * Cheap text overlap between world titles and descriptions.
 *
 * Author tags miss most of what makes worlds feel alike - "summer", "night",
 * "quiet" and so on usually appear only in the title or the description. This
 * is a plain character-bigram overlap, so it works on Japanese without a
 * tokenizer, a dictionary or a model.
 */

/** Bigrams built only from these are almost always grammar, not content. */
const HIRAGANA = /^[぀-ゟ]+$/;

/** Individual kanji carry meaning; individual kana do not. */
const KANJI = /^[一-鿿㐀-䶿]$/;

/** Latin words shorter than this carry no meaning on their own. */
const MIN_WORD_LENGTH = 3;

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

/**
 * Latin runs become whole words; everything else becomes character bigrams.
 * All-hiragana bigrams are dropped because they are dominated by particles
 * (の, へ, あて…) that match everything.
 */
export function textTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = normalize(text);

  for (const chunk of normalized.split(' ')) {
    if (chunk.length === 0) continue;

    if (/^[a-z0-9]+$/.test(chunk)) {
      if (chunk.length >= MIN_WORD_LENGTH) tokens.add(chunk);
      continue;
    }

    for (let i = 0; i < chunk.length - 1; i += 1) {
      const bigram = chunk.slice(i, i + 2);
      if (HIRAGANA.test(bigram)) continue;
      tokens.add(bigram);
    }

    // Single kanji count too, so 夏の夕暮れ and 夏祭りの夜 still meet on 夏
    // even though neither bigram lines up.
    for (const character of chunk) {
      if (KANJI.test(character)) tokens.add(character);
    }
  }

  return tokens;
}

/**
 * Overlap coefficient rather than Dice: the seed carries a whole description
 * while a candidate only has its title, so comparing set sizes directly would
 * punish every candidate for being short.
 */
export function textOverlap(
  seedTokens: Set<string>,
  candidateTokens: Set<string>,
): number {
  const smaller =
    seedTokens.size < candidateTokens.size ? seedTokens : candidateTokens;
  const larger =
    seedTokens.size < candidateTokens.size ? candidateTokens : seedTokens;

  // Two tokens is the floor for a believable match; below that a single
  // shared character would score 1.0.
  if (smaller.size < 2) return 0;

  let shared = 0;
  smaller.forEach((token) => {
    if (larger.has(token)) shared += 1;
  });

  return shared / smaller.size;
}
