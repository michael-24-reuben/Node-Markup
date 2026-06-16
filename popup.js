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

let currentSettings = DEFAULT_SETTINGS;

document.addEventListener("DOMContentLoaded", async () => {
    const popupCard = document.querySelector(".el-tracer-popup");
    const toggleButton = document.getElementById("toggle-pointer-code");
    const settingsToggle = document.getElementById("settings-toggle");
    const settingsPanel = document.getElementById("settings-panel");

    if (!toggleButton) return;

    await initializeSettingsControls();
    syncActiveTabState(toggleButton);

    toggleButton.addEventListener("click", async () => {
        const tabId = await getActiveTabId();
        if (typeof tabId !== "number") return;

        const enabled = !(await getStoredTrackingState(tabId));
        await setStoredTrackingState(tabId, enabled);
        await sendMessageToTab(tabId, {
            type: "NODE_MARKUP_SET_TRACKING_STATE",
            enabled,
        }).catch(() => null);

        updateTrackingEnabled(enabled, toggleButton);
    });

    settingsToggle?.addEventListener("click", () => {
        const expanded = settingsToggle.getAttribute("aria-expanded") === "true";
        settingsToggle.setAttribute("aria-expanded", String(!expanded));
        settingsPanel?.classList.toggle("is-open", !expanded);
        settingsPanel?.setAttribute("aria-hidden", String(expanded));
        popupCard?.classList.toggle("el-tracer-popup--settings-open", !expanded);
    });

    chrome.tabs.onActivated.addListener(() => syncActiveTabState(toggleButton));
});

async function initializeSettingsControls() {
    currentSettings = await getStoredSettings();
    renderSettings(currentSettings);

    document.querySelectorAll("input[name='selector-path-mode']").forEach((input) => {
        input.addEventListener("change", () => {
            if (input.checked) updateSettings({ selectorPathMode: input.value });
        });
    });

    document.querySelectorAll("input[name='xpath-path-mode']").forEach((input) => {
        input.addEventListener("change", () => {
            if (input.checked) updateSettings({ xpathPathMode: input.value });
        });
    });

    document.getElementById("metadata-enabled")?.addEventListener("change", (event) => {
        updateSettings({ metadataEnabled: event.target.checked });
    });

    document.querySelectorAll("[data-position]").forEach((button) => {
        button.addEventListener("click", () => {
            updateSettings({ metadataPosition: button.dataset.position });
        });
    });

    document.querySelectorAll("[data-template]").forEach((button) => {
        button.addEventListener("click", () => {
            updateSettings({ highlightTemplate: button.dataset.template });
        });
    });

    bindCustomHighlightInput("highlight-fill-color", "backgroundColor", "value");
    bindCustomHighlightInput("highlight-fill-opacity", "backgroundOpacity", "number");
    bindCustomHighlightInput("highlight-border-enabled", "borderEnabled", "checked");
    bindCustomHighlightInput("highlight-border-color", "borderColor", "value");
    bindCustomHighlightInput("highlight-border-width", "borderWidth", "number");

    bindMarkdownOptionInput("markdown-prefer-native-parser", "preferNativeParser", "checked");
    bindMarkdownOptionInput("markdown-code-fence", "codeFence", "value");
    bindMarkdownOptionInput("markdown-bullet-marker", "bulletMarker", "value");
    bindMarkdownOptionInput("markdown-code-block-style", "codeBlockStyle", "value");
    bindMarkdownOptionInput("markdown-em-delimiter", "emDelimiter", "value");
    bindMarkdownOptionInput("markdown-strong-delimiter", "strongDelimiter", "value");
    bindMarkdownOptionInput("markdown-strike-delimiter", "strikeDelimiter", "value");
    bindMarkdownOptionInput("markdown-max-newlines", "maxConsecutiveNewlines", "number");
    bindMarkdownOptionInput("markdown-keep-data-images", "keepDataImages", "checked");
    bindMarkdownOptionInput("markdown-reference-links", "useLinkReferenceDefinitions", "checked");
    bindMarkdownOptionInput("markdown-inline-links", "useInlineLinks", "checked");
    bindMarkdownOptionInput("markdown-ignore-elements", "ignore", "value");
    bindMarkdownOptionInput("markdown-block-elements", "blockElements", "value");
}

function bindCustomHighlightInput(elementId, settingKey, valueType) {
    document.getElementById(elementId)?.addEventListener("input", (event) => {
        const value = valueType === "checked"
            ? event.target.checked
            : valueType === "number"
                ? Number(event.target.value)
                : event.target.value;

        updateSettings({
            highlightTemplate: "custom",
            customHighlight: {
                ...currentSettings.customHighlight,
                [settingKey]: value,
            },
        });
    });
}

function bindMarkdownOptionInput(elementId, settingKey, valueType) {
    const input = document.getElementById(elementId);
    const eventName = input?.tagName === "SELECT" || valueType === "checked" ? "change" : "input";

    input?.addEventListener(eventName, (event) => {
        const value = valueType === "checked"
            ? event.target.checked
            : valueType === "number"
                ? Number(event.target.value)
                : event.target.value;

        updateSettings({
            markdownOptions: {
                ...currentSettings.markdownOptions,
                [settingKey]: value,
            },
        });
    });
}

async function updateSettings(partialSettings) {
    currentSettings = normalizeSettings({
        ...currentSettings,
        ...partialSettings,
        customHighlight: {
            ...currentSettings.customHighlight,
            ...(partialSettings.customHighlight ?? {}),
        },
    });

    await setStoredSettings(currentSettings);
    renderSettings(currentSettings);
    await notifyActiveTabSettings(currentSettings);
}

