// Recognising VRChat worlds in tweets.
//
// Pure functions only - no DOM, no browser APIs - so the same file runs as a
// content script and under the test runner. Keep this file byte-identical in
// browser-extension/ and firefox-extension/; a test enforces it.

(function (root) {
    // Canonical world ids are UUIDs; anything shorter is a truncated display.
    const WORLD_ID =
        /wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

    // Hosts whose links point at a single world. A link to one of these whose
    // id is not visible in the tweet is worth resolving; any other link is not.
    const WORLD_LINK_HINT = /vrchat\.com|vrcw\.net|vrch\.at|wrld_/i;

    const INTRO_TAG = /#vrchat_world紹介/i;

    // Punctuation, symbols (emoji included) and all whitespace. Stripped from
    // both sides, so "「Silent Dawn」" and "silent dawn" compare equal.
    const NOISE = /[\p{P}\p{S}\p{Z}\p{Cc}]+/gu;

    // Bracketed decorations authors put in world names: 【JP】, [EN], (Beta).
    const BRACKETED = /【[^】]*】|\[[^\]]*\]|\([^)]*\)|（[^）]*）|〔[^〕]*〕/g;

    // Separators between a world's names in two languages: "教堂 ｜ Church".
    const NAME_SEPARATOR = /\s*[|｜/／:：]\s*|\s+[-–—]\s+/;

    // Below these, a name or author matches ordinary words too easily. Kana
    // and kanji carry far more per character than Latin letters - two kanji
    // are about as distinctive as a short English word - so they get a lower
    // bar.
    const MIN_LATIN_LENGTH = 3;
    const MIN_CJK_LENGTH = 2;

    // A name standing on its own, with no author to back it up, has to be
    // long enough that meeting it by chance in an unrelated tweet is unlikely.
    const NAME_ONLY_MIN_LATIN_LENGTH = 6;
    const NAME_ONLY_MIN_CJK_LENGTH = 4;
    const CJK = /[\u3040-\u30ff\u3400-\u9fff]/;

    function normalize(text) {
        return String(text || '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(NOISE, '');
    }

    function extractWorldIds(text) {
        const found = String(text || '').match(WORLD_ID) || [];
        return Array.from(new Set(found.map((id) => id.toLowerCase())));
    }

    function looksLikeWorldLink(text) {
        return WORLD_LINK_HINT.test(String(text || ''));
    }

    function hasIntroTag(text) {
        return INTRO_TAG.test(String(text || ''));
    }

    function isDistinctive(normalized) {
        const min = CJK.test(normalized) ? MIN_CJK_LENGTH : MIN_LATIN_LENGTH;
        return normalized.length >= min;
    }

    function isDistinctiveAlone(normalized) {
        const min = CJK.test(normalized)
            ? NAME_ONLY_MIN_CJK_LENGTH
            : NAME_ONLY_MIN_LATIN_LENGTH;
        return normalized.length >= min;
    }

    // The whole name, with and without its bracketed tags - but never one
    // half of a bilingual name. "夜明け" out of "Dayspring - 夜明け" is fine
    // when the author backs it up, and far too common a word when nothing
    // does.
    function wholeNameVariants(name) {
        const raw = String(name || '');
        const variants = new Set();
        for (const candidate of [raw, raw.replace(BRACKETED, ' ')]) {
            const normalized = normalize(candidate);
            if (isDistinctiveAlone(normalized)) variants.add(normalized);
        }
        return Array.from(variants).sort((a, b) => b.length - a.length);
    }

    // Every way a tweet might write a world or author name. The full name
    // first, then without its bracketed tags, then each half of a bilingual
    // one ("教堂 ｜ Church", "犬のジョン／inunojohn") - each only if it is
    // still long enough to be distinctive. Longest first, so the most
    // specific form is the one reported.
    function nameVariants(name) {
        const raw = String(name || '');
        const stripped = raw.replace(BRACKETED, ' ');
        const candidates = [raw, stripped, ...stripped.split(NAME_SEPARATOR)];

        const variants = new Set();
        for (const candidate of candidates) {
            const normalized = normalize(candidate);
            if (isDistinctive(normalized)) variants.add(normalized);
        }
        return Array.from(variants).sort((a, b) => b.length - a.length);
    }

    // Built once per library download, not once per tweet.
    function buildNameIndex(worlds) {
        const index = [];
        for (const world of worlds || []) {
            const variants = nameVariants(world.name);
            if (variants.length === 0) continue;
            index.push({
                world,
                variants,
                // Either may be empty: an author too short to trust simply
                // means this world can only ever match on its name alone.
                authors: nameVariants(world.author),
                wholeNames: wholeNameVariants(world.name)
            });
        }
        return index;
    }

    // Worlds named in the text, and how strongly.
    //
    //  - "nameAndAuthor": the name and the author both appear. An intro tweet
    //    nearly always carries both, so this is the dependable case.
    //  - "nameOnly": only the whole name appears, held to a stricter length.
    //    Reported so the reader can judge, never presented as certain.
    //
    // When one match's name contains another's (a series: "Silent Dawn" and
    // "Silent Dawn 2"), only the longer counts. A name-only match is also
    // dropped when a name-and-author match already covers its name - that is
    // a namesake by someone else, not a second world in the tweet.
    function matchByName(text, nameIndex) {
        const haystack = normalize(text);
        if (haystack.length === 0) return [];

        const strong = [];
        const weak = [];
        for (const entry of nameIndex) {
            const byAuthor = entry.authors.some((a) => haystack.includes(a));
            if (byAuthor) {
                const variant = entry.variants.find((v) => haystack.includes(v));
                if (variant) {
                    strong.push({ world: entry.world, strength: "nameAndAuthor", variant });
                    continue;
                }
            }
            const whole = entry.wholeNames.find((v) => haystack.includes(v));
            if (whole) weak.push({ world: entry.world, strength: "nameOnly", variant: whole });
        }

        const shadowedBy = (match, others, orEqual) =>
            others.some(
                (other) =>
                    other !== match &&
                    other.variant.includes(match.variant) &&
                    (orEqual || other.variant.length > match.variant.length)
            );

        return [
            ...strong.filter((m) => !shadowedBy(m, strong, false)),
            ...weak.filter(
                (m) => !shadowedBy(m, strong, true) && !shadowedBy(m, weak, false)
            )
        ].map(({ world, strength }) => ({ world, strength }));
    }

    const api = {
        normalize,
        extractWorldIds,
        looksLikeWorldLink,
        hasIntroTag,
        nameVariants,
        buildNameIndex,
        matchByName,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.VWM_MATCH = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
