const selectionClass = `context-selected-${generateCryptoUUID()}`;
const SETTINGS_STORAGE_KEY = "nodeMarkupSettings";
const MARKDOWN_SNIPPET_STORAGE_KEY = "nodeMarkupMarkdownSnippetState";
let trackingEnabled = false;
let highlightedElement = null;
let metadataBadge = null;
let markdownSnippet = null;
let markdownContentElement = null;
let markdownTextarea = null;
let markdownConfigurePanel = null;
let selectorBuilderPanel = null;
let selectorBuilderState = null;
let activeMarkdown = "";
let activeMarkdownSourceHtml = "";
let markdownSnippetPosition = null;
let markdownEditing = false;
let nodeMarkupSettings = {
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

initializeTrackingState();
initializeSettings();
restoreMarkdownSnippet();
document.addEventListener("contextmenu", handleContextMenu, true);
document.addEventListener("mouseover", handleMouseOver, true);
window.addEventListener("scroll", updateMetadataPosition, true);
window.addEventListener("resize", updateMetadataPosition, true);
window.addEventListener("resize", clampMarkdownSnippetToViewport, true);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message?.type) {
        case "NODE_MARKUP_GET_SELECTION":
            sendResponse({ selectionClass });
            break;
        case "NODE_MARKUP_GET_TRACKING_STATE":
            sendResponse({ trackingEnabled });
            break;
        case "NODE_MARKUP_SET_TRACKING_STATE":
            setTrackingEnabled(Boolean(message.enabled));
            sendResponse({ ok: true });
            break;
        case "NODE_MARKUP_SET_SETTINGS":
            setNodeMarkupSettings(message.settings);
            sendResponse({ ok: true });
            break;
        case "NODE_MARKUP_CONVERT_SELECTION_TO_MARKDOWN":
            setNodeMarkupSettings(message.settings);
            convertSelectionToMarkdown(message.selectionClass)
                .then(() => sendResponse({ ok: true }))
                .catch((error) => sendResponse({ ok: false, error: error?.message }));
            return true;
        case "NODE_MARKUP_OPEN_SELECTOR_BUILDER":
            setNodeMarkupSettings(message.settings);
            openSelectorBuilder(message.selectionClass)
                .then(() => sendResponse({ ok: true }))
                .catch((error) => sendResponse({ ok: false, error: error?.message }));
            return true;
    }
});

async function initializeTrackingState() {
    try {
        const response = await chrome.runtime.sendMessage({ type: "NODE_MARKUP_GET_TRACKING_STATE" });
        setTrackingEnabled(Boolean(response?.trackingEnabled));
    } catch {
        setTrackingEnabled(false);
    }
}

async function initializeSettings() {
    try {
        const response = await chrome.runtime.sendMessage({ type: "NODE_MARKUP_GET_SETTINGS" });
        setNodeMarkupSettings(response?.settings);
    } catch {
        setNodeMarkupSettings(nodeMarkupSettings);
    }
}

function handleContextMenu(event) {
    const target = getEventElement(event);
    if (!target) return;
    if (isNodeMarkupUi(target)) return;

    document.querySelectorAll(`.${selectionClass}`).forEach((el) => {
        el.classList.remove(selectionClass);
    });

    target.classList.add(selectionClass);
    chrome.runtime.sendMessage({
        type: "NODE_MARKUP_SET_SELECTION",
        selectionClass,
    });
}

function handleMouseOver(event) {
    if (!trackingEnabled) return;

    const target = getEventElement(event);
    if (!target) return;
    if (isNodeMarkupUi(target)) return;

    setHighlightedElement(target);
}

function setTrackingEnabled(enabled) {
    trackingEnabled = enabled;
    if (!trackingEnabled) {
        clearHighlightedElement();
    } else if (highlightedElement) {
        setHighlightedElement(highlightedElement);
    }
}

function setNodeMarkupSettings(settings = {}) {
    nodeMarkupSettings = normalizeSettings(settings);
    if (highlightedElement) {
        applyHighlightTemplate(highlightedElement);
        renderMetadata(highlightedElement);
    }

    renderMarkdownConfigureControls();
}

function setHighlightedElement(element) {
    if (highlightedElement && highlightedElement !== element) {
        resetHighlightStyles(highlightedElement);
        highlightedElement.classList.remove("hover-highlight");
    }

    document.querySelectorAll(".hover-highlight").forEach((el) => {
        if (el !== element) {
            resetHighlightStyles(el);
            el.classList.remove("hover-highlight");
        }
    });

    highlightedElement = element;
    highlightedElement.classList.add("hover-highlight");
    applyHighlightTemplate(highlightedElement);
    renderMetadata(highlightedElement);
}

function clearHighlightedElement() {
    if (highlightedElement) {
        resetHighlightStyles(highlightedElement);
        highlightedElement.classList.remove("hover-highlight");
    }

    document.querySelectorAll(".hover-highlight").forEach((el) => {
        resetHighlightStyles(el);
        el.classList.remove("hover-highlight");
    });

    highlightedElement = null;
    removeMetadataBadge();
}

function applyHighlightTemplate(element) {
    const template = getActiveHighlightTemplate();
    element.style.setProperty("--node-markup-highlight-bg", template.backgroundColor);
    element.style.setProperty("--node-markup-highlight-border-color", template.borderColor);
    element.style.setProperty("--node-markup-highlight-border-width", template.borderWidth);
}

function resetHighlightStyles(element) {
    element.style.removeProperty("--node-markup-highlight-bg");
    element.style.removeProperty("--node-markup-highlight-border-color");
    element.style.removeProperty("--node-markup-highlight-border-width");
}