function renderSettings(settings) {
    const normalizedSettings = normalizeSettings(settings);

    setCheckedValue("selector-path-mode", normalizedSettings.selectorPathMode);
    setCheckedValue("xpath-path-mode", normalizedSettings.xpathPathMode);
    setInputChecked("metadata-enabled", normalizedSettings.metadataEnabled);
    setInputValue("highlight-fill-color", normalizedSettings.customHighlight.backgroundColor);
    setInputValue("highlight-fill-opacity", normalizedSettings.customHighlight.backgroundOpacity);
    setInputChecked("highlight-border-enabled", normalizedSettings.customHighlight.borderEnabled);
    setInputValue("highlight-border-color", normalizedSettings.customHighlight.borderColor);
    setInputValue("highlight-border-width", normalizedSettings.customHighlight.borderWidth);
    setInputChecked("markdown-prefer-native-parser", normalizedSettings.markdownOptions.preferNativeParser);
    setInputValue("markdown-code-fence", normalizedSettings.markdownOptions.codeFence);
    setInputValue("markdown-bullet-marker", normalizedSettings.markdownOptions.bulletMarker);
    setInputValue("markdown-code-block-style", normalizedSettings.markdownOptions.codeBlockStyle);
    setInputValue("markdown-em-delimiter", normalizedSettings.markdownOptions.emDelimiter);
    setInputValue("markdown-strong-delimiter", normalizedSettings.markdownOptions.strongDelimiter);
    setInputValue("markdown-strike-delimiter", normalizedSettings.markdownOptions.strikeDelimiter);
    setInputValue("markdown-max-newlines", normalizedSettings.markdownOptions.maxConsecutiveNewlines);
    setInputChecked("markdown-keep-data-images", normalizedSettings.markdownOptions.keepDataImages);
    setInputChecked("markdown-reference-links", normalizedSettings.markdownOptions.useLinkReferenceDefinitions);
    setInputChecked("markdown-inline-links", normalizedSettings.markdownOptions.useInlineLinks);
    setInputValue("markdown-ignore-elements", normalizedSettings.markdownOptions.ignore);
    setInputValue("markdown-block-elements", normalizedSettings.markdownOptions.blockElements);

    document.querySelectorAll("[data-position]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.position === normalizedSettings.metadataPosition);
    });

    document.querySelectorAll("[data-template]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.template === normalizedSettings.highlightTemplate);
    });

    const customPreview = document.getElementById("custom-template-preview");
    if (customPreview) {
        customPreview.style.setProperty("--custom-bg", hexToRgba(
            normalizedSettings.customHighlight.backgroundColor,
            normalizedSettings.customHighlight.backgroundOpacity,
        ));
        customPreview.style.setProperty("--custom-border", normalizedSettings.customHighlight.borderEnabled
            ? normalizedSettings.customHighlight.borderColor
            : "transparent");
    }
}

function setCheckedValue(name, value) {
    const input = document.querySelector(`input[name='${name}'][value='${value}']`);
    if (input) input.checked = true;
}

function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value;
}

function setInputChecked(id, checked) {
    const input = document.getElementById(id);
    if (input) input.checked = Boolean(checked);
}

async function notifyActiveTabSettings(settings) {
    const tabId = await getActiveTabId();
    if (typeof tabId !== "number") return;

    await sendMessageToTab(tabId, {
        type: "NODE_MARKUP_SET_SETTINGS",
        settings,
    }).catch(() => null);
}

async function syncActiveTabState(toggleButton) {
    const tabId = await getActiveTabId();
    if (typeof tabId !== "number") return;

    updateTrackingEnabled(await getStoredTrackingState(tabId), toggleButton);
}

function updateTrackingEnabled(enabled, toggleButton) {
    if (enabled) {
        toggleButton.classList.remove("el-tracer__button--toggle-off");
        toggleButton.classList.add("el-tracer__button--toggle-on");
        toggleButton.textContent = "Disable Tracking";
        return;
    }

    toggleButton.classList.add("el-tracer__button--toggle-off");
    toggleButton.classList.remove("el-tracer__button--toggle-on");
    toggleButton.textContent = "Enable Tracking";
}

function getStoredSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(SETTINGS_STORAGE_KEY, (data) => {
            resolve(normalizeSettings(data[SETTINGS_STORAGE_KEY]));
        });
    });
}

function setStoredSettings(settings) {
    return new Promise((resolve) => {
        chrome.storage.sync.set({ [SETTINGS_STORAGE_KEY]: settings }, resolve);
    });
}

function getTrackingKey(tabId) {
    return `trackingEnabled_${tabId}`;
}

function getActiveTabId() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs[0]?.id);
        });
    });
}

function getStoredTrackingState(tabId) {
    return new Promise((resolve) => {
        chrome.storage.session.get(getTrackingKey(tabId), (data) => {
            resolve(Boolean(data[getTrackingKey(tabId)]));
        });
    });
}

function setStoredTrackingState(tabId, enabled) {
    return new Promise((resolve) => {
        chrome.storage.session.set({ [getTrackingKey(tabId)]: enabled }, resolve);
    });
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

function hexToRgba(hex, opacity) {
    const normalizedHex = String(hex || "#ff0000").replace("#", "");
    const fullHex = normalizedHex.length === 3
        ? normalizedHex.split("").map((char) => `${char}${char}`).join("")
        : normalizedHex.padEnd(6, "0").slice(0, 6);
    const red = parseInt(fullHex.slice(0, 2), 16);
    const green = parseInt(fullHex.slice(2, 4), 16);
    const blue = parseInt(fullHex.slice(4, 6), 16);
    const alpha = Math.min(Math.max(Number(opacity), 0), 1);

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
