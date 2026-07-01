/**
 * "el-copy.outerHTML" -> copy outerHTML
 * "el-copy.full-selector" -> copy selector
 * "el-copy.js-path" -> copy JS path
 * "el-copy.full-xpath" -> copy XPath
 * "el-markdown.convert" -> render selected HTML as Markdown
 * "el-selector.build" -> open assisted CSS selector builder
 */

const TRACKING_KEY_PREFIX = "trackingEnabled_";
const SELECTION_KEY_PREFIX = "rightClickedElement_";
const SETTINGS_STORAGE_KEY = "nodeMarkupSettings";
const DEFAULT_SETTINGS = {
    selectorPathMode: "full",
    xpathPathMode: "full",
    metadataEnabled: false,
    metadataPosition: "top-right",
    highlightTemplate: "red",
    customHighlight: {
        backgroundColor: "#ff0000",
        backgroundOpacity: 0.2,
        borderEnabled: true,
        borderColor: "#ff0000",
        borderWidth: 2,
    },
    markdownOptions: {
        preferNativeParser: false,
        codeFence: "```",
        bulletMarker: "*",
        codeBlockStyle: "fenced",
        emDelimiter: "_",
        strongDelimiter: "**",
        strikeDelimiter: "~~",
        maxConsecutiveNewlines: 3,
        keepDataImages: false,
        useLinkReferenceDefinitions: false,
        useInlineLinks: true,
        ignore: "",
        blockElements: "",
    },
};

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        [
            { id: "el-copy.text", title: "Copy text" },
            { id: "separator-1", type: "separator" },
            { id: "el-copy.outerHTML", title: "Copy outerHTML" },
            { id: "el-markdown.convert", title: "Convert to Markdown" },
            { id: "el-selector.build", title: "Build CSS selector" },
            // { id: "el-copy.selector", title: "Copy relative selector" },
            { id: "el-copy.full-selector", title: "Copy selector" },
            { id: "el-copy.js-path", title: "Copy JS path" },
            // { id: "el-copy.xpath", title: "Copy relative XPath" },
            { id: "el-copy.full-xpath", title: "Copy XPath" },
            { id: "separator-2", type: "separator" },
            { id: "el-markup.launch", title: "More (coming soon...)" },
        ].forEach((item) => {
            chrome.contextMenus.create({
                ...item,
                contexts: ["all"],
            });
        });
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    if (!message?.type) return;

    switch (message.type) {
        case "NODE_MARKUP_SET_SELECTION":
            if (typeof tabId !== "number") {
                sendResponse({ ok: false });
                return;
            }

            if (!message.selectionClass) {
                sendResponse({ ok: false });
                return;
            }

            setSessionValue(getSelectionKey(tabId), message.selectionClass)
                .then(() => sendResponse({ ok: true }))
                .catch((error) => sendResponse({ ok: false, error: error?.message }));
            return true;

        case "NODE_MARKUP_GET_TRACKING_STATE":
            if (typeof tabId !== "number") {
                sendResponse({ trackingEnabled: false });
                return;
            }

            getSessionValue(getTrackingKey(tabId))
                .then((trackingEnabled) => sendResponse({ trackingEnabled: Boolean(trackingEnabled) }))
                .catch(() => sendResponse({ trackingEnabled: false }));
            return true;

        case "NODE_MARKUP_GET_SETTINGS":
            getStoredSettings()
                .then((settings) => sendResponse({ settings }))
                .catch(() => sendResponse({ settings: DEFAULT_SETTINGS }));
            return true;

        default:
            return;
    }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    void handleContextMenuClick(info.menuItemId, tab.id);
});