function renderMetadata(element) {
    if (!trackingEnabled || !nodeMarkupSettings.metadataEnabled) {
        removeMetadataBadge();
        return;
    }

    if (!metadataBadge) {
        metadataBadge = document.createElement("div");
        metadataBadge.className = "node-markup-metadata-badge";
        document.body.appendChild(metadataBadge);
    }

    metadataBadge.textContent = getElementMetadata(element);
    updateMetadataPosition();
}

function updateMetadataPosition() {
    if (!metadataBadge || !highlightedElement || !document.body.contains(highlightedElement)) return;

    const rect = highlightedElement.getBoundingClientRect();
    const badgeRect = metadataBadge.getBoundingClientRect();
    const offset = 8;
    const position = nodeMarkupSettings.metadataPosition;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let top = rect.top - badgeRect.height - offset;
    let left = rect.right + offset;

    switch (position) {
        case "top-left":
            top = rect.top - badgeRect.height - offset;
            left = rect.left;
            break;
        case "top-center":
            top = rect.top - badgeRect.height - offset;
            left = rect.left + rect.width / 2 - badgeRect.width / 2;
            break;
        case "top-right":
            top = rect.top - badgeRect.height - offset;
            left = rect.right - badgeRect.width;
            break;
        case "center-left":
            top = rect.top + rect.height / 2 - badgeRect.height / 2;
            left = rect.left - badgeRect.width - offset;
            break;
        case "center-right":
            top = rect.top + rect.height / 2 - badgeRect.height / 2;
            left = rect.right + offset;
            break;
        case "bottom-left":
            top = rect.bottom + offset;
            left = rect.left;
            break;
        case "bottom-center":
            top = rect.bottom + offset;
            left = rect.left + rect.width / 2 - badgeRect.width / 2;
            break;
        case "bottom-right":
            top = rect.bottom + offset;
            left = rect.right - badgeRect.width;
            break;
    }

    metadataBadge.style.top = `${clamp(top, 0, Math.max(0, viewportHeight - badgeRect.height))}px`;
    metadataBadge.style.left = `${clamp(left, 0, Math.max(0, viewportWidth - badgeRect.width))}px`;
}

function removeMetadataBadge() {
    metadataBadge?.remove();
    metadataBadge = null;
}

async function openSelectorBuilder(selectedClass) {
    const selectedElement = document.querySelector(`.${selectedClass}`)
        ?? highlightedElement
        ?? document.querySelector(".hover-highlight");

    if (!selectedElement) {
        showMarkdownToast("No element selected.");
        return;
    }

    selectedElement.classList.remove(selectedClass);
    removeSelectorBuilderHighlights();

    const target = selectedElement;
    const initialToken = chooseDefaultSelectorToken(target);
    selectorBuilderState = {
        target,
        currentElement: target,
        steps: [
            {
                element: target,
                token: initialToken.selector,
            },
        ],
        mode: "unique",
        combinator: ">",
        validation: null,
        parentClusters: [],
    };

    renderSelectorBuilder();
}

function renderSelectorBuilder() {
    if (!selectorBuilderState) return;

    if (!selectorBuilderPanel) {
        selectorBuilderPanel = document.createElement("section");
        selectorBuilderPanel.className = "node-markup-selector-builder";
        selectorBuilderPanel.setAttribute("aria-label", "CSS selector builder");
        document.body.appendChild(selectorBuilderPanel);
    }

    const currentMeta = getSelectorElementMeta(selectorBuilderState.currentElement);
    const tokens = generateSelectorTokens(selectorBuilderState.currentElement);
    const currentStep = getCurrentSelectorStep();
    const validation = validateSelectorBuilder();
    selectorBuilderState.validation = validation;
    selectorBuilderState.parentClusters = buildParentClusters(validation.matches);

    selectorBuilderPanel.innerHTML = `
        <div class="node-markup-selector-builder__header">
            <div>
                <div class="node-markup-selector-builder__eyebrow">CSS Selector Builder</div>
                <div class="node-markup-selector-builder__target">${escapeAttribute(formatElementLabel(selectorBuilderState.target))}</div>
            </div>
            <button class="node-markup-selector-builder__icon-button" type="button" data-selector-action="close" aria-label="Close" title="Close">x</button>
        </div>
        <div class="node-markup-selector-builder__body">
            <div class="node-markup-selector-builder__meta">
                <div><span>Node</span><strong>${escapeAttribute(formatElementLabel(selectorBuilderState.currentElement))}</strong></div>
                <div><span>ID</span><strong>${escapeAttribute(currentMeta.id || "none")}</strong></div>
                <div><span>Classes</span><strong>${escapeAttribute(currentMeta.classes.join(" ") || "none")}</strong></div>
                <div><span>Attrs</span><strong>${escapeAttribute(formatSelectorAttributes(currentMeta.attrs))}</strong></div>
                <div><span>Text</span><strong>${escapeAttribute(currentMeta.textPreview || "none")}</strong></div>
                <div><span>Depth</span><strong>${selectorBuilderState.steps.length - 1}</strong></div>
                <div><span>Mode</span><strong>${selectorBuilderState.mode}</strong></div>
            </div>
            <div class="node-markup-selector-builder__section">
                <div class="node-markup-selector-builder__section-title">Keeper Tokens</div>
                <div class="node-markup-selector-builder__tokens">
                    ${tokens.map((token) => renderSelectorToken(token, currentStep.token)).join("")}
                </div>
            </div>
            <div class="node-markup-selector-builder__section">
                <div class="node-markup-selector-builder__section-title">Selector Console</div>
                <pre class="node-markup-selector-builder__selector">${escapeAttribute(validation.selector || "")}</pre>
                <div class="node-markup-selector-builder__diagnostics ${validationStatusClass(validation)}">
                    <span>Matches: ${validation.matchCount}</span>
                    <span>Target: ${validation.includesTarget ? "yes" : "no"}</span>
                    <span>${escapeAttribute(getValidationLabel(validation))}</span>
                </div>
                ${renderParentClusters(selectorBuilderState.parentClusters)}
            </div>
            <div class="node-markup-selector-builder__controls" role="group" aria-label="Selector builder controls">
                <button type="button" data-selector-action="mode" data-selector-mode="unique" class="${selectorBuilderState.mode === "unique" ? "is-active" : ""}">Unique</button>
                <button type="button" data-selector-action="mode" data-selector-mode="group" class="${selectorBuilderState.mode === "group" ? "is-active" : ""}">Group</button>
                <button type="button" data-selector-action="combinator" data-selector-combinator=">" class="${selectorBuilderState.combinator === ">" ? "is-active" : ""}">&gt;</button>
                <button type="button" data-selector-action="combinator" data-selector-combinator=" " class="${selectorBuilderState.combinator === " " ? "is-active" : ""}">space</button>
            </div>
        </div>
        <div class="node-markup-selector-builder__footer">
            <button type="button" data-selector-action="back" ${selectorBuilderState.steps.length <= 1 ? "disabled" : ""}>Back</button>
            <button type="button" data-selector-action="parent" ${selectorBuilderState.currentElement.parentElement ? "" : "disabled"}>Next Parent</button>
            <button type="button" data-selector-action="copy" ${validation.selector ? "" : "disabled"}>Copy</button>
        </div>
    `;

    bindSelectorBuilderEvents();
    highlightSelectorBuilderMatches(validation.matches);
}

