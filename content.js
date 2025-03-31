const uniqueClass = "context-selected-" + generateCryptoUUID();

document.addEventListener("contextmenu", (event) => {
    // Remove old selections
    document.querySelectorAll(`.${uniqueClass}`)
        .forEach(el => {el.classList.remove(uniqueClass);});

    // Assign unique class to the right-clicked element
    event.target.classList.add(uniqueClass);

    // Store the class in session storage so background.js can access it
    chrome.storage.local.set({rightClickedElement: uniqueClass});
});

function generateCryptoUUID() {
    return crypto.randomUUID();
}
