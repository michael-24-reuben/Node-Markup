/**
 * "el-copy.outerHTML" -> copy outerHTML
 * "el-copy.selector" -> copy selector
 * "el-copy.full-selector" -> copy full selector
 * "el-copy.js-path" -> copy JS path
 * "el-copy.xpath" -> copy XPath
 * "el-copy.full-xpath" -> copy full XPath
 */
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "el-copy.outerHTML",
        title: "copy outerHTML",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "el-copy.selector",
        title: "Copy selector",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "el-copy.full-selector",
        title: "Copy full selector",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "el-copy.js-path",
        title: "Copy JS path",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "el-copy.xpath",
        title: "copy XPath",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "el-copy.full-xpath",
        title: "copy full XPath",
        contexts: ["all"]
    });

});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    chrome.storage.local.get("rightClickedElement", (data) => {
        let uniqueClass = data.rightClickedElement;
        if (!uniqueClass) return;

        chrome.scripting.executeScript({
            target: {tabId: tab.id},
            function: copyElementInfo,
            args: [
                info.menuItemId, // action
                uniqueClass      // uniqueClass
            ]
        });
    });
});


function copyElementInfo(action, uniqueClass) {
    let selectedElement = document.querySelector(".hover-highlight");

    if (!selectedElement && typeof document !== "undefined") {
        selectedElement = document.querySelector(`.${uniqueClass}`);
    }

    if (!selectedElement) {
        console.warn(`Unable to determine element: No valid selector for ${action}`);
        return;
    }

    // Check if andThen is a function before calling it
    selectedElement.classList.remove("hover-highlight", uniqueClass);

    let textToCopy = "";
    switch (action) {
        case "el-copy.outerHTML":
            textToCopy = selectedElement.outerHTML;
            break;
        case "el-copy.selector":
            textToCopy = getElementSelector(selectedElement, true);
            break;
        case "el-copy.full-selector":
            textToCopy = getElementSelector(selectedElement); // element, relative (default: false)
            break;
        case "el-copy.js-path":
            textToCopy = "document.querySelector(\"" + getElementSelector(selectedElement, true) + "\")";
            break;
        case "el-copy.xpath":
            textToCopy = getXPath(selectedElement, true);
            break;
        case "el-copy.full-xpath":
            textToCopy = getXPath(selectedElement);
            break;
    }

    let successState = false;
    if (textToCopy) {
        copyToClipboard(textToCopy).then(() => {
            showPopup("Copied successfully!", true);
            successState = true;
        }).catch(() => showPopup("Failed to copy.", false));
    } else {
        showPopup("Failed to copy.", false);
    }

    // Safer clipboard copying
    function copyToClipboard(text) {
        return navigator.clipboard.writeText(text);
    }

    /**
     * Generate a CSS selector for a given DOM element
     * @param {HTMLElement} element - The DOM element to generate a selector for
     * @param {boolean} [relative=false] - Whether to generate a relative or absolute selector
     * @returns {string} CSS selector for the element
     */
    function getElementSelector(element, relative = false) {
        return elementSelectors(element, relative).join(' > ');
    }

    function elementSelectors(element, relative = false) {
        if (!(element instanceof Element)) return [];

        let parts = [];
        while (element && element.nodeType === Node.ELEMENT_NODE) {
            if (relative && element.id) {
                parts.unshift(`#${esc(element.id)}`);
                break;
            }

            let selector = element.tagName.toLowerCase();
            if (element.id) {
                selector += `#${esc(element.id)}`;
            }

            let sibling = element;
            let nthOfType = 1;
            let nthChild = 1;
            while ((sibling = sibling.previousElementSibling)) {
                if (sibling.tagName.toLowerCase() === element.tagName.toLowerCase()) {
                    nthOfType++;
                }
                nthChild++;
            }

            if (nthOfType > 1) {
                selector += `:nth-child(${nthChild})`;
            }

            parts.unshift(selector);

            if (!relative && element.tagName.toLowerCase() === 'body') break;
            element = element.parentElement;
        }

        return parts;
    }

    /**
     * Generate an XPath for a given DOM element
     * @param {HTMLElement} element - The DOM element to generate XPath for
     * @param {boolean} [relative=false] - Whether to generate a relative or absolute XPath
     * @returns {string} XPath for the element
     */
    function getXPath(element, relative = false) {
        if (!(element instanceof Element)) return '';

        let parts = [];
        while (element && element.nodeType === Node.ELEMENT_NODE) {
            if (relative && element.id) {
                parts.unshift(`//*[@id='${element.id}']`);
                return parts.join('/');
            }

            let index = 1;
            let sibling = element;
            while ((sibling = sibling.previousElementSibling)) {
                if (sibling.tagName.toLowerCase() === element.tagName.toLowerCase()) {
                    index++;
                }
            }

            let tag = element.tagName.toLowerCase();
            let path = index > 1 || element.nextElementSibling? `${tag}[${index}]` : `${tag}`;
            parts.unshift(path);

            if (!relative && element.tagName.toLowerCase() === 'html') break;
            element = element.parentElement;
        }

        return '/' + parts.join('/');
    }

    function showPopup(message, success = true) {
        let popup = initAlertBox(success);
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
        const eventState = successState? "el-tracer-event-success" : "el-tracer-event-fail";
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

        const alertBoxElement = document.createElement('div');
        alertBoxElement.innerHTML = alertButton.trim();
        return alertBoxElement.firstElementChild;
    }

    function esc(selector) {
        return selector.replace(/([.#:[\](/)>,+~*^$= ])/g, '\\$1');
    }
}
