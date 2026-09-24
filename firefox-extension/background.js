// Shared by the Chrome and Firefox builds. Keep this file byte-identical in
// browser-extension/ and firefox-extension/; a test enforces it.

// Firefox exposes both `browser` and `chrome`; `browser` is its native,
// promise-based namespace, so prefer it.
const api = typeof browser !== "undefined" ? browser : chrome;

const MENU_OPEN_LINK = "open-link-in-vrc-worlds-manager";
const MENU_SEARCH = "search-in-vrc-worlds-manager";

// Served by the running app on the loopback interface only. See
// library_bridge_service.rs for why this needs no token.
const LIBRARY_URL = "http://127.0.0.1:38219/v1/library";

// How stale the library may be before it is fetched again. The request is a
// conditional one, so asking costs almost nothing when nothing has changed.
const LIBRARY_MAX_AGE_MS = 60 * 1000;

// Link shorteners worth following to find out which world they point at.
const RESOLVABLE = /^https:\/\/(t\.co|vrch\.at)\//;
const WORLD_ID =
    /wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Resolutions are permanent - a t.co link never changes target - so they are
// kept, but not without bound.
const MAX_RESOLVED = 2000;

// ---------------------------------------------------------------------------
// Context menus: send a link or selection to the app
// ---------------------------------------------------------------------------

// Menus are rebuilt on every start as well as on install. Firefox keeps them
// for an event page in most cases, but a browser restart after an update can
// leave the menu missing, and clearing first means a rebuild never trips over
// a duplicate id.
function createMenus() {
    api.contextMenus.removeAll().then(() => {
        api.contextMenus.create({
            id: MENU_OPEN_LINK,
            title: "Open in VRC Worlds Manager",
            contexts: ["link"],
            targetUrlPatterns: ["<all_urls>"]
        });

        api.contextMenus.create({
            id: MENU_SEARCH,
            title: "Search in VRC Worlds Manager",
            contexts: ["selection"]
        });
    });
}

api.runtime.onInstalled.addListener(createMenus);
api.runtime.onStartup.addListener(createMenus);

// Hands the deep link to the operating system, which passes it to the app.
//
// A hidden iframe in the current page does this without disturbing the page.
// That needs script access to the page, which the browser withholds on its
// own pages (and Firefox until site access is granted), so a short-lived
// background tab is the fallback there.
function triggerDeepLink(tabId, deepLink) {
    api.scripting.executeScript({
        target: { tabId: tabId },
        func: (link) => {
            const iframe = document.createElement("iframe");
            iframe.style.display = "none";
            iframe.src = link;
            document.body.appendChild(iframe);
            setTimeout(() => iframe.remove(), 1000);
        },
        args: [deepLink]
    }).catch((e) => {
        console.log("Script injection failed, using tab fallback:", e);
        api.tabs.create({ url: deepLink, active: false }).then((newTab) => {
            setTimeout(() => api.tabs.remove(newTab.id), 3000);
        });
    });
}

api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_OPEN_LINK && info.linkUrl) {
        triggerDeepLink(
            tab.id,
            `vrc-worlds-manager://${encodeURIComponent(info.linkUrl)}`
        );
    }

    if (info.menuItemId === MENU_SEARCH && info.selectionText) {
        // A distinct prefix tells the app this is a search, not a link.
        triggerDeepLink(
            tab.id,
            `vrc-worlds-manager://search/${encodeURIComponent(info.selectionText)}`
        );
    }
});

// ---------------------------------------------------------------------------
// Library: which worlds are already in the app
// ---------------------------------------------------------------------------

