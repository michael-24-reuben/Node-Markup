document.addEventListener("DOMContentLoaded", () => {
    const toggleButton = document.getElementById("toggle-pointer-code");

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        let tabId = tabs[0]?.id;
        if (!tabId) return;

        chrome.storage.session.get(`trackingEnabled_${tabId}`, (data) => {
            let enabled = data[`trackingEnabled_${tabId}`] ?? false;
            updateTrackingEnabled(enabled, tabId);
        });
    });

    toggleButton.addEventListener("click", () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            let tabId = tabs[0]?.id;
            if (!tabId) return;

            chrome.storage.session.get(`trackingEnabled_${tabId}`, (data) => {
                let enabled = !data[`trackingEnabled_${tabId}`];
                updateTrackingEnabled(enabled, tabId);

                chrome.scripting.executeScript({
                    target: { tabId },
                    function: toggleTracking,
                    args: [enabled],
                });
            });
        });
    });

    function updateTrackingEnabled(enabled, tabId) {
        chrome.storage.session.set({ [`trackingEnabled_${tabId}`]: enabled });
        if (enabled) {
            toggleButton.classList.remove("el-tracer__button--toggle-off");
            toggleButton.classList.add("el-tracer__button--toggle-on");
            toggleButton.textContent = "Disable Tracking";
        } else {
            toggleButton.classList.add("el-tracer__button--toggle-off");
            toggleButton.classList.remove("el-tracer__button--toggle-on");
            toggleButton.textContent = "Enable Tracking";
        }
    }
});

// Listen for tab focus changes and update UI
chrome.tabs.onActivated.addListener((activeInfo) => {
    let tabId = activeInfo.tabId;
    chrome.storage.session.get(`trackingEnabled_${tabId}`, (data) => {
        let enabled = data[`trackingEnabled_${tabId}`] ?? false;
        document.getElementById("toggle-pointer-code").textContent = enabled ? "Disable Tracking" : "Enable Tracking";
    });
});

function toggleTracking(enabled) {
    if (!window.highlightElement) {
        window.highlightElement = function(event) {
            document.querySelectorAll(".hover-highlight").forEach(el => el.classList.remove("hover-highlight"));
            event.target.classList.add("hover-highlight");
        };
    }

    if (enabled) {
        document.addEventListener("mouseover", window.highlightElement);
    } else {
        document.removeEventListener("mouseover", window.highlightElement);
        document.querySelectorAll(".hover-highlight").forEach(el => el.classList.remove("hover-highlight"));
    }
}