function renderSelectorToken(token, selectedToken) {
    const selectedClass = token.selector === selectedToken ? " is-active" : "";
    return `
        <button class="node-markup-selector-token${selectedClass}" type="button" data-selector-action="token" data-token="${escapeAttribute(token.selector)}">
            <span>${escapeAttribute(token.label)}</span>
            <small>${escapeAttribute(token.quality)}</small>
        </button>
    `;
}

function renderParentClusters(clusters) {
    if (!clusters.length) return "";

    return `
        <div class="node-markup-selector-builder__clusters">
            <div class="node-markup-selector-builder__section-title">Parent Clusters</div>
            ${clusters.map((cluster) => `
                <div class="node-markup-selector-builder__cluster">
                    <span>${escapeAttribute(cluster.signature)}</span>
                    <strong>${cluster.count}</strong>
                </div>
            `).join("")}
        </div>
    `;
}

function bindSelectorBuilderEvents() {
    if (!selectorBuilderPanel || !selectorBuilderState) return;

    selectorBuilderPanel.querySelectorAll("[data-selector-action]").forEach((control) => {
        control.addEventListener("click", () => handleSelectorBuilderAction(control));
    });
}

function handleSelectorBuilderAction(control) {
    if (!selectorBuilderState) return;

    switch (control.dataset.selectorAction) {
        case "close":
            closeSelectorBuilder();
            return;
        case "token":
            getCurrentSelectorStep().token = control.dataset.token || "";
            renderSelectorBuilder();
            return;
        case "mode":
            selectorBuilderState.mode = control.dataset.selectorMode || "unique";
            renderSelectorBuilder();
            return;
        case "combinator":
            selectorBuilderState.combinator = control.dataset.selectorCombinator === " " ? " " : ">";
            renderSelectorBuilder();
            return;
        case "parent":
            moveSelectorBuilderToParent();
            return;
        case "back":
            moveSelectorBuilderBack();
            return;
        case "copy":
            copySelectorBuilderSelector();
            return;
    }
}

function moveSelectorBuilderToParent() {
    if (!selectorBuilderState?.currentElement?.parentElement) return;

    const parent = selectorBuilderState.currentElement.parentElement;
    selectorBuilderState.currentElement = parent;
    selectorBuilderState.steps.push({
        element: parent,
        token: chooseDefaultSelectorToken(parent).selector,
    });
    renderSelectorBuilder();
}

function moveSelectorBuilderBack() {
    if (!selectorBuilderState || selectorBuilderState.steps.length <= 1) return;

    selectorBuilderState.steps.pop();
    selectorBuilderState.currentElement = getCurrentSelectorStep().element;
    renderSelectorBuilder();
}

async function copySelectorBuilderSelector() {
    const selector = selectorBuilderState?.validation?.selector;
    if (!selector) return;

    await navigator.clipboard.writeText(selector);
    showMarkdownToast("Selector copied.");
}

function closeSelectorBuilder() {
    removeSelectorBuilderHighlights();
    selectorBuilderPanel?.remove();
    selectorBuilderPanel = null;
    selectorBuilderState = null;
}

function getCurrentSelectorStep() {
    return selectorBuilderState.steps[selectorBuilderState.steps.length - 1];
}

function composeSelectorBuilderSelector() {
    if (!selectorBuilderState) return "";

    return selectorBuilderState.steps
        .slice()
        .reverse()
        .map((step) => step.token)
        .filter(Boolean)
        .join(selectorBuilderState.combinator === " " ? " " : " > ");
}

