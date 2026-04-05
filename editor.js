// editor.js — Browsign core logic

// ── PDF.js setup ──────────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');

// ── State ─────────────────────────────────────────────────────────────────────
let pdfDoc = null;
let pages = []; // { canvas, overlay, wrapper }
let scale = 1.4;
let currentTool = 'select';
let annotations = []; // { id, type, pageIdx, x, y, w, h, ...data }
let annHistory = [];
let redoStack = [];
let selectedColor = '#1a1209';
let fontSize = 14;
let sigDataUrl = null; // current drawn signature
let isDrawingSig = false;
let isDragging = false;
let dragTarget = null;
let dragStart = { x: 0, y: 0 };
let isResizing = false;
let resizeTarget = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function toast(msg, dur = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), dur);
}

function setLoading(pct, msg) {
  document.getElementById('loadFill').style.width = pct + '%';
  document.getElementById('loadText').textContent = msg;
}

function pushHistory() {
  annHistory.push(JSON.stringify(annotations));
  redoStack = [];
}

function undo() {
  if (!annHistory.length) return;
  redoStack.push(JSON.stringify(annotations));
  annotations = JSON.parse(annHistory.pop());
  rerenderAnnotations();
  toast('Undo');
}

function redo() {
  if (!redoStack.length) return;
  annHistory.push(JSON.stringify(annotations));
  annotations = JSON.parse(redoStack.pop());
  rerenderAnnotations();
  toast('Redo');
}

// ── Load PDF ──────────────────────────────────────────────────────────────────
async function loadPDF(url) {
  setLoading(10, 'Fetching PDF…');
  let pdfData;
  if (url.startsWith('data:')) {
    pdfData = url;
  } else {
    try {
      const resp = await fetch(url);
      const buf = await resp.arrayBuffer();
      pdfData = new Uint8Array(buf);
    } catch (e) {
      setLoading(100, 'Failed to load. Try uploading the file directly.');
      return;
    }
  }

  setLoading(40, 'Parsing PDF…');
  pdfDoc = await pdfjsLib.getDocument(pdfData).promise;

  setLoading(60, `Rendering ${pdfDoc.numPages} page(s)…`);
  const canvasArea = document.getElementById('canvasArea');
  canvasArea.innerHTML = '';
  pages = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    setLoading(60 + Math.round((i / pdfDoc.numPages) * 35), `Rendering page ${i}…`);
    await renderPage(i, canvasArea);
  }

  setLoading(98, 'Building thumbnails…');
  buildThumbnails();
  setLoading(100, 'Done');

  setTimeout(() => {
    document.getElementById('loadingOverlay').style.display = 'none';
  }, 400);
}

async function renderPage(pageNum, container) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const label = document.createElement('div');
  label.className = 'page-label';
  label.textContent = `Page ${pageNum}`;
  container.appendChild(label);

  const wrapper = document.createElement('div');
  wrapper.className = 'page-wrapper';
  wrapper.style.width = viewport.width + 'px';
  wrapper.style.height = viewport.height + 'px';
  wrapper.dataset.page = pageNum - 1;

  const canvas = document.createElement('canvas');
  canvas.className = 'page-canvas';
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  const overlay = document.createElement('div');
  overlay.className = 'page-overlay';

  wrapper.appendChild(canvas);
  wrapper.appendChild(overlay);
  container.appendChild(wrapper);

  pages.push({ canvas, overlay, wrapper, viewport });
  setupPageEvents(wrapper, pageNum - 1);
}

