// Marks tweets about worlds that are already in VRC Worlds Manager.
//
// Shared by the Chrome and Firefox builds. Keep this file byte-identical in
// browser-extension/ and firefox-extension/; a test enforces it.
//
// X's markup changes often, and the signed-out view carries no data-testid
// attributes at all, so nothing here depends on them. It relies only on
// <article>, links and text:
//
//  1. A link whose href holds a world id. X puts the expanded URL in href
//     even though the visible text is cut short ("vrchat.com/home/world/wrl…"),
//     so this usually settles it with no network at all.
//  2. For #VRChat_world紹介 tweets, the world's name and author in the text -
//     or, marked as the weaker guess it is, the whole name on its own.
//  3. Only when neither found anything: a t.co or vrch.at link that looks like
//     a world link, resolved by the background script and cached for good.

(function () {
    const api = typeof browser !== "undefined" ? browser : chrome;
    const M = globalThis.VWM_MATCH;
    if (!M) return;

    const BADGE = "vwm-badge";
    const SCAN_DELAY_MS = 300;
    // The background script revalidates cheaply; this only bounds how long a
    // world just added in the app takes to show up here.
    const LIBRARY_REFRESH_MS = 2 * 60 * 1000;
    const STATUS_ID = /\/status\/(\d+)/;
    const RESOLVABLE = /^https:\/\/(t\.co|vrch\.at)\//;

    const JA = (navigator.language || "").toLowerCase().startsWith("ja");
    const TEXT = JA
        ? {
              added: "追加済み",
              nameAndAuthor: "名前・作者一致",
              nameOnly: "名前のみ一致",
              hidden: "非表示にしたワールド",
              title: "VRC Worlds Manager",
              folders: "フォルダ",
              nameAndAuthorNote: "リンクではなく、ワールド名と作者名で判定しました",
              nameOnlyNote: "ワールド名だけで判定しました。同名の別ワールドの可能性があります",
              open: "クリックで VRC Worlds Manager で開く",
              stale: "（Managerが起動していないため、最後に取得した一覧で判定）"
          }
        : {
              added: "Added",
              nameAndAuthor: "name + author",
              nameOnly: "name only",
              hidden: "Hidden world",
              title: "VRC Worlds Manager",
              folders: "Folders",
              nameAndAuthorNote: "Matched on world name and author, not a link",
              nameOnlyNote: "Matched on the world name alone; it may be a different world with the same name",
              open: "Click to open in VRC Worlds Manager",
              stale: "(Manager is not running; judged from the last list)"
          };

    /** { byId, nameIndex, signature, stale } once loaded. */
    let library = null;
    let libraryCheckedAt = 0;
    let loading = null;

    /**
     * Findings per tweet, kept by tweet id rather than by element: X throws
     * articles away as they scroll out and builds new ones on the way back.
     */
    const findings = new Map();
    const findingsByElement = new WeakMap();
    const resolving = new Set();

    // -------------------------------------------------------------------
    // Library
    // -------------------------------------------------------------------

    async function loadLibrary() {
        let response = null;
        try {
            response = await api.runtime.sendMessage({ type: "vwm:getLibrary" });
        } catch (e) {
            // The extension was reloaded under this page; nothing to do until
            // the page is.
            return;
        } finally {
            libraryCheckedAt = Date.now();
        }

        if (!response || !Array.isArray(response.worlds)) return;

        const signature = `${response.etag || ""}:${response.worlds.length}`;
        if (library && library.signature === signature) {
            library.stale = !!response.stale;
            return;
        }

        library = {
            byId: new Map(response.worlds.map((w) => [w.id.toLowerCase(), w])),
            nameIndex: M.buildNameIndex(response.worlds),
            signature,
            stale: !!response.stale
        };

        // What was decided against the old list may no longer hold - a world
        // removed from its last folder should lose its badge too.
        findings.clear();
        for (const badge of document.querySelectorAll(BADGE)) badge.remove();
    }

    async function ensureLibrary() {
        if (!library || Date.now() - libraryCheckedAt > LIBRARY_REFRESH_MS) {
            if (!loading) loading = loadLibrary().finally(() => (loading = null));
            await loading;
        }
        return library !== null;
    }

    // -------------------------------------------------------------------
    // Reading a tweet
    // -------------------------------------------------------------------

    // Every status id in the article, so a quote tweet and the tweet it
    // quotes never share a key.
    function tweetKey(article) {
        const ids = new Set();
        for (const link of article.querySelectorAll('a[href*="/status/"]')) {
            const match = link.getAttribute("href").match(STATUS_ID);
            if (match) ids.add(match[1]);
        }
        return ids.size > 0 ? Array.from(ids).sort().join(",") : null;
    }

    function inspect(article, key) {
        const found = [];
        const seen = new Set();
        const toResolve = [];

        for (const link of article.querySelectorAll("a[href]")) {
            const href = link.href;
            const text = link.textContent || "";
            const ids = M.extractWorldIds(`${href} ${text}`);

            for (const id of ids) {
                if (seen.has(id)) continue;
                seen.add(id);
                if (library.byId.has(id)) {
                    found.push({
                        worldId: id,
                        how: "link",
                        anchor: { type: "href", value: link.getAttribute("href") }
                    });
                }
            }

            if (
                ids.length === 0 &&
                RESOLVABLE.test(href) &&
                (M.looksLikeWorldLink(text) || href.startsWith("https://vrch.at/"))
            ) {
                toResolve.push({ url: href, attr: link.getAttribute("href") });
            }
        }

        const text = article.textContent || "";
        if (M.hasIntroTag(text)) {
            for (const { world, strength } of M.matchByName(text, library.nameIndex)) {
                const id = world.id.toLowerCase();
                if (found.some((f) => f.worldId === id)) continue;
                found.push({ worldId: id, how: strength, anchor: { type: "tag" } });
            }
        }

        // The network only as a last resort.
        if (found.length === 0) {
            for (const target of toResolve) resolveLater(key, target);
        }

        return found;
    }

    function resolveLater(key, target) {
        if (!key || resolving.has(target.url)) return;
        resolving.add(target.url);

        api.runtime
            .sendMessage({ type: "vwm:resolve", url: target.url })
            .then((worldId) => {
                if (!worldId || !library || !library.byId.has(worldId)) return;
                const list = findings.get(key);
                if (!list || list.some((f) => f.worldId === worldId)) return;
                list.push({
                    worldId,
                    how: "link",
                    anchor: { type: "href", value: target.attr }
                });
                scheduleScan();
            })
            .catch(() => {})
            .finally(() => resolving.delete(target.url));
    }

    // -------------------------------------------------------------------
    // Badges
    // -------------------------------------------------------------------

    function locate(article, finding) {
        if (finding.anchor.type === "href") {
            for (const link of article.querySelectorAll("a[href]")) {
                if (link.getAttribute("href") === finding.anchor.value) return link;
            }
            return null;
        }
        for (const link of article.querySelectorAll('a[href*="/hashtag/"]')) {
            if (M.hasIntroTag(link.textContent)) return link;
        }
        return null;
    }

    function describe(world, how) {
        const lines = [`${TEXT.title}: ${world.name}`];
        if (!world.hidden && world.folders && world.folders.length > 0) {
            lines.push(`${TEXT.folders}: ${world.folders.join(", ")}`);
        }
        if (how === "nameAndAuthor") lines.push(TEXT.nameAndAuthorNote);
        if (how === "nameOnly") lines.push(TEXT.nameOnlyNote);
        if (library.stale) lines.push(TEXT.stale);
        lines.push(TEXT.open);
        return lines.join("\n");
    }

    // The same deep link the context menu sends. The app opens a world it
    // already has straight to its details rather than to the add dialog.
    function openInManager(worldId) {
        const target = `https://vrchat.com/home/world/${worldId}`;
        const frame = document.createElement("iframe");
        frame.style.display = "none";
        frame.src = `vrc-worlds-manager://${encodeURIComponent(target)}`;
        document.body.appendChild(frame);
        setTimeout(() => frame.remove(), 1000);
    }

    // Built with DOM calls and textContent throughout: folder and world names
    // are the user's own, but they are still never parsed as markup.
    function makeBadge(finding) {
        const world = library.byId.get(finding.worldId);
        const host = document.createElement(BADGE);
        host.dataset.world = finding.worldId;
        host.title = describe(world, finding.how);

        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = `
            :host { display: inline-flex; vertical-align: middle; margin: 0 0 0 6px; }
            .pill {
                display: inline-flex; align-items: center; gap: 4px;
                max-width: 22em; padding: 1px 8px;
                border-radius: 999px; border: 1px solid rgba(168, 85, 247, 0.55);
                background: rgba(168, 85, 247, 0.14); color: rgb(192, 132, 252);
                font: 600 12px/1.6 system-ui, sans-serif; white-space: nowrap;
            }
            .pill { cursor: pointer; }
            .pill:hover { background: rgba(168, 85, 247, 0.26); }
            .pill.nameAndAuthor { border-style: dashed; }
            .pill.nameOnly { border-style: dotted; opacity: 0.75; }
            .pill.hidden {
                border-color: rgba(148, 163, 184, 0.55);
                background: rgba(148, 163, 184, 0.14); color: rgb(148, 163, 184);
            }
            .detail {
                overflow: hidden; text-overflow: ellipsis;
                font-weight: 400; opacity: 0.85;
            }
        `;

        const pill = document.createElement("span");
        pill.className = `pill ${finding.how} ${world.hidden ? "hidden" : ""}`;

        // A tick for what is known, an approximately-equal sign for what is
        // only guessed from a name.
        const label = document.createElement("span");
        if (world.hidden) {
            label.textContent = `✕ ${TEXT.hidden}`;
        } else if (finding.how === "nameOnly") {
            label.textContent = `≈ ${TEXT.added}`;
        } else {
            label.textContent = `✓ ${TEXT.added}`;
        }
        pill.append(label);

        const folders = world.folders || [];
        const detailText = world.hidden
            ? ""
            : finding.how === "link"
              ? folders.slice(0, 2).join(", ") +
                (folders.length > 2 ? ` +${folders.length - 2}` : "")
              : TEXT[finding.how];
        if (detailText) {
            const detail = document.createElement("span");
            detail.className = "detail";
            detail.textContent = `· ${detailText}`;
            pill.append(detail);
        }

        shadow.append(style, pill);

        // Kept from reaching the tweet, which would otherwise open on the
        // same click.
        host.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            openInManager(finding.worldId);
        });
        return host;
    }

    function render(article, finding) {
        const existing = article.querySelector(
            `${BADGE}[data-world="${finding.worldId}"]`
        );
        if (existing) return;
        const anchor = locate(article, finding);
        if (anchor) anchor.insertAdjacentElement("afterend", makeBadge(finding));
    }

    // -------------------------------------------------------------------
    // Watching the page
    // -------------------------------------------------------------------

    async function scan() {
        if (!(await ensureLibrary())) return;

        for (const article of document.querySelectorAll("article")) {
            const key = tweetKey(article);

            let list = key ? findings.get(key) : findingsByElement.get(article);
            if (!list) {
                list = inspect(article, key);
                if (key) findings.set(key, list);
                else findingsByElement.set(article, list);
            }

            for (const finding of list) render(article, finding);
        }
    }

    // Mutations arrive in floods on X; this coalesces them into one pass.
    // A pass that finds everything already marked changes nothing, so it
    // cannot set off another.
    let timer = null;
    function scheduleScan() {
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            scan();
        }, SCAN_DELAY_MS);
    }

    new MutationObserver(scheduleScan).observe(document.body, {
        childList: true,
        subtree: true
    });
    scheduleScan();
})();