function validateSelectorBuilder() {
    const selector = composeSelectorBuilderSelector();
    const result = {
        selector,
        matches: [],
        matchCount: 0,
        includesTarget: false,
        uniqueValid: false,
        groupValid: false,
        error: null,
    };

    if (!selector) return result;

    try {
        result.matches = Array.from(document.querySelectorAll(selector))
            .filter((element) => !isNodeMarkupUi(element));
        result.matchCount = result.matches.length;
        result.includesTarget = result.matches.includes(selectorBuilderState.target);
        result.uniqueValid = result.includesTarget && result.matchCount === 1;
        result.groupValid = result.includesTarget && result.matchCount >= 1;
    } catch (error) {
        result.error = error?.message || "Invalid selector";
    }

    return result;
}

function validationStatusClass(validation) {
    if (validation.error) return "is-invalid";
    if (selectorBuilderState.mode === "unique") return validation.uniqueValid ? "is-valid" : "is-warning";
    return validation.groupValid ? "is-valid" : "is-warning";
}

function getValidationLabel(validation) {
    if (validation.error) return validation.error;
    if (selectorBuilderState.mode === "unique") {
        return validation.uniqueValid ? "valid unique selector" : "not unique";
    }

    return validation.groupValid ? "valid group selector" : "target missing";
}

function highlightSelectorBuilderMatches(matches) {
    removeSelectorBuilderHighlights();

    matches.forEach((element) => {
        element.classList.add("node-markup-selector-match");
    });

    selectorBuilderState?.target?.classList.add("node-markup-selector-target");
    selectorBuilderState?.currentElement?.classList.add("node-markup-selector-current");
}

function removeSelectorBuilderHighlights() {
    document
        .querySelectorAll(".node-markup-selector-match, .node-markup-selector-target, .node-markup-selector-current")
        .forEach((element) => {
            element.classList.remove("node-markup-selector-match", "node-markup-selector-target", "node-markup-selector-current");
        });
}

function buildParentClusters(matches) {
    if (!matches || matches.length < 2) return [];

    const clusters = new Map();
    matches.forEach((match) => {
        const parent = match.parentElement;
        if (!parent || isNodeMarkupUi(parent)) return;

        const signature = getParentClusterSignature(parent);
        const existing = clusters.get(signature) ?? { signature, count: 0 };
        existing.count += 1;
        clusters.set(signature, existing);
    });

    return Array.from(clusters.values())
        .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature))
        .slice(0, 4);
}

function getParentClusterSignature(element) {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : "";
    const classes = Array.from(element.classList)
        .filter(isSelectorUserClass)
        .slice(0, 2)
        .map((className) => `.${className}`)
        .join("");

    return `${tag}${id}${classes}`;
}

function getSelectorElementMeta(element) {
    const attrs = {};
    Array.from(element.attributes ?? []).forEach((attr) => {
        if (isUsefulSelectorAttribute(attr.name, attr.value)) {
            attrs[attr.name] = attr.value;
        }
    });

    return {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        classes: Array.from(element.classList).filter(isSelectorUserClass),
        attrs,
        textPreview: getSelectorTextPreview(element),
        nthOfType: getNthOfType(element),
        nthChild: Array.from(element.parentElement?.children ?? []).indexOf(element) + 1,
    };
}

function generateSelectorTokens(element) {
    const meta = getSelectorElementMeta(element);
    const tokens = [];

    if (meta.id) {
        tokens.push(createSelectorToken(`#${cssEscape(meta.id)}`, "id", "recommended", `id ${meta.id}`));
        tokens.push(createSelectorToken(`${meta.tag}#${cssEscape(meta.id)}`, "tag-id", "recommended", `${meta.tag} with id`));
    }

    meta.classes.forEach((className) => {
        const generated = isGeneratedClassName(className);
        tokens.push(createSelectorToken(`.${cssEscape(className)}`, "class", generated ? "advanced" : "recommended", className));
        tokens.push(createSelectorToken(`${meta.tag}.${cssEscape(className)}`, "tag-class", generated ? "advanced" : "acceptable", `${meta.tag}.${className}`));
    });

    Object.entries(meta.attrs).forEach(([name, value]) => {
        const selector = `[${name}="${cssStringEscape(value)}"]`;
        const quality = /^(data-testid|data-test|data-cy|aria-label|name)$/i.test(name)
            ? "recommended"
            : "acceptable";
        tokens.push(createSelectorToken(selector, "attribute", quality, `${name} attribute`));
        tokens.push(createSelectorToken(`${meta.tag}${selector}`, "tag-attribute", quality, `${meta.tag} ${name}`));
    });

    tokens.push(createSelectorToken(meta.tag, "tag", "acceptable", "element tag"));
    tokens.push(createSelectorToken(`${meta.tag}:nth-of-type(${meta.nthOfType})`, "nth", "risky", "position fallback"));

    return uniqueSelectorTokens(tokens)
        .sort((a, b) => selectorQualityRank(a.quality) - selectorQualityRank(b.quality) || a.label.length - b.label.length);
}

function chooseDefaultSelectorToken(element) {
    const tokens = generateSelectorTokens(element);
    return tokens.find((token) => token.quality === "recommended")
        ?? tokens.find((token) => token.quality === "acceptable")
        ?? tokens[0]
        ?? createSelectorToken(element.tagName.toLowerCase(), "tag", "acceptable", "element tag");
}

function createSelectorToken(selector, kind, quality, reason) {
    return {
        label: selector,
        selector,
        kind,
        quality,
        reason,
    };
}