// ── Thumbnails ────────────────────────────────────────────────────────────────
async function buildThumbnails() {
  const list = document.getElementById('thumbList');
  list.innerHTML = '';
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const vp = page.getViewport({ scale: 0.2 });
    const c = document.createElement('canvas');
    c.className = 'thumb-canvas';
    c.width = vp.width;
    c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;

    const item = document.createElement('div');
    item.className = 'thumb-item' + (i === 1 ? ' active' : '');
    item.dataset.page = i - 1;
    const lbl = document.createElement('div');
    lbl.className = 'thumb-label';
    lbl.textContent = `${i}`;
    item.appendChild(c);
    item.appendChild(lbl);
    item.addEventListener('click', () => {
      document.querySelectorAll('.thumb-item').forEach(t => t.classList.remove('active'));
      item.classList.add('active');
      pages[i - 1].wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    list.appendChild(item);
  }
}

// ── Tool selection ────────────────────────────────────────────────────────────
function setTool(tool) {
  currentTool = tool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  pages.forEach(({ wrapper }) => {
    wrapper.className = 'page-wrapper tool-' + tool;
  });
}

// ── Page interaction ──────────────────────────────────────────────────────────
function setupPageEvents(wrapper, pageIdx) {
  wrapper.addEventListener('mousedown', (e) => {
    if (e.target.closest('.annotation')) return; // handled by annotation
    if (currentTool === 'text') addTextAnnotation(e, pageIdx);
    else if (currentTool === 'sign') placeSignature(e, pageIdx);
    else if (currentTool === 'highlight') startHighlight(e, pageIdx);
  });
}

function getRelativePos(e, wrapper) {
  const rect = wrapper.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

// ── Text Annotation ───────────────────────────────────────────────────────────
function addTextAnnotation(e, pageIdx) {
  const { wrapper, overlay } = pages[pageIdx];
  const pos = getRelativePos(e, wrapper);
  pushHistory();

  const ann = {
    id: uid(),
    type: 'text',
    pageIdx,
    x: pos.x,
    y: pos.y,
    w: 160,
    h: fontSize + 10,
    text: '',
    color: selectedColor,
    fontSize
  };
  annotations.push(ann);
  renderTextAnnotation(ann, overlay);
  // Focus it immediately
  const el = overlay.querySelector(`[data-id="${ann.id}"]`);
  if (el) { el.focus(); selectAnnotation(el); }
}

function renderTextAnnotation(ann, overlay) {
  const el = document.createElement('div');
  el.className = 'annotation text-ann';
  el.dataset.id = ann.id;
  el.style.cssText = `left:${ann.x}px;top:${ann.y}px;width:${ann.w}px;min-height:${ann.h}px;`;

  // Drag bar at top - only draggable area
  const dragBar = document.createElement('div');
  dragBar.className = 'drag-bar';

  // Delete button
  const del = document.createElement('span');
  del.className = 'delete-handle';
  del.textContent = '×';
  del.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); deleteAnnotation(ann.id); });

  // Editable content area
  const textEl = document.createElement('div');
  textEl.className = 'text-inner';
  textEl.contentEditable = 'true';
  textEl.spellcheck = false;
  textEl.innerText = ann.text || '';
  textEl.style.cssText = `color:${ann.color};font-size:${ann.fontSize}px;`;
  textEl.addEventListener('input', () => { ann.text = textEl.innerText; });
  textEl.addEventListener('mousedown', (e) => e.stopPropagation());

  // Resize handle
  const resize = document.createElement('span');
  resize.className = 'resize-handle';
  setupResize(resize, el, ann);

  el.appendChild(dragBar);
  el.appendChild(del);
  el.appendChild(textEl);
  el.appendChild(resize);
  overlay.appendChild(el);

  setupAnnotationDrag(dragBar, el, ann);
  el.addEventListener('mousedown', () => selectAnnotation(el));
}

// ── Signature Annotation ──────────────────────────────────────────────────────
function placeSignature(e, pageIdx) {
  if (!sigDataUrl) { toast('Draw a signature first in the sidebar'); return; }
  const { wrapper, overlay } = pages[pageIdx];
  const pos = getRelativePos(e, wrapper);
  pushHistory();

  const ann = {
    id: uid(),
    type: 'sig',
    pageIdx,
    x: pos.x - 80,
    y: pos.y - 25,
    w: 160,
    h: 50,
    dataUrl: sigDataUrl
  };
  annotations.push(ann);
  renderSigAnnotation(ann, overlay);
  setTool('select');
  toast('Signature placed');
}

