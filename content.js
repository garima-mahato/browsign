// content.js — injected into all pages
// Detects if the current page is a PDF and communicates with popup

(function () {
  const isPDF =
    document.contentType === 'application/pdf' ||
    window.location.href.match(/\.pdf(\?.*)?$/i);

  if (isPDF) {
    chrome.runtime.sendMessage({ type: 'PDF_DETECTED', url: window.location.href });
  }
})();