function uniqueSelectorTokens(tokens) {
    const seen = new Set();
    return tokens.filter((token) => {
        if (!token.selector || seen.has(token.selector)) return false;
        seen.add(token.selector);
        return true;
    });
}

function selectorQualityRank(quality) {
    return {
        recommended: 0,
        acceptable: 1,
        risky: 2,
        advanced: 3,
    }[quality] ?? 4;
}

function isUsefulSelectorAttribute(name, value) {
    if (!value || value.length > 96 || !/^[a-zA-Z_:-][\w:.-]*$/.test(name)) return false;

    return /^(data-testid|data-test|data-cy|aria-label|name|type|href|title|role|alt)$/i.test(name);
}

function isSelectorUserClass(className) {
    return ![
        "hover-highlight",
        selectionClass,
        "node-markup-selector-match",
        "node-markup-selector-target",
        "node-markup-selector-current",
    ].includes(className);
}

function isGeneratedClassName(className) {
    return classComplexityScore(className) >= 40;
}

function classComplexityScore(className) {
    let score = 0;
    score += className.length;
    score += (className.match(/[-_]/g)?.length ?? 0) * 3;
    score += (className.match(/[0-9]/g)?.length ?? 0) * 4;

    if (/^(css|sc|jsx|style|emotion|chakra|mui)-?[a-z0-9_-]+/i.test(className)) {
        score += 50;
    }

    if (/^[a-z]{1,12}$/i.test(className)) {
        score -= 15;
    }

    if (/^(quote|next|prev|title|author|price|card|item|row|result|article|content|pagination|pager)$/i.test(className)) {
        score -= 25;
    }

    return score;
}

function formatElementLabel(element) {
    const meta = getSelectorElementMeta(element);
    const id = meta.id ? `#${meta.id}` : "";
    const classes = meta.classes.slice(0, 2).map((className) => `.${className}`).join("");

    return `<${meta.tag}${id}${classes}>`;
}

function formatSelectorAttributes(attrs) {
    const entries = Object.entries(attrs);
    if (!entries.length) return "none";

    return entries
        .slice(0, 3)
        .map(([name, value]) => `${name}="${value}"`)
        .join(" ");
}

function getSelectorTextPreview(element) {
    const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return "";

    return text.length > 56 ? `${text.slice(0, 55)}...` : text;
}

function getNthOfType(element) {
    const tag = element.tagName;
    const siblings = Array.from(element.parentElement?.children ?? [])
        .filter((sibling) => sibling.tagName === tag);

    return Math.max(1, siblings.indexOf(element) + 1);
}

function cssEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
    }

    return String(value).replace(/([.#:[\]()/>,+~*^$= ])/g, "\\$1");
}

function cssStringEscape(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ");
}

async function convertSelectionToMarkdown(selectedClass) {
    const selectedElement = document.querySelector(`.${selectedClass}`)
        ?? highlightedElement
        ?? document.querySelector(".hover-highlight");

    if (!selectedElement) {
        showMarkdownToast("No element selected.");
        return;
    }

    activeMarkdownSourceHtml = selectedElement.outerHTML;
    activeMarkdown = translateHtmlToMarkdown(activeMarkdownSourceHtml);
    markdownEditing = false;
    renderMarkdownSnippet();
    await persistMarkdownSnippetState();
}

function translateHtmlToMarkdown(html) {
    const bundle = globalThis.NodeHtmlMarkdownBundle;
    const translator = bundle?.NodeHtmlMarkdown;

    if (!translator?.translate) {
        throw new Error("node-html-markdown is not loaded.");
    }

    return translator.translate(html, getMarkdownTranslatorOptions()).trim();
}

function getMarkdownTranslatorOptions() {
    const options = nodeMarkupSettings.markdownOptions ?? {};
    const ignore = parseCsvOption(options.ignore);
    const blockElements = parseCsvOption(options.blockElements);
    const translatorOptions = {
        preferNativeParser: Boolean(options.preferNativeParser),
        codeFence: options.codeFence || "```",
        bulletMarker: options.bulletMarker || "*",
        codeBlockStyle: options.codeBlockStyle === "indented" ? "indented" : "fenced",
        emDelimiter: options.emDelimiter || "_",
        strongDelimiter: options.strongDelimiter || "**",
        strikeDelimiter: options.strikeDelimiter || "~~",
        maxConsecutiveNewlines: Math.max(1, Number(options.maxConsecutiveNewlines) || 3),
        keepDataImages: Boolean(options.keepDataImages),
        useLinkReferenceDefinitions: Boolean(options.useLinkReferenceDefinitions),
        useInlineLinks: Boolean(options.useInlineLinks),
    };

    if (ignore.length) translatorOptions.ignore = ignore;
    if (blockElements.length) translatorOptions.blockElements = blockElements;

    return translatorOptions;
}

function renderMarkdownSnippet() {
    if (!markdownSnippet) {
        markdownSnippet = document.createElement("section");
        markdownSnippet.className = "node-markup-markdown-snippet";
        markdownSnippet.setAttribute("aria-label", "Markdown snippet");
        markdownSnippet.innerHTML = `
            <div class="node-markup-markdown-snippet__header">
                <span class="node-markup-markdown-snippet__brand" aria-hidden="true"></span>
                <button class="node-markup-markdown-snippet__icon-button" type="button" data-markdown-action="save" title="Save as" aria-label="Save as">
                    <span class="node-markup-markdown-snippet__save-icon" aria-hidden="true"></span>
                </button>
                <button class="node-markup-markdown-snippet__icon-button" type="button" data-markdown-action="copy" title="Copy Markdown" aria-label="Copy Markdown">
                    <span class="node-markup-markdown-snippet__copy-icon" aria-hidden="true"></span>
                </button>
                <button class="node-markup-markdown-snippet__drag" type="button" title="Drag Markdown snippet" aria-label="Drag Markdown snippet">
                    <span class="node-markup-markdown-snippet__drag-icon" aria-hidden="true"></span>
                </button>
                <button class="node-markup-markdown-snippet__icon-button" type="button" data-markdown-action="close" title="Close" aria-label="Close">
                    <span class="node-markup-markdown-snippet__close-icon" aria-hidden="true"></span>
                </button>
            </div>
            <pre class="node-markup-markdown-snippet__content"></pre>
            <textarea class="node-markup-markdown-snippet__editor" spellcheck="false" aria-label="Edit Markdown"></textarea>
            <div class="node-markup-markdown-snippet__configure" aria-hidden="true"></div>
            <div class="node-markup-markdown-snippet__footer">
                <button class="node-markup-markdown-snippet__icon-button" type="button" data-markdown-action="configure" title="Configure" aria-label="Configure">
                    <span class="node-markup-markdown-snippet__configure-icon" aria-hidden="true"></span>
                </button>
                <button class="node-markup-markdown-snippet__icon-button" type="button" data-markdown-action="edit" title="Edit note" aria-label="Edit note">
                    <span class="node-markup-markdown-snippet__edit-icon" aria-hidden="true"></span>
                </button>
            </div>
        `;
        document.body.appendChild(markdownSnippet);
        markdownContentElement = markdownSnippet.querySelector(".node-markup-markdown-snippet__content");
        markdownTextarea = markdownSnippet.querySelector(".node-markup-markdown-snippet__editor");
        markdownConfigurePanel = markdownSnippet.querySelector(".node-markup-markdown-snippet__configure");
        setMarkdownIconUrls(markdownSnippet);
        bindMarkdownSnippetEvents();
        renderMarkdownConfigureControls();
    }

    markdownContentElement.textContent = activeMarkdown;
    markdownTextarea.value = activeMarkdown;
    markdownSnippet.classList.toggle("is-editing", markdownEditing);
    applyMarkdownSnippetPosition();
}

function setMarkdownIconUrls(container) {
    const iconMap = {
        ".node-markup-markdown-snippet__brand": "markdown-logo.svg",
        ".node-markup-markdown-snippet__drag-icon": "drag-drop.svg",
        ".node-markup-markdown-snippet__copy-icon": "markdown-copy.svg",
        ".node-markup-markdown-snippet__save-icon": "save.svg",
        ".node-markup-markdown-snippet__close-icon": "close.svg",
        ".node-markup-markdown-snippet__configure-icon": "configure.svg",
        ".node-markup-markdown-snippet__edit-icon": "edit-note.svg",
    };

    Object.entries(iconMap).forEach(([selector, iconName]) => {
        container.querySelector(selector)?.style.setProperty(
            "--node-markup-markdown-icon",
            `url("${chrome.runtime.getURL(`assets/icons/${iconName}`)}")`,
        );
    });
}

function bindMarkdownSnippetEvents() {
    markdownSnippet.querySelector("[data-markdown-action='copy']")?.addEventListener("click", copyMarkdownToClipboard);
    markdownSnippet.querySelector("[data-markdown-action='save']")?.addEventListener("click", saveMarkdownToFile);
    markdownSnippet.querySelector("[data-markdown-action='close']")?.addEventListener("click", closeMarkdownSnippet);
    markdownSnippet.querySelector("[data-markdown-action='configure']")?.addEventListener("click", toggleMarkdownConfigurePanel);
    markdownSnippet.querySelector("[data-markdown-action='edit']")?.addEventListener("click", toggleMarkdownEditing);
    markdownSnippet.querySelector(".node-markup-markdown-snippet__drag")?.addEventListener("pointerdown", startMarkdownSnippetDrag);
}

function renderMarkdownConfigureControls() {
    if (!markdownConfigurePanel) return;

    const options = normalizeSettings(nodeMarkupSettings).markdownOptions;
    markdownConfigurePanel.innerHTML = `
        <div class="node-markup-markdown-config__title">Markdown Options</div>
        <label>Code fence <input data-markdown-option="codeFence" type="text" value="${escapeAttribute(options.codeFence)}"></label>
        <label>Bullet marker <input data-markdown-option="bulletMarker" type="text" maxlength="2" value="${escapeAttribute(options.bulletMarker)}"></label>
        <label>Code blocks
            <select data-markdown-option="codeBlockStyle">
                <option value="fenced"${options.codeBlockStyle === "fenced" ? " selected" : ""}>Fenced</option>
                <option value="indented"${options.codeBlockStyle === "indented" ? " selected" : ""}>Indented</option>
            </select>
        </label>
        <label>Emphasis <input data-markdown-option="emDelimiter" type="text" value="${escapeAttribute(options.emDelimiter)}"></label>
        <label>Strong <input data-markdown-option="strongDelimiter" type="text" value="${escapeAttribute(options.strongDelimiter)}"></label>
        <label>Strike <input data-markdown-option="strikeDelimiter" type="text" value="${escapeAttribute(options.strikeDelimiter)}"></label>
        <label>Max newlines <input data-markdown-option="maxConsecutiveNewlines" type="number" min="1" max="10" value="${escapeAttribute(options.maxConsecutiveNewlines)}"></label>
        <label>Ignore elements <input data-markdown-option="ignore" type="text" placeholder="script, style" value="${escapeAttribute(options.ignore)}"></label>
        <label>Block elements <input data-markdown-option="blockElements" type="text" placeholder="article, section" value="${escapeAttribute(options.blockElements)}"></label>
        <label class="node-markup-markdown-config__toggle"><input data-markdown-option="preferNativeParser" type="checkbox"${options.preferNativeParser ? " checked" : ""}> Native parser</label>
        <label class="node-markup-markdown-config__toggle"><input data-markdown-option="keepDataImages" type="checkbox"${options.keepDataImages ? " checked" : ""}> Keep data images</label>
        <label class="node-markup-markdown-config__toggle"><input data-markdown-option="useLinkReferenceDefinitions" type="checkbox"${options.useLinkReferenceDefinitions ? " checked" : ""}> Reference links</label>
        <label class="node-markup-markdown-config__toggle"><input data-markdown-option="useInlineLinks" type="checkbox"${options.useInlineLinks ? " checked" : ""}> Inline URL links</label>
    `;

    markdownConfigurePanel.querySelectorAll("[data-markdown-option]").forEach((control) => {
        const eventName = control.type === "checkbox" || control.tagName === "SELECT" ? "change" : "input";
        control.addEventListener(eventName, () => updateMarkdownOption(control));
    });
}

async function updateMarkdownOption(control) {
    const key = control.dataset.markdownOption;
    const rawValue = control.type === "checkbox" ? control.checked : control.value;
    const value = key === "maxConsecutiveNewlines" ? Number(rawValue) : rawValue;

    nodeMarkupSettings = normalizeSettings({
        ...nodeMarkupSettings,
        markdownOptions: {
            ...nodeMarkupSettings.markdownOptions,
            [key]: value,
        },
    });

    await setSyncStorageValue(SETTINGS_STORAGE_KEY, nodeMarkupSettings);

    if (activeMarkdownSourceHtml) {
        activeMarkdown = translateHtmlToMarkdown(activeMarkdownSourceHtml);
        if (markdownContentElement) markdownContentElement.textContent = activeMarkdown;
        if (markdownTextarea && !markdownEditing) markdownTextarea.value = activeMarkdown;
        await persistMarkdownSnippetState();
    }
}

async function copyMarkdownToClipboard() {
    await navigator.clipboard.writeText(getCurrentMarkdown());
    showMarkdownToast("Markdown copied.");
}

function saveMarkdownToFile() {
    const blob = new Blob([getCurrentMarkdown()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "node-markup-snippet.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function closeMarkdownSnippet() {
    markdownSnippet?.remove();
    markdownSnippet = null;
    markdownContentElement = null;
    markdownTextarea = null;
    markdownConfigurePanel = null;
    markdownEditing = false;

    await setLocalStorageValue(MARKDOWN_SNIPPET_STORAGE_KEY, {
        visible: false,
        markdown: activeMarkdown,
        sourceHtml: activeMarkdownSourceHtml,
        position: markdownSnippetPosition,
    });
}

function toggleMarkdownConfigurePanel() {
    const open = !markdownSnippet.classList.contains("is-configuring");
    markdownSnippet.classList.toggle("is-configuring", open);
    markdownConfigurePanel?.setAttribute("aria-hidden", String(!open));
}

async function toggleMarkdownEditing() {
    if (markdownEditing) {
        activeMarkdown = markdownTextarea.value;
        markdownContentElement.textContent = activeMarkdown;
        markdownEditing = false;
        markdownSnippet.classList.remove("is-editing");
        await persistMarkdownSnippetState();
        return;
    }

    markdownTextarea.value = activeMarkdown;
    markdownEditing = true;
    markdownSnippet.classList.add("is-editing");
    markdownTextarea.focus();
}

function getCurrentMarkdown() {
    return markdownEditing ? markdownTextarea.value : activeMarkdown;
}

function startMarkdownSnippetDrag(event) {
    if (!markdownSnippet) return;

    event.preventDefault();
    const rect = markdownSnippet.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    try {
        markdownSnippet.setPointerCapture(event.pointerId);
    } catch {
        // Some pages/tools do not preserve pointer capture during synthetic drags.
    }
    markdownSnippet.classList.add("is-dragging");

    const handleMove = (moveEvent) => {
        markdownSnippetPosition = clampMarkdownPosition({
            left: moveEvent.clientX - offsetX,
            top: moveEvent.clientY - offsetY,
        });
        applyMarkdownSnippetPosition();
    };
    const handleUp = async (upEvent) => {
        try {
            markdownSnippet.releasePointerCapture(upEvent.pointerId);
        } catch {
            // Ignore release failures after pointer capture has already been lost.
        }
        markdownSnippet.classList.remove("is-dragging");
        markdownSnippet.removeEventListener("pointermove", handleMove);
        markdownSnippet.removeEventListener("pointerup", handleUp);
        markdownSnippet.removeEventListener("pointercancel", handleUp);
        document.removeEventListener("pointermove", handleMove, true);
        document.removeEventListener("pointerup", handleUp, true);
        document.removeEventListener("pointercancel", handleUp, true);
        await persistMarkdownSnippetState();
    };

    markdownSnippet.addEventListener("pointermove", handleMove);
    markdownSnippet.addEventListener("pointerup", handleUp);
    markdownSnippet.addEventListener("pointercancel", handleUp);
    document.addEventListener("pointermove", handleMove, true);
    document.addEventListener("pointerup", handleUp, true);
    document.addEventListener("pointercancel", handleUp, true);
}

function applyMarkdownSnippetPosition() {
    if (!markdownSnippet) return;

    if (!markdownSnippetPosition) {
        markdownSnippet.style.left = "";
        markdownSnippet.style.top = "";
        markdownSnippet.style.right = "20px";
        markdownSnippet.style.bottom = "20px";
        return;
    }

    markdownSnippetPosition = clampMarkdownPosition(markdownSnippetPosition);
    markdownSnippet.style.left = `${markdownSnippetPosition.left}px`;
    markdownSnippet.style.top = `${markdownSnippetPosition.top}px`;
    markdownSnippet.style.right = "auto";
    markdownSnippet.style.bottom = "auto";
}

function clampMarkdownSnippetToViewport() {
    if (!markdownSnippet || !markdownSnippetPosition) return;

    markdownSnippetPosition = clampMarkdownPosition(markdownSnippetPosition);
    applyMarkdownSnippetPosition();
    void persistMarkdownSnippetState();
}

function clampMarkdownPosition(position) {
    const rect = markdownSnippet?.getBoundingClientRect();
    const width = rect?.width || 360;
    const height = rect?.height || 360;
    const edgePadding = 8;

    return {
        left: clamp(position.left, edgePadding, Math.max(edgePadding, window.innerWidth - width - edgePadding)),
        top: clamp(position.top, edgePadding, Math.max(edgePadding, window.innerHeight - height - edgePadding)),
    };
}

async function persistMarkdownSnippetState() {
    await setLocalStorageValue(MARKDOWN_SNIPPET_STORAGE_KEY, {
        visible: Boolean(markdownSnippet),
        markdown: getCurrentMarkdown(),
        sourceHtml: activeMarkdownSourceHtml,
        position: markdownSnippetPosition,
    });
}

async function restoreMarkdownSnippet() {
    const state = await getLocalStorageValue(MARKDOWN_SNIPPET_STORAGE_KEY);
    if (!state?.visible || !state.markdown) return;

    activeMarkdown = state.markdown;
    activeMarkdownSourceHtml = state.sourceHtml || "";
    markdownSnippetPosition = state.position || null;
    markdownEditing = false;
    renderMarkdownSnippet();
}

function showMarkdownToast(message) {
    const toast = document.createElement("div");
    toast.className = "node-markup-markdown-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.classList.add("show"), 20);
    window.setTimeout(() => {
        toast.classList.remove("show");
        window.setTimeout(() => toast.remove(), 250);
    }, 1800);
}

function getElementMetadata(element) {
    const rect = element.getBoundingClientRect();
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : "";
    const classes = Array.from(element.classList)
        .filter((className) => className !== "hover-highlight" && className !== selectionClass)
        .slice(0, 3)
        .map((className) => `.${className}`)
        .join("");
    const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    const selector = truncateMetadataSelector(`${tag}${id}${classes}`);

    return `${selector} | ${size}`;
}

function truncateMetadataSelector(selector, maxLength = 32) {
    if (selector.length <= maxLength) return selector;

    return `${selector.slice(0, Math.max(0, maxLength - 1))}...`;
}

function getActiveHighlightTemplate() {
    if (nodeMarkupSettings.highlightTemplate === "custom") {
        const customHighlight = nodeMarkupSettings.customHighlight;
        return {
            backgroundColor: hexToRgba(customHighlight.backgroundColor, customHighlight.backgroundOpacity),
            borderColor: customHighlight.borderColor,
            borderWidth: customHighlight.borderEnabled ? `${customHighlight.borderWidth}px` : "0",
        };
    }

    return {
        backgroundColor: "rgba(255, 0, 0, 0.2)",
        borderColor: "#ff0000",
        borderWidth: "2px",
    };
}

function normalizeSettings(settings = {}) {
    const customHighlight = {
        ...nodeMarkupSettings.customHighlight,
        ...(settings.customHighlight ?? {}),
    };
    const markdownOptions = {
        ...nodeMarkupSettings.markdownOptions,
        ...(settings.markdownOptions ?? {}),
    };

    return {
        ...nodeMarkupSettings,
        ...settings,
        customHighlight,
        markdownOptions,
    };
}

function hexToRgba(hex, opacity) {
    const normalizedHex = String(hex || "#ff0000").replace("#", "");
    const fullHex = normalizedHex.length === 3
        ? normalizedHex.split("").map((char) => `${char}${char}`).join("")
        : normalizedHex.padEnd(6, "0").slice(0, 6);
    const red = parseInt(fullHex.slice(0, 2), 16);
    const green = parseInt(fullHex.slice(2, 4), 16);
    const blue = parseInt(fullHex.slice(4, 6), 16);
    const alpha = clamp(Number(opacity), 0, 1);

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function parseCsvOption(value) {
    return String(value || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function escapeAttribute(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function getLocalStorageValue(key) {
    return new Promise((resolve) => {
        chrome.storage.local.get(key, (data) => resolve(data[key]));
    });
}

function setLocalStorageValue(key, value) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
    });
}

function setSyncStorageValue(key, value) {
    return new Promise((resolve) => {
        chrome.storage.sync.set({ [key]: value }, resolve);
    });
}

function isNodeMarkupUi(element) {
    return Boolean(element.closest(".node-markup-markdown-snippet, .node-markup-markdown-toast, .node-markup-metadata-badge, .node-markup-selector-builder"));
}

function getEventElement(event) {
    if (event.target instanceof Element) {
        return event.target;
    }

    if (typeof event.composedPath === "function") {
        return event.composedPath().find((node) => node instanceof Element) ?? null;
    }

    return null;
}

function generateCryptoUUID() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
