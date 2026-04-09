// Chromium compat shim — maps browser.* to chrome.* for the shared service worker.
const browser = chrome;
importScripts('common/background.js');