// Kept in storage rather than memory: Chrome stops idle service workers, and
// the last copy is what lets tweets be marked while the app is closed.
async function getLibrary() {
    const { library } = await api.storage.local.get("library");
    const isFresh = library && Date.now() - library.fetchedAt < LIBRARY_MAX_AGE_MS;
    if (isFresh) return library;

    try {
        const headers = {};
        if (library && library.etag) headers["If-None-Match"] = library.etag;

        const response = await fetch(LIBRARY_URL, {
            headers,
            credentials: "omit",
            cache: "no-store"
        });

        if (response.status === 304 && library) {
            const refreshed = { ...library, fetchedAt: Date.now() };
            await api.storage.local.set({ library: refreshed });
            return refreshed;
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const body = await response.json();
        if (body.app !== "vrc-worlds-manager" || !Array.isArray(body.worlds)) {
            throw new Error("unexpected response");
        }

        const fresh = {
            worlds: body.worlds,
            etag: response.headers.get("ETag"),
            fetchedAt: Date.now()
        };
        await api.storage.local.set({ library: fresh });
        return fresh;
    } catch (e) {
        // The app is not running, most likely. The last copy is still a far
        // better answer than none; it only lacks worlds added since.
        console.log("VRC Worlds Manager library unavailable:", e.message);
        return library ? { ...library, stale: true } : null;
    }
}

// ---------------------------------------------------------------------------
// Short links: which world a t.co or vrch.at link leads to
// ---------------------------------------------------------------------------

// t.co answers a browser with an HTML page that redirects by meta refresh
// rather than with an HTTP redirect, so the target has to be read out of it.
function redirectTarget(html) {
    const meta = html.match(/http-equiv=["']?refresh["']?[^>]*?url=([^"'>\s]+)/i);
    if (meta) return meta[1];
    const script = html.match(/location\.replace\(["']([^"']+)["']\)/);
    return script ? script[1].replace(/\\\//g, "/") : null;
}

async function followOnce(url) {
    const response = await fetch(url, { credentials: "omit", redirect: "follow" });
    const body = await response.text();
    return { finalUrl: response.url, body };
}

async function resolveUncached(url) {
    // Two hops at most: t.co to vrch.at to vrchat.com is the longest chain.
    let current = url;
    for (let hop = 0; hop < 2; hop += 1) {
        const { finalUrl, body } = await followOnce(current);
        const direct = finalUrl.match(WORLD_ID);
        if (direct) return direct[0].toLowerCase();

        // Past the shorteners the link leads somewhere else entirely - a blog
        // post listing a dozen worlds, say - and an id found in that page's
        // body would be a guess, not the link's target.
        if (!RESOLVABLE.test(finalUrl)) return null;

        const target = redirectTarget(body);
        if (!target) return null;
        const inTarget = target.match(WORLD_ID);
        if (inTarget) return inTarget[0].toLowerCase();
        if (!RESOLVABLE.test(target)) return null;
        current = target;
    }
    return null;
}

// A few at a time, so scrolling a busy timeline does not fire a burst.
const MAX_CONCURRENT = 2;
let running = 0;
const queue = [];

function schedule(task) {
    return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        drain();
    });
}

function drain() {
    while (running < MAX_CONCURRENT && queue.length > 0) {
        const { task, resolve, reject } = queue.shift();
        running += 1;
        task()
            .then(resolve, reject)
            .finally(() => {
                running -= 1;
                drain();
            });
    }
}

async function resolveLink(url) {
    // Only ever the shorteners: this fetches on behalf of a content script,
    // and must not become a way to make the extension request anything else.
    if (!RESOLVABLE.test(url)) return null;

    const { resolved = {} } = await api.storage.local.get("resolved");
    if (url in resolved) return resolved[url];

    let worldId = null;
    try {
        worldId = await schedule(() => resolveUncached(url));
    } catch (e) {
        // Not cached: a network failure is not an answer.
        console.log("Could not resolve", url, e.message);
        return null;
    }

    const { resolved: latest = {} } = await api.storage.local.get("resolved");
    latest[url] = worldId;
    const keys = Object.keys(latest);
    if (keys.length > MAX_RESOLVED) {
        for (const key of keys.slice(0, keys.length - MAX_RESOLVED)) {
            delete latest[key];
        }
    }
    await api.storage.local.set({ resolved: latest });
    return worldId;
}

// ---------------------------------------------------------------------------
// Messages from the tweet-marking content script
// ---------------------------------------------------------------------------

// sendResponse with `return true` rather than a returned promise: it is the
// form both browsers accept.
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "vwm:getLibrary") {
        getLibrary().then(sendResponse, () => sendResponse(null));
        return true;
    }
    if (message && message.type === "vwm:resolve") {
        resolveLink(String(message.url || "")).then(sendResponse, () => sendResponse(null));
        return true;
    }
    return false;
});