function renderSigAnnotation(ann, overlay) {
  const el = document.createElement('div');
  el.className = 'annotation sig-ann';
  el.dataset.id = ann.id;
  el.style.cssText = `left:${ann.x}px;top:${ann.y}px;width:${ann.w}px;height:${ann.h}px;`;

  const img = document.createElement('img');
  img.src = ann.dataUrl;
  el.appendChild(img);

  const del = document.createElement('span');
  del.className = 'delete-handle';
  del.textContent = '×';
  del.addEventListener('mousedown', (e) => { e.stopPropagation(); deleteAnnotation(ann.id); });

  const resize = document.createElement('span');
  resize.className = 'resize-handle';
  setupResize(resize, el, ann);

  el.appendChild(del);
  el.appendChild(resize);
  overlay.appendChild(el);
  setupAnnotationDrag(el, el, ann);
  el.addEventListener('mousedown', (e) => { e.stopPropagation(); selectAnnotation(el); });
}

// ── Highlight Annotation ──────────────────────────────────────────────────────
let highlightStart = null;
let highlightEl = null;
let highlightPageIdx = null;

function startHighlight(e, pageIdx) {
  const { wrapper, overlay } = pages[pageIdx];
  const pos = getRelativePos(e, wrapper);
  highlightStart = pos;
  highlightPageIdx = pageIdx;

  highlightEl = document.createElement('div');
  highlightEl.className = 'annotation highlight-ann';
  highlightEl.style.cssText = `left:${pos.x}px;top:${pos.y}px;width:0;height:${fontSize * 1.4}px;`;
  overlay.appendChild(highlightEl);

  function onMove(ev) {
    const p = getRelativePos(ev, wrapper);
    const x = Math.min(p.x, highlightStart.x);
    const y = Math.min(p.y, highlightStart.y);
    const w = Math.abs(p.x - highlightStart.x);
    const h = Math.abs(p.y - highlightStart.y) || (fontSize * 1.4);
    highlightEl.style.left = x + 'px';
    highlightEl.style.top = y + 'px';
    highlightEl.style.width = w + 'px';
    highlightEl.style.height = h + 'px';
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!highlightEl) return;
    const rect = highlightEl.getBoundingClientRect();
    if (rect.width < 5) { highlightEl.remove(); highlightEl = null; return; }

    pushHistory();
    const p = getRelativePos(ev, wrapper);
    const ann = {
      id: uid(),
      type: 'highlight',
      pageIdx,
      x: Math.min(p.x, highlightStart.x),
      y: Math.min(p.y, highlightStart.y),
      w: Math.abs(p.x - highlightStart.x),
      h: Math.abs(p.y - highlightStart.y) || (fontSize * 1.4)
    };
    annotations.push(ann);
    highlightEl.dataset.id = ann.id;
    const del = document.createElement('span');
    del.className = 'delete-handle';
    del.textContent = '×';
    del.addEventListener('mousedown', (ev2) => { ev2.stopPropagation(); deleteAnnotation(ann.id); });
    highlightEl.appendChild(del);
    setupAnnotationDrag(highlightEl, highlightEl, ann);
    highlightEl.addEventListener('mousedown', (ev2) => { ev2.stopPropagation(); selectAnnotation(highlightEl); });
    highlightEl = null;
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ── Annotation drag ───────────────────────────────────────────────────────────
// trigger: the element that receives mousedown (drag handle or whole el)
// el: the element to actually move (the .annotation wrapper)
// ann: the annotation data object
function setupAnnotationDrag(trigger, el, ann) {
  trigger.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('delete-handle') ||
        e.target.classList.contains('resize-handle')) return;
    e.preventDefault();
    e.stopPropagation();
    selectAnnotation(el);
    const startX = e.clientX - ann.x;
    const startY = e.clientY - ann.y;

    function onMove(ev) {
      ann.x = ev.clientX - startX;
      ann.y = ev.clientY - startY;
      el.style.left = ann.x + 'px';
      el.style.top = ann.y + 'px';
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function setupResize(handle, el, ann) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = ann.w, startH = ann.h;

    function onMove(ev) {
      ann.w = Math.max(40, startW + (ev.clientX - startX));
      ann.h = Math.max(20, startH + (ev.clientY - startY));
      el.style.width = ann.w + 'px';
      el.style.height = ann.h + 'px';
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function selectAnnotation(el) {
  document.querySelectorAll('.annotation.selected').forEach(a => a.classList.remove('selected'));
  el.classList.add('selected');
}

function deleteAnnotation(id) {
  pushHistory();
  annotations = annotations.filter(a => a.id !== id);
  document.querySelectorAll(`[data-id="${id}"]`).forEach(el => el.remove());
}

function rerenderAnnotations() {
  pages.forEach(({ overlay }) => { overlay.innerHTML = ''; });
  annotations.forEach(ann => {
    const overlay = pages[ann.pageIdx]?.overlay;
    if (!overlay) return;
    if (ann.type === 'text') renderTextAnnotation(ann, overlay);
    else if (ann.type === 'sig') renderSigAnnotation(ann, overlay);
    else if (ann.type === 'highlight') {
      const el = document.createElement('div');
      el.className = 'annotation highlight-ann';
      el.dataset.id = ann.id;
      el.style.cssText = `left:${ann.x}px;top:${ann.y}px;width:${ann.w}px;height:${ann.h}px;`;
      const del = document.createElement('span');
      del.className = 'delete-handle';
      del.textContent = '×';
      del.addEventListener('mousedown', (e) => { e.stopPropagation(); deleteAnnotation(ann.id); });
      el.appendChild(del);
      setupAnnotationDrag(el, el, ann);
      el.addEventListener('mousedown', (e) => { e.stopPropagation(); selectAnnotation(el); });
      overlay.appendChild(el);
    }
  });
}

// ── Signature Pad ─────────────────────────────────────────────────────────────
(function initSigPad() {
  const canvas = document.getElementById('sigCanvas');
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let lastX, lastY;

  ctx.strokeStyle = '#1a1209';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    if (e.touches) {
      return { x: (e.touches[0].clientX - r.left) * (canvas.width / r.width),
               y: (e.touches[0].clientY - r.top) * (canvas.height / r.height) };
    }
    return { x: (e.clientX - r.left) * (canvas.width / r.width),
             y: (e.clientY - r.top) * (canvas.height / r.height) };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    const p = getPos(e);
    lastX = p.x; lastY = p.y;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 1, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1209';
    ctx.fill();
  }

  function draw(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x; lastY = p.y;
  }

  function stop() {
    if (drawing) {
      drawing = false;
      sigDataUrl = canvas.toDataURL('image/png');
    }
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('mouseleave', stop);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  canvas.addEventListener('touchend', stop);

  document.getElementById('clearSig').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sigDataUrl = null;
  });

  document.getElementById('typeSig').addEventListener('click', () => {
    const name = prompt('Type your name:');
    if (!name) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'italic 28px Georgia, serif';
    ctx.fillStyle = '#1a1209';
    ctx.fillText(name, 10, 60);
    sigDataUrl = canvas.toDataURL('image/png');
  });

  document.getElementById('placeSig').addEventListener('click', () => {
    if (!sigDataUrl) { toast('Draw or type your signature first'); return; }
    setTool('sign');
    toast('Click on the PDF to place signature');
  });
})();

// ── Download as flat PNG-based PDF ────────────────────────────────────────────
async function downloadFlatPDF() {
  toast('Preparing download…', 5000);

  // DRAG_BAR_H must match the .drag-bar height in CSS (10px)
  const DRAG_BAR_H = 10;
  // TEXT_PAD_TOP: padding-top inside .text-inner (2px)
  const TEXT_PAD = 2;

  const pageImages = [];
  for (let i = 0; i < pages.length; i++) {
    const { canvas, overlay, viewport } = pages[i];

    // Create a flat canvas at the EXACT same pixel size as the rendered page
    const flat = document.createElement('canvas');
    flat.width = viewport.width;
    flat.height = viewport.height;
    const ctx = flat.getContext('2d');

    // 1. Draw the original rendered PDF page
    ctx.drawImage(canvas, 0, 0);

    // 2. Draw highlights — coordinates come straight from ann object
    const highlightAnns = annotations.filter(a => a.pageIdx === i && a.type === 'highlight');
    highlightAnns.forEach(ann => {
      ctx.fillStyle = 'rgba(244,184,66,0.4)';
      ctx.fillRect(ann.x, ann.y, ann.w, ann.h);
    });

    // 3. Draw text annotations
    //    ann.x/ann.y = top-left of the outer wrapper div
    //    actual text starts after drag bar (DRAG_BAR_H) + padding (TEXT_PAD)
    //    ctx.fillText baseline = y + fontSize (canvas text is drawn at baseline)
    const textAnns = annotations.filter(a => a.pageIdx === i && a.type === 'text');
    textAnns.forEach(ann => {
      if (!ann.text) return;
      ctx.font = `${ann.fontSize}px monospace`;
      ctx.fillStyle = ann.color;
      const lines = ann.text.split('\n');
      const lineH = ann.fontSize * 1.4;
      // textY: top of text content area + padding + one line height (baseline)
      const textTopY = ann.y + DRAG_BAR_H + TEXT_PAD;
      lines.forEach((line, li) => {
        ctx.fillText(line, ann.x + TEXT_PAD + 4, textTopY + ann.fontSize + li * lineH);
      });
    });

    // 4. Draw signature annotations
    const sigAnns = annotations.filter(a => a.pageIdx === i && a.type === 'sig');
    await Promise.all(sigAnns.map(ann => new Promise(res => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, ann.x, ann.y, ann.w, ann.h);
        res();
      };
      img.src = ann.dataUrl;
    })));

    pageImages.push(flat.toDataURL('image/jpeg', 0.92));
  }

  // Build PDF — pass exact canvas pixel dimensions so the image fills each page perfectly
  const pdfBytes = buildSimplePDF(pageImages, pages.map(p => ({ w: p.viewport.width, h: p.viewport.height })));
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const name = document.getElementById('docName').textContent.replace('.pdf', '') || 'document';
  a.download = `${name}-signed.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Downloaded!');
}

function buildSimplePDF(imageDataUrls, dims) {
  // Minimal PDF with JPEG images per page
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [];

  function push(str) { parts.push(encoder.encode(str)); }
  function pushRaw(arr) { parts.push(arr); }

  function totalLen() { return parts.reduce((s, p) => s + p.length, 0); }

  push('%PDF-1.4\n');
  push('%\xFF\xFF\xFF\xFF\n');

  // We'll build objects: 1=catalog, 2=pages, then per page: 3+3i=page, 4+3i=contents, 5+3i=xobj
  const numPages = imageDataUrls.length;
  const pageObjIds = [], contentObjIds = [], xobjIds = [];
  const imageBuffers = [];

  for (let i = 0; i < numPages; i++) {
    pageObjIds.push(3 + i * 3);
    contentObjIds.push(4 + i * 3);
    xobjIds.push(5 + i * 3);
  }

  const catalog = 1, pagesObj = 2;
  const nextId = 3 + numPages * 3;

  // Parse JPEG data urls
  for (let i = 0; i < numPages; i++) {
    const b64 = imageDataUrls[i].split(',')[1];
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) buf[j] = bin.charCodeAt(j);
    imageBuffers.push(buf);
  }

  // Object 1: catalog
  offsets[1] = totalLen();
  push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  // Object 2: pages
  offsets[2] = totalLen();
  push(`2 0 obj\n<< /Type /Pages /Kids [`);
  pageObjIds.forEach(id => push(`${id} 0 R `));
  push(`] /Count ${numPages} >>\nendobj\n`);

  for (let i = 0; i < numPages; i++) {
    // Use canvas pixel dimensions directly as PDF "points"
    // This makes 1 canvas pixel = 1 PDF point, giving correct 1:1 mapping.
    // The PDF viewer will scale to fit the page naturally.
    const pw = Math.round(dims[i].w);
    const ph = Math.round(dims[i].h);
    const pid = pageObjIds[i], cid = contentObjIds[i], xid = xobjIds[i];

    // Page object
    offsets[pid] = totalLen();
    push(`${pid} 0 obj\n<< /Type /Page /Parent 2 0 R `);
    push(`/MediaBox [0 0 ${pw} ${ph}] `);
    push(`/Contents ${cid} 0 R `);
    push(`/Resources << /XObject << /Im${i} ${xid} 0 R >> >> >>\nendobj\n`);

    // Content stream
    const streamStr = `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q\n`;
    const streamBytes = encoder.encode(streamStr);
    offsets[cid] = totalLen();
    push(`${cid} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
    pushRaw(streamBytes);
    push(`\nendstream\nendobj\n`);

    // Image XObject
    const imgBuf = imageBuffers[i];
    offsets[xid] = totalLen();
    push(`${xid} 0 obj\n<< /Type /XObject /Subtype /Image `);
    push(`/Width ${Math.round(dims[i].w)} /Height ${Math.round(dims[i].h)} `);
    push(`/ColorSpace /DeviceRGB /BitsPerComponent 8 `);
    push(`/Filter /DCTDecode /Length ${imgBuf.length} >>\nstream\n`);
    pushRaw(imgBuf);
    push(`\nendstream\nendobj\n`);
  }

  // xref
  const xrefOffset = totalLen();
  const maxId = xobjIds[numPages - 1];
  push(`xref\n0 ${maxId + 1}\n`);
  push(`0000000000 65535 f \n`);
  for (let id = 1; id <= maxId; id++) {
    const off = offsets[id] ?? 0;
    push(off.toString().padStart(10, '0') + ` 00000 n \n`);
  }
  push(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\n`);
  push(`startxref\n${xrefOffset}\n%%EOF\n`);

  // Concatenate
  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return result;
}

// ── Save (to extension storage) ───────────────────────────────────────────────
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sanitiseStorageKey(str) {
  return String(str).replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 128);
}

function saveSession() {
  const key = 'session_' + sanitiseStorageKey(pdfName);
  const payload = {
    annotations: JSON.parse(JSON.stringify(annotations)), // deep copy
    savedAt: Date.now()
  };
  chrome.storage.local.set({ [key]: JSON.stringify(payload) }, () => toast('Saved ✓'));
  pruneExpiredSessions();
}

function pruneExpiredSessions() {
  chrome.storage.local.get(null, allData => {
    const now = Date.now();
    const toRemove = [];
    for (const [k, v] of Object.entries(allData)) {
      if (!k.startsWith('session_')) continue;
      try {
        const parsed = JSON.parse(v);
        if (!parsed.savedAt || now - parsed.savedAt > SESSION_TTL_MS) {
          toRemove.push(k);
        }
      } catch {
        toRemove.push(k); // corrupt entry — remove it
      }
    }
    if (toRemove.length) chrome.storage.local.remove(toRemove);
  });
}

// ── Zoom ──────────────────────────────────────────────────────────────────────
function applyZoom(newScale) {
  scale = Math.min(3, Math.max(0.5, newScale));
  if (!pdfDoc) return;
  // Re-render at new scale
  const canvasArea = document.getElementById('canvasArea');
  canvasArea.innerHTML = '';
  pages = [];
  (async () => {
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      await renderPage(i, canvasArea);
    }
    rerenderAnnotations();
  })();
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);
document.getElementById('downloadBtn').addEventListener('click', downloadFlatPDF);
document.getElementById('saveBtn').addEventListener('click', saveSession);
document.getElementById('zoomIn').addEventListener('click', () => applyZoom(scale + 0.2));
document.getElementById('zoomOut').addEventListener('click', () => applyZoom(scale - 0.2));
document.getElementById('zoomReset').addEventListener('click', () => applyZoom(1.4));

document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.panel + 'Panel').classList.add('active');
  });
});

document.querySelectorAll('.swatch').forEach(s => {
  s.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(x => x.classList.remove('active'));
    s.classList.add('active');
    selectedColor = s.dataset.color;
  });
});

document.getElementById('fontSize').addEventListener('input', e => {
  fontSize = parseInt(e.target.value) || 14;
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'y') { e.preventDefault(); redo(); }
    if (e.key === 's') { e.preventDefault(); saveSession(); }
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const sel = document.querySelector('.annotation.selected');
    if (sel && document.activeElement !== sel && !document.activeElement.isContentEditable) {
      deleteAnnotation(sel.dataset.id);
    }
  }
  if (e.key === 'Escape') setTool('select');
  if (e.key === 't' && !e.ctrlKey && !document.activeElement.isContentEditable) setTool('text');
  if (e.key === 's' && !e.ctrlKey && !document.activeElement.isContentEditable) setTool('sign');
  if (e.key === 'h' && !e.ctrlKey && !document.activeElement.isContentEditable) setTool('highlight');
});

// ── Parse URL params and load ─────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const pdfUrl    = params.get('url');
const sessionKey = params.get('sessionKey'); // for locally-uploaded files
const rawName   = params.get('name') || 'document.pdf';

// Sanitise the display name — used in UI and as part of storage keys
const pdfName = sanitiseStorageKey(rawName);

// Display name shown in toolbar (use raw but set via textContent — safe)
document.getElementById('docName').textContent = rawName;
document.title = rawName + ' — Browsign';

// Check PDF.js loaded
if (!window.pdfjsLib || !pdfjsLib.getDocument) {
  document.getElementById('loadText').innerHTML =
    '⚠️ PDF.js not installed.<br><br>' +
    'Run <code>node setup.js</code> inside the extension folder,<br>' +
    'then reload the extension in chrome://extensions/';
  document.getElementById('loadFill').style.background = '#c0441a';
  document.getElementById('loadFill').style.width = '100%';
} else if (sessionKey) {
  // Local upload: retrieve bytes from session storage (never touches URL bar)
  chrome.storage.session.get(decodeURIComponent(sessionKey), data => {
    const dataUrl = data[decodeURIComponent(sessionKey)];
    if (dataUrl) {
      loadPDF(dataUrl);
    } else {
      document.getElementById('loadText').textContent =
        'Session expired. Please re-upload the file.';
    }
  });
} else if (pdfUrl) {
  loadPDF(decodeURIComponent(pdfUrl));
} else {
  document.getElementById('loadText').textContent = 'No PDF specified.';
}

// Try restore saved annotation session (with TTL check)
const sessionStorageKey = 'session_' + pdfName;
chrome.storage.local.get(sessionStorageKey, data => {
  const raw = data[sessionStorageKey];
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.savedAt && Date.now() - parsed.savedAt <= SESSION_TTL_MS) {
      annotations = parsed.annotations || [];
      rerenderAnnotations();
      toast('Session restored');
    } else {
      // Expired — clean up silently
      chrome.storage.local.remove(sessionStorageKey);
    }
  } catch {
    chrome.storage.local.remove(sessionStorageKey);
  }
});

// Prune any other expired sessions on load
pruneExpiredSessions();
