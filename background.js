// background.js — Browsign service worker

const DEBUG = false; // set true only during development

chrome.runtime.onInstalled.addListener(() => {
  if (DEBUG) console.log('Browsign installed.');
});

// Track PDF tabs so the popup can offer "Open Editor"
// No URLs are logged to the console in production
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.match(/\.pdf(\?.*)?$/i)) {
    // Tab is a PDF — popup detects this via chrome.tabs.query; nothing to do here
    if (DEBUG) console.log('Browsign: PDF tab detected');
  }
});
