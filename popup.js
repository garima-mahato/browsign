// popup.js — Browsign

const RECENT_KEY = 'browsign_recent';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Sanitise a string for safe insertion as text content (no HTML injection)
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Sanitise a value for use as a chrome.storage key
function sanitiseKey(str) {
  return String(str).replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 128);
}

// ── Recent files ──────────────────────────────────────────────────────────────
// Recent entries store { name, ref, type, date }
// type = 'url'   → ref is the actual HTTP(S) URL
// type = 'local' → ref is a session storage key; bytes live in chrome.storage.session

async function getRecent() {
  return new Promise(resolve => {
    chrome.storage.local.get(RECENT_KEY, data => {
      resolve(data[RECENT_KEY] || []);
    });
  });
}

async function addRecent(entry) {
  let recent = await getRecent();
  recent = recent.filter(r => r.name !== entry.name);
  // Never store file bytes in recent — only metadata
  recent.unshift({ name: entry.name, ref: entry.ref, type: entry.type, date: Date.now() });
  recent = recent.slice(0, 5);
  chrome.storage.local.set({ [RECENT_KEY]: recent });
}

async function clearRecent() {
  chrome.storage.local.remove(RECENT_KEY);
  renderRecent([]);
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function renderRecent(recent) {
  const list = document.getElementById('recentList');
  if (!recent.length) {
    list.innerHTML = '<div class="empty-state">No recent files</div>';
    return;
  }

  list.innerHTML = '';
  recent.forEach(r => {
    const item = document.createElement('div');
    item.className = 'recent-item';

    const icon = document.createElement('span');
    icon.className = 'recent-icon';
    icon.textContent = '📄';

    const info = document.createElement('div');
    info.className = 'recent-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'recent-name';
    nameEl.textContent = r.name; // textContent — no XSS risk

    const dateEl = document.createElement('div');
    dateEl.className = 'recent-date';
    dateEl.textContent = (r.type === 'local' ? '📁 local · ' : '') + timeAgo(r.date);

    const arrow = document.createElement('span');
    arrow.className = 'recent-arrow';
    arrow.textContent = '→';

    info.appendChild(nameEl);
    info.appendChild(dateEl);
    item.appendChild(icon);
    item.appendChild(info);
    item.appendChild(arrow);

    item.addEventListener('click', () => openFromRecent(r));
    list.appendChild(item);
  });
}

async function openFromRecent(entry) {
  if (entry.type === 'url') {
    openEditor(entry.ref, entry.name);
  } else {
    // local file — retrieve bytes from session storage
    chrome.storage.session.get(entry.ref, data => {
      const dataUrl = data[entry.ref];
      if (dataUrl) {
        openEditor(dataUrl, entry.name);
      } else {
        // Session expired (browser was restarted) — ask user to re-upload
        alert(`"${entry.name}" was uploaded locally and needs to be re-opened from disk.\n\nLocal file data is cleared when the browser restarts.`);
      }
    });
  }
}

// ── Open editor ───────────────────────────────────────────────────────────────
function openEditor(urlOrDataUrl, name) {
  // Pass only a short session key in the URL for local files;
  // pass the actual URL for remote files — never embed full data: URIs in URLs
  const editorBase = chrome.runtime.getURL('editor.html');
  const safeName = encodeURIComponent(name);

  if (urlOrDataUrl.startsWith('data:')) {
    // Store bytes in session storage (cleared on browser close), pass only key
    const sessionKey = 'pdf_' + Math.random().toString(36).slice(2, 10);
    chrome.storage.session.set({ [sessionKey]: urlOrDataUrl }, () => {
      chrome.tabs.create({ url: `${editorBase}?sessionKey=${encodeURIComponent(sessionKey)}&name=${safeName}` });
    });
  } else {
    chrome.tabs.create({ url: `${editorBase}?url=${encodeURIComponent(urlOrDataUrl)}&name=${safeName}` });
  }
  window.close();
}

// ── File upload ───────────────────────────────────────────────────────────────
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const dataUrl = ev.target.result;
    // Store bytes in session storage only — not in recent list
    const sessionKey = 'pdf_' + Math.random().toString(36).slice(2, 10);
    chrome.storage.session.set({ [sessionKey]: dataUrl }, async () => {
      await addRecent({ name: file.name, ref: sessionKey, type: 'local' });
      openEditor(dataUrl, file.name);
    });
  };
  reader.readAsDataURL(file);
});

// ── Drag and drop ─────────────────────────────────────────────────────────────
const zone = document.getElementById('uploadZone');
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
zone.addEventListener('drop', async (e) => {
  e.preventDefault();
  zone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file || file.type !== 'application/pdf') return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const dataUrl = ev.target.result;
    const sessionKey = 'pdf_' + Math.random().toString(36).slice(2, 10);
    chrome.storage.session.set({ [sessionKey]: dataUrl }, async () => {
      await addRecent({ name: file.name, ref: sessionKey, type: 'local' });
      openEditor(dataUrl, file.name);
    });
  };
  reader.readAsDataURL(file);
});

// ── Load from URL ─────────────────────────────────────────────────────────────
document.getElementById('loadUrl').addEventListener('click', async () => {
  const url = document.getElementById('urlInput').value.trim();
  if (!url || !url.startsWith('https://')) {
    alert('Please enter a valid HTTPS URL.');
    return;
  }
  const name = url.split('/').pop().split('?')[0] || 'document.pdf';
  await addRecent({ name, ref: url, type: 'url' });
  openEditor(url, name);
});

document.getElementById('urlInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('loadUrl').click();
});

// ── Clear recent ──────────────────────────────────────────────────────────────
document.getElementById('clearRecent').addEventListener('click', () => clearRecent());

// ── PDF tab detection ─────────────────────────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const tab = tabs[0];
  if (tab && tab.url && tab.url.match(/\.pdf(\?.*)?$/i)) {
    const name = tab.url.split('/').pop().split('?')[0] || 'document.pdf';
    document.getElementById('tabPdfSection').classList.remove('hidden');
    // textContent — safe, no XSS
    document.getElementById('tabPdfName').textContent = name;
    document.getElementById('openTabPdf').addEventListener('click', async () => {
      await addRecent({ name, ref: tab.url, type: 'url' });
      openEditor(tab.url, name);
    });
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
getRecent().then(renderRecent);
