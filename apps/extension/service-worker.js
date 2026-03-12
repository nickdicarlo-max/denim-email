// Case Engine - Chrome Extension Service Worker
// Manifest V3

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));
