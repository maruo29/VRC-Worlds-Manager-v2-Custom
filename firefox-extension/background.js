const VRC_URL_PATTERN = /^https:\/\/vrchat\.com\/home\/launch/;
const VRC_WORLD_URL_PATTERN = /^https:\/\/vrchat\.com\/home\/world\/wrld_/;

chrome.runtime.onInstalled.addListener(() => {
    // Context menu for links
    chrome.contextMenus.create({
        id: "open-link-in-vrc-worlds-manager",
        title: "Open in VRC Worlds Manager",
        contexts: ["link"],
        targetUrlPatterns: ["<all_urls>"]
    });

    // Context menu for selected text
    chrome.contextMenus.create({
        id: "search-in-vrc-worlds-manager",
        title: "Search in VRC Worlds Manager",
        contexts: ["selection"]
    });
});

// Helper function to trigger deep link
function triggerDeepLink(tabId, deepLink) {
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (link) => {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = link;
            document.body.appendChild(iframe);
            setTimeout(() => iframe.remove(), 1000);
        },
        args: [deepLink]
    }).catch(e => {
        console.log('Script injection failed, using tab fallback:', e);
        chrome.tabs.create({ url: deepLink, active: false }).then(newTab => {
            setTimeout(() => chrome.tabs.remove(newTab.id), 3000);
        });
    });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "open-link-in-vrc-worlds-manager") {
        const url = info.linkUrl;
        if (url) {
            const deepLink = `vrc-worlds-manager://${encodeURIComponent(url)}`;
            triggerDeepLink(tab.id, deepLink);
        }
    }

    if (info.menuItemId === "search-in-vrc-worlds-manager") {
        const selectedText = info.selectionText;
        if (selectedText) {
            // Use a special prefix for search actions
            const deepLink = `vrc-worlds-manager://search/${encodeURIComponent(selectedText)}`;
            triggerDeepLink(tab.id, deepLink);
        }
    }
});
