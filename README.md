# ✍ Browsign

> Fill, annotate, and sign PDF documents directly in your browser tab — no uploads, no accounts, no servers.

![Version](https://img.shields.io/badge/version-1.0.1-d4820a?style=flat-square)
![Manifest](https://img.shields.io/badge/manifest-v3-1a5a2a?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-5a7a5a?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Chrome%20%2F%20Chromium-4285F4?style=flat-square)

---

## Overview

**Browsign** (browse + sign) is a privacy-first Chrome extension that turns any PDF into a fillable, signable document — right inside a browser tab. Open a PDF from your disk or a URL, add text, draw or type your signature, highlight sections, and download the finished result as a flat PDF. No file ever leaves your machine.

---

## Features

### Opening PDFs
- **Upload from disk** — click the upload zone or drag and drop a `.pdf` file onto the popup
- **Load from URL** — paste any public PDF URL and open it directly in the editor
- **Auto-detect PDF tabs** — when you navigate to a `.pdf` URL in Chrome, Browsign detects it and offers a one-click "Open Editor" button in the popup
- **Recent files** — the last 5 opened files are stored locally and shown in the popup for quick re-access

### Annotation Tools

| Tool | Activate | What it does |
|------|----------|--------------|
| **Select** | Click `Select` or press `Esc` | Move, resize, or delete existing annotations |
| **Text** | Click `Text` or press `T` | Click anywhere on the page to place a text box; drag the top bar to reposition; drag the bottom-right corner to resize |
| **Sign** | Click `Sign` or press `S` | Places your drawn or typed signature on the page at the click position |
| **Highlight** | Click `Highlight` or press `H` | Click and drag to draw a yellow highlight region over any area |

### Signature Pad (sidebar)
- **Draw** — handwrite a signature with your mouse or touchpad directly on the canvas
- **Type** — enter your name in a prompt; it renders in a cursive-style font
- **Clear** — wipe the pad and start over
- **Place →** — activates Sign mode so the next click on the document drops the signature

### Text Styling (sidebar)
- Adjustable **font size** (6–72px)
- Six **colour swatches**: black, red, green, navy, grey, amber

### Editor Controls
- **Undo** (`Ctrl+Z`) / **Redo** (`Ctrl+Y`) — full history stack for all annotation actions
- **Zoom In / Out / Reset** — re-renders all pages at the new scale
- **Page thumbnails** — sidebar panel showing all pages; click any thumbnail to jump to it
- **Save session** (`Ctrl+S`) — persists annotations to Chrome's local storage keyed by filename; restored automatically on next open
- **Download PDF** — flattens all annotations onto the original pages and exports a new `.pdf` named `<original>-signed.pdf`

---

## Installation

### Prerequisites
- Google Chrome or any Chromium-based browser (Manifest V3 support required)
- Node.js — needed once to run the PDF.js setup script

### Step 1 — Clone the repository

```bash
git clone https://github.com/your-username/browsign.git
cd browsign
```

### Step 2 — Download PDF.js

Chrome extensions cannot load scripts from external CDNs. Run the setup script once to download PDF.js locally:

```bash
node setup.js
```

This places `pdf.min.js` and `pdf.worker.min.js` in the extension folder.

**No Node.js?** Download the files manually and place them in the root folder:

| File | URL |
|------|-----|
| `pdf.min.js` | https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js |
| `pdf.worker.min.js` | https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js |

### Step 3 — Load in Chrome

1. Go to `chrome://extensions/`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked** and select the `browsign` folder
4. Pin the Browsign icon from the puzzle-piece menu

---

## Usage Walkthrough

### Opening a PDF

Click the Browsign icon in your toolbar. Three ways to open a PDF:

- **Drag & drop** a file onto the upload zone, or click to browse
- **Paste a URL** and click **Load**
- If you're already on a PDF tab, click **Open Editor** from the green banner

The editor opens in a new tab and renders all pages.

### Adding Text

1. Press `T` or click **Text** in the toolbar
2. Click anywhere on the page — a text box appears
3. Type directly into it
4. **Move** it by dragging the amber bar at the top
5. **Resize** it by dragging the small square at the bottom-right
6. **Delete** it by clicking the `×` on hover

Adjust font size and colour in the **Tools** sidebar.

### Signing

1. Draw your signature on the sidebar canvas — or click **Type** to use your name
2. Click **Place →**
3. Click anywhere on the document to drop the signature
4. Drag and resize as needed

### Highlighting

1. Press `H` or click **Highlight**
2. Click and drag across any region
3. Release to set the highlight

### Downloading

Click **⬇ Download PDF**. Browsign composites all annotations onto the original pages at full resolution and saves `<filename>-signed.pdf` to your downloads folder.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `T` | Text tool |
| `S` | Sign tool |
| `H` | Highlight tool |
| `Esc` | Select tool |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+S` | Save session |
| `Delete` / `Backspace` | Delete selected annotation |

---

## Project Structure

```
browsign/
│
├── manifest.json          # Extension manifest (Manifest V3)
│
├── popup.html             # Toolbar popup UI
├── popup.js               # Popup logic: upload, URL load, recent files,
│                          #   PDF tab detection
│
├── editor.html            # Full-page PDF editor UI
├── editor.js              # Core logic: PDF rendering, annotation engine,
│                          #   signature pad, drag/resize, undo/redo,
│                          #   session persistence, PDF export
│
├── background.js          # Service worker: PDF tab detection
├── content.js             # Content script: reports PDF URLs to background
│
├── setup.js               # One-time Node.js script to fetch PDF.js
│
├── pdf.min.js             # ← not committed; run setup.js
├── pdf.worker.min.js      # ← not committed; run setup.js
│
├── generate_icons.py      # Generates PNG icons (Python 3, no dependencies)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Architecture

### Annotation Data Model

Every annotation is a plain object in a single `annotations` array:

```js
{
  id: "a3f7b2c1",        // random uid
  type: "text",           // "text" | "sig" | "highlight"
  pageIdx: 0,             // zero-based page number
  x: 142,                 // left edge in canvas pixels
  y: 310,                 // top edge in canvas pixels
  w: 160,                 // width
  h: 40,                  // height

  // text only:
  text: "John Doe",
  color: "#1a1209",
  fontSize: 14,

  // signature only:
  dataUrl: "data:image/png;base64,..."
}
```

Annotations render as absolutely-positioned DOM elements in a transparent `.page-overlay` div layered over each page `<canvas>`. This keeps them fully interactive (drag, resize, focus) while the PDF renders untouched below.

### Undo / Redo

Every mutation calls `pushHistory()` first, which serialises `annotations` to JSON and pushes it onto a stack. Undo pops from the stack and re-renders. History is in-memory only and does not persist across sessions.

### PDF Export Pipeline

No third-party PDF library is used for export. The pipeline is entirely browser-native:

1. **Flatten to canvas** — a new `<canvas>` is created per page at the exact rendered pixel dimensions
2. **Composite layers** — original page → highlights → text → signatures, painted in order
3. **Coordinate accuracy** — text is drawn at `ann.y + DRAG_BAR_H + TEXT_PAD` to exactly match the on-screen visual position
4. **Encode as JPEG** — each flat canvas becomes a JPEG via `toDataURL('image/jpeg', 0.92)`
5. **Build PDF** — a spec-compliant PDF is assembled from raw bytes. Each page embeds its JPEG as a DCT-compressed Image XObject. Page dimensions use `1 canvas pixel = 1 PDF point` for exact 1:1 coordinate mapping

### Session Persistence

Annotations are saved to `chrome.storage.local` under `session_<filename>`. They are restored automatically when the same filename is opened again and survive browser restarts.

---

## Permissions

| Permission | Reason |
|------------|--------|
| `activeTab` | Detect whether the current tab is a PDF |
| `storage` | Persist recent files and annotation sessions locally |
| `downloads` | Trigger the browser download of the exported PDF |
| `host_permissions: <all_urls>` | Fetch PDF content from arbitrary URLs |

No data is ever sent to any external server. All PDF parsing, rendering, annotation, and export run entirely in the browser.

---

## Known Limitations

- **Password-protected PDFs** are not supported
- **Very large PDFs** (100+ pages) may render slowly — all pages load upfront
- **Zoom** re-renders all pages and resets scroll position
- **Uploaded file sessions** — annotation data is saved but the original PDF bytes are not. Re-upload the file to restore a session after closing the tab
- **Exported PDF** embeds pages as JPEG images — the original text layer (selectable/searchable text) is not preserved
- **CORS** — some PDF URLs may be blocked by the host server's CORS policy. Download the file and upload it directly as a workaround

---

## Development

No build step required. Vanilla HTML, CSS, and JavaScript.

```bash
# After editing a file:
# 1. Go to chrome://extensions/
# 2. Click the refresh ↻ icon on the Browsign card
# 3. Reopen the editor tab

# Regenerate icons (Python 3):
python3 generate_icons.py

# Re-download PDF.js:
node setup.js
```

### Suggested `.gitignore`

```gitignore
# PDF.js — downloaded locally, not committed
pdf.min.js
pdf.worker.min.js

.DS_Store
.vscode/
```

---

## Contributing

PRs are welcome. Please open an issue first for significant changes.

- One feature or fix per PR
- Test against multi-page PDFs with dense content
- Verify annotation positions are accurate in the downloaded output
- Do not commit `pdf.min.js` or `pdf.worker.min.js`

---

## License

MIT — see [LICENSE](LICENSE) for full terms.

---

## Acknowledgements

- [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla — open-source PDF rendering engine
- [Google Fonts](https://fonts.google.com/) — Fraunces and DM Mono typefaces