async function handleContextMenuClick(action, tabId) {
    try {
        const selectionClass = await getSelectionClass(tabId);
        if (!selectionClass) return;
        const settings = await getStoredSettings();

        if (action === "el-markdown.convert") {
            await sendMessageToTab(tabId, {
                type: "NODE_MARKUP_CONVERT_SELECTION_TO_MARKDOWN",
                selectionClass,
                settings,
            });
            return;
        }

        if (action === "el-selector.build") {
            await sendMessageToTab(tabId, {
                type: "NODE_MARKUP_OPEN_SELECTOR_BUILDER",
                selectionClass,
                settings,
            });
            return;
        }

        await chrome.scripting.executeScript({
            target: { tabId },
            func: copyElementInfo,
            args: [action, selectionClass, settings],
        });
    } catch (error) {
        console.warn("Unable to copy element info:", error);
    } finally {
        await removeSessionValue(getSelectionKey(tabId));
    }
}

async function getSelectionClass(tabId) {
    try {
        const response = await sendMessageToTab(tabId, { type: "NODE_MARKUP_GET_SELECTION" });
        if (response?.selectionClass) return response.selectionClass;
    } catch {
        // Ignore and fall back to session storage.
    }

    return getSessionValue(getSelectionKey(tabId));
}

function copyElementInfo(action, selectionClass, settings = {}) {
    const selectorRelative = settings.selectorPathMode === "relative";
    const xpathRelative = settings.xpathPathMode === "relative";
    let selectedElement = document.querySelector(`.${selectionClass}`);

    if (!selectedElement && typeof document !== "undefined") {
        selectedElement = document.querySelector(".hover-highlight");
    }

    if (!selectedElement) {
        showPopup("Failed to copy.", false);
        return;
    }

    selectedElement.classList.remove("hover-highlight", selectionClass);

    let textToCopy = "";
    switch (action) {
        case "el-copy.text":
            textToCopy = selectedElement.textContent.trim();
            break;
        case "el-copy.outerHTML":
            textToCopy = selectedElement.outerHTML;
            break;
        case "el-copy.selector":
        case "el-copy.full-selector":
            textToCopy = getElementSelector(selectedElement, selectorRelative);
            break;
        case "el-copy.js-path":
            textToCopy = `document.querySelector(${JSON.stringify(getElementSelector(selectedElement, selectorRelative))})`;
            break;
        case "el-copy.xpath":
        case "el-copy.full-xpath":
            textToCopy = getXPath(selectedElement, xpathRelative);
            break;
        case "el-markup.launch":
            showPopup("More options coming soon...", false);
            return;
        default:
            showPopup("Failed to copy.", false);
            return;
    }

    if (textToCopy) {
        copyToClipboard(textToCopy)
            .then(() => showPopup("Copied successfully!", true))
            .catch(() => showPopup("Failed to copy.", false));
    } else {
        showPopup("Failed to copy.", false);
    }

    function copyToClipboard(text) {
        return navigator.clipboard.writeText(text);
    }

    /**
     * Generate a CSS selector for a given DOM element.
     * @param {HTMLElement} element
     * @param {boolean} [relative=false]
     * @returns {string}
     */
    function getElementSelector(element, relative = false) {
        if (!(element instanceof Element)) return "";

        const anchor = relative ? element.closest("[id]") : document.documentElement;
        const parts = [];
        let current = element;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
            if (current === anchor) {
                parts.unshift(current === document.documentElement ? "html" : formatSelectorSegment(current, true));
                break;
            }

            parts.unshift(formatSelectorSegment(current, false));
            current = current.parentElement;
        }

        return parts.join(" > ");
    }

    function formatSelectorSegment(element, useIdOnly = false) {
        const tagName = element.tagName.toLowerCase();

        if (useIdOnly && element.id) {
            return `#${cssEscape(element.id)}`;
        }

        if (element.id) {
            return `${tagName}#${cssEscape(element.id)}`;
        }

        const parent = element.parentElement;
        const siblings = parent
            ? Array.from(parent.children).filter((sibling) => sibling.tagName === element.tagName)
            : [element];
        const index = Math.max(1, siblings.indexOf(element) + 1);

        return `${tagName}:nth-of-type(${index})`;
    }

    /**
     * Generate an XPath for a given DOM element.
     * @param {HTMLElement} element
     * @param {boolean} [relative=false]
     * @returns {string}
     */
    function getXPath(element, relative = false) {
        if (!(element instanceof Element)) return "";

        const parts = [];
        const anchor = relative ? element.closest("[id]") : null;
        let current = element;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
            if (anchor && current === anchor) {
                parts.unshift(`*[@id='${current.id}']`);
                break;
            }

            const tag = current.tagName.toLowerCase();
            let index = 1;
            let sibling = current;

            while ((sibling = sibling.previousElementSibling)) {
                if (sibling.tagName.toLowerCase() === current.tagName.toLowerCase()) {
                    index++;
                }
            }

            parts.unshift(index > 1 || current.nextElementSibling ? `${tag}[${index}]` : tag);

            if (!relative && current.tagName.toLowerCase() === "html") break;
            current = current.parentElement;
        }

        return relative && anchor ? `//${parts.join("/")}` : `/${parts.join("/")}`;
    }

    function showPopup(message, success = true) {
        const popup = initAlertBox(success);
        document.body.appendChild(popup);

        // Trigger animation (delay to ensure CSS applies)
        setTimeout(() => popup.classList.add("show"), 10);

        // Remove popup after animation completes
        setTimeout(() => {
            popup.classList.remove("show");
            setTimeout(() => popup.remove(), 500); // Wait for fade-out to complete
        }, 3000);
    }

    function initAlertBox(successState = false) {
        const eventState = successState ? "el-tracer-event-success" : "el-tracer-event-fail";
        const alertButton = `
        <button id="el-tracker-alert-box" class="el-tracer-btn el-tracer-popup ${eventState}">
            <div class="ms-logo">
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24">
                    <rect width="24" height="24" fill="none" />
                    <g fill="none" stroke="#e6e6e6" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5">
                        <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
                        <rect width="14" height="14" x="8" y="8" rx="2" />
                        <path class="hidden code-state-indicator" d="m13 13l-1 2l1 2m4-4l1 2l-1 2" />
                        <path class="hidden fail-state-indicator" d="M12 12L18 18M18 12L12 18" />
                    </g>
                </svg>
            </div>
            <div class="el-tracer-button-text">
                <span>Copy process</span>
                <span></span>
            </div>
        </button>`;

        const alertBoxElement = document.createElement("div");
        alertBoxElement.innerHTML = alertButton.trim();
        return alertBoxElement.firstElementChild;
    }

    function cssEscape(value) {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
            return CSS.escape(value);
        }

        return String(value).replace(/([.#:[\]()/>,+~*^$= ])/g, "\\$1");
    }
}

function setSessionValue(key, value) {
    return new Promise((resolve) => {
        chrome.storage.session.set({ [key]: value }, resolve);
    });
}

function getSessionValue(key) {
    return new Promise((resolve) => {
        chrome.storage.session.get(key, (data) => resolve(data[key]));
    });
}

function removeSessionValue(key) {
    return new Promise((resolve) => {
        chrome.storage.session.remove(key, resolve);
    });
}

function getStoredSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(SETTINGS_STORAGE_KEY, (data) => {
            resolve(normalizeSettings(data[SETTINGS_STORAGE_KEY]));
        });
    });
}

function normalizeSettings(settings = {}) {
    const customHighlight = {
        ...DEFAULT_SETTINGS.customHighlight,
        ...(settings.customHighlight ?? {}),
    };
    const markdownOptions = {
        ...DEFAULT_SETTINGS.markdownOptions,
        ...(settings.markdownOptions ?? {}),
    };

    return {
        ...DEFAULT_SETTINGS,
        ...settings,
        customHighlight,
        markdownOptions,
    };
}

function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            resolve(response);
        });
    });
}

function getTrackingKey(tabId) {
    return `${TRACKING_KEY_PREFIX}${tabId}`;
}

function getSelectionKey(tabId) {
    return `${SELECTION_KEY_PREFIX}${tabId}`;
}
