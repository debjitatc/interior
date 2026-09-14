// ─── SCROLL-DRIVEN HERO ──────────────────────────────────────────────────────
const ScrollHero = {
  FRAMES: 120,
  TRIGGER_FRAME: 114,
  images: [],
  loaded: 0,
  currentFrame: -1,
  ticking: false,
  
  init() {
    this.canvas = document.getElementById('hero-canvas');
    if (!this.canvas) return; // not on the page
    this.ctx = this.canvas.getContext('2d');
    this.scrollTrack = document.getElementById('scroll-track');
    this.uploadCard = document.getElementById('upload-card');
    this.topbar = document.querySelector('.topbar');
    this.scrollIndicator = document.getElementById('scroll-indicator');
    this.scrollProgress = document.getElementById('scroll-progress');
    this.scrollProgressFill = document.getElementById('scroll-progress-fill');
    this.scrollProgressValue = document.getElementById('scroll-progress-value');
    this.stage1 = document.getElementById('stage1');
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    // Resize handler
    window.addEventListener('resize', () => {
      this.resize();
      if (this.currentFrame > 0) this.render(this.currentFrame);
      this.requestRender();
    });
    this.resize();
    
    // Preload frames
    for (let i = 1; i <= this.FRAMES; i++) {
      const img = new Image();
      const frameNum = i.toString().padStart(3, '0');
      img.src = `/static/gwr_frames/frame_${frameNum}.webp`;
      img.onload = () => {
        this.loaded++;
        // If the frame we just loaded is the one we want to show, render it!
        if (i === this.currentFrame || (i === 1 && this.currentFrame === -1)) {
            this.currentFrame = i;
            this.render(i);
        }
      };
      this.images[i] = img;
    }
    
    // Scroll handler
    if (this.stage1) {
      this.stage1.addEventListener('scroll', () => this.requestRender(), { passive: true });
    }
    this.bindCardLight();
    this.onScroll();
  },

  requestRender() {
    if (this.ticking) return;
    this.ticking = true;
    requestAnimationFrame(() => {
      this.onScroll();
      this.ticking = false;
    });
  },

  bindCardLight() {
    const card = this.uploadCard && this.uploadCard.querySelector('.upload-card');
    if (!card || this.reducedMotion) return;
    card.addEventListener('pointermove', event => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--light-x', `${event.clientX - rect.left}px`);
      card.style.setProperty('--light-y', `${event.clientY - rect.top}px`);
    }, { passive: true });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--light-x', '50%');
      card.style.setProperty('--light-y', '20%');
    });
  },
  
  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  },
  
  onScroll() {
    if (!this.scrollTrack || !this.stage1) return;
    
    const scrollY = this.reducedMotion ? 0 : this.stage1.scrollTop;
    
    // Hide scroll indicator once scrolled
    if (scrollY > 50 && this.scrollIndicator) {
      this.scrollIndicator.classList.add('hidden');
    }
    
    // Topbar scrolled effect
    if (scrollY > 10 && this.topbar) {
      this.topbar.classList.add('scrolled');
    } else if (this.topbar) {
      this.topbar.classList.remove('scrolled');
    }
    
    // Calculate progress
    const maxScroll = this.scrollTrack.offsetHeight - this.stage1.clientHeight;
    const clampedScroll = Math.max(0, Math.min(scrollY, maxScroll));
    let progress = this.reducedMotion ? 1 : (maxScroll > 0 ? clampedScroll / maxScroll : 0);

    const cardVisible = this.reducedMotion || progress >= (this.TRIGGER_FRAME - 1) / (this.FRAMES - 1);
    if (this.uploadCard) this.uploadCard.classList.toggle('visible', cardVisible);
    if (this.scrollProgress) this.scrollProgress.classList.toggle('hidden', cardVisible);
    if (this.scrollProgressFill) this.scrollProgressFill.style.transform = `scaleY(${progress})`;
    if (this.scrollProgressValue) this.scrollProgressValue.textContent = `${Math.round(progress * 100)}%`;
    if (this.scrollIndicator) this.scrollIndicator.classList.toggle('hidden', progress > .035 || cardVisible);
    
    // Frame calculation
    let frame = Math.round(progress * (this.FRAMES - 1)) + 1;
    frame = Math.max(1, Math.min(this.FRAMES, frame));
    
    if (frame !== this.currentFrame) {
      this.render(frame);
      this.currentFrame = frame;
      
    }
  },
  
  render(frameIndex) {
    const img = this.images[frameIndex];
    if (!img || !img.complete || img.naturalWidth === 0) return;
    
    // Draw with object-fit: cover equivalent
    const canvasRatio = this.canvas.width / this.canvas.height;
    const imgRatio = img.width / img.height;
    
    let drawWidth, drawHeight, offsetX = 0, offsetY = 0;
    
    if (canvasRatio > imgRatio) {
      drawWidth = this.canvas.width;
      drawHeight = drawWidth / imgRatio;
      offsetY = (this.canvas.height - drawHeight) / 2;
    } else {
      drawHeight = this.canvas.height;
      drawWidth = drawHeight * imgRatio;
      offsetX = (this.canvas.width - drawWidth) / 2;
    }
    
    // Clear and draw
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
  }
};

// Initialize ScrollHero when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  ScrollHero.init();
});

// ─── Pin identity colours (for numbering pins on the photo) ──────────────────
const COLORS = [
  '#FF6B6B','#4ECDC4','#FFE66D','#A8E6CF','#FF8B94',
  '#6C63FF','#FFA07A','#00CED1','#FF69B4','#ADFF2F',
  '#FF4500','#9370DB','#00FA9A','#FF6347','#1E90FF'
];

// ─── Interior colour palette offered per region ──────────────────────────────
const COLOR_PALETTE = [
  // Whites & neutrals
  { name: 'Pure White',     hex: '#FFFFFF' },
  { name: 'Warm White',     hex: '#F3EEE7' },
  { name: 'Ivory',          hex: '#F5EBDD' },
  { name: 'Soft Cream',     hex: '#EFE3CE' },
  { name: 'Beige',          hex: '#D9C7A7' },
  { name: 'Sand',           hex: '#CBB48F' },
  { name: 'Greige',         hex: '#C9BFB2' },
  { name: 'Taupe',          hex: '#A99A88' },
  { name: 'Warm Grey',      hex: '#B9B2A8' },
  { name: 'Stone Grey',     hex: '#8E8A83' },
  { name: 'Slate Grey',     hex: '#6E7377' },
  { name: 'Charcoal',       hex: '#3A3A3C' },
  { name: 'Graphite',       hex: '#2B2B2E' },
  { name: 'Matte Black',    hex: '#1E1E1E' },
  // Warm / earthy
  { name: 'Peach',          hex: '#F2B79A' },
  { name: 'Blush Pink',     hex: '#E7C1BE' },
  { name: 'Coral',          hex: '#E8836B' },
  { name: 'Dusty Rose',     hex: '#C48B86' },
  { name: 'Clay',           hex: '#C08457' },
  { name: 'Terracotta',     hex: '#C56A4E' },
  { name: 'Burnt Sienna',   hex: '#B5551F' },
  { name: 'Rust',           hex: '#9E4A32' },
  { name: 'Brick Red',      hex: '#8A3324' },
  { name: 'Ruby Red',       hex: '#9B1B30' },
  { name: 'Wine',           hex: '#5C1330' },
  // Yellows / golds
  { name: 'Butter',         hex: '#F2D98D' },
  { name: 'Golden Yellow',  hex: '#E4B429' },
  { name: 'Marigold',       hex: '#E8992A' },
  { name: 'Mustard Yellow', hex: '#D6A72E' },
  { name: 'Ochre',          hex: '#B9832B' },
  { name: 'Caramel',        hex: '#B5772E' },
  // Greens
  { name: 'Pistachio',      hex: '#BFD3A3' },
  { name: 'Sage Green',     hex: '#9CA98B' },
  { name: 'Eucalyptus',     hex: '#7E9E8B' },
  { name: 'Olive',          hex: '#6B6B3A' },
  { name: 'Moss Green',     hex: '#5A6B3B' },
  { name: 'Fern Green',     hex: '#4B7D46' },
  { name: 'Forest Green',   hex: '#2F5D46' },
  { name: 'Emerald',        hex: '#1F7A5C' },
  { name: 'Teal',           hex: '#2E7D82' },
  { name: 'Deep Teal',      hex: '#1E5B60' },
  // Blues
  { name: 'Powder Blue',    hex: '#CBDCEF' },
  { name: 'Sky Blue',       hex: '#8FB8D8' },
  { name: 'Cornflower',     hex: '#7EA6D8' },
  { name: 'Denim Blue',     hex: '#4E77A8' },
  { name: 'Slate Blue',     hex: '#5B7290' },
  { name: 'Steel Blue',     hex: '#3E5C82' },
  { name: 'Navy Blue',      hex: '#2A3A5E' },
  { name: 'Midnight Blue',  hex: '#1C2740' },
  // Purples / pinks
  { name: 'Rose Pink',      hex: '#E9A6B3' },
  { name: 'Lilac',          hex: '#CDBFE3' },
  { name: 'Lavender',       hex: '#B7ADD1' },
  { name: 'Mauve',          hex: '#9E7FA6' },
  { name: 'Plum',           hex: '#6E3E64' },
  { name: 'Aubergine',      hex: '#4A2C40' },
];

// ─── Wall sticker / decal designs (real template images from /wallstickers) ──
const STICKER_BASE = '/wallstickers/';
const WALL_STICKERS = [
  { name: 'None',             file: '',      desc: '' },
  { name: 'Blue Groovy Swirls', file: 'w1.jpg', desc: 'retro groovy swirling wave pattern in navy and blue tones' },
  { name: 'Crimson Squiggle', file: 'w2.jpg', desc: 'organic crimson-red and cream squiggle/blob pattern' },
  { name: 'Ocean Waves',      file: 'w3.jpg', desc: 'flowing blue ocean wave line-art pattern' },
  { name: 'Magenta Flow',     file: 'w4.jpg', desc: 'abstract magenta-to-white flowing fluid art mural' },
  { name: 'Purple Marble',    file: 'w5.jpg', desc: 'purple and white liquid marble swirl pattern' },
  { name: 'Green Leaves',     file: 'w6.jpg', desc: 'lush green leaf botanical pattern on dark background' },
  { name: 'Teal Blossoms',    file: 'w7.jpg', desc: 'teal and cream blossom flowers with golden centres' },
  { name: 'Peacock Feathers', file: 'w8.jpg', desc: 'vibrant peacock feather pattern in teal, green and gold' },
];

// ─── State ──────────────────────────────────────────────────────────────────
const S = {
  originalImage: null, imgW: 0, imgH: 0,
  markers: [],         // stage 2: [{number, x, y, color}]
  regions: [],         // stage 3: same markers, finalized
  colorIdx: 0,
  refImageB64: null,
  selectedRegion: 0,   // index into S.regions currently focused
  workingImage: null,  // running base — starts as the original, updates after each edit
  regionColors: {},    // { regionNumber: {name, hex} } chosen from the palette
  regionStickers: {},  // { regionNumber: {name, desc} } chosen wall stickers
  regionSurfaces: {},  // { regionNumber: 'wall'|'floor'|'ceiling' }
};

const SURFACES = ['wall', 'floor', 'ceiling'];

// Build a prompt template + colour/sticker maps from each region's selections.
function buildRegionTemplate() {
  const lines = [];
  const colorMap = {};
  const stickerMap = {};
  const surfaceMap = {};
  S.markers.forEach(m => {
    surfaceMap[m.number] = m.surface || 'wall';
    const parts = [];
    if (m.fill) {
      parts.push(`paint this surface ${m.fill.name} (${m.fill.hex})`);
      colorMap[m.number] = { name: m.fill.name, hex: m.fill.hex };
    }
    if (m.sticker) {
      parts.push(`add a ${m.sticker.name} sticker (${m.sticker.desc})`);
      stickerMap[m.number] = { name: m.sticker.name, file: m.sticker.file, desc: m.sticker.desc };
    }
    if (parts.length) lines.push(`Region ${m.number} (${surfaceMap[m.number]}): ${parts.join(', and ')}.`);
  });
  return { template: lines.join('\n'), colorMap, stickerMap, surfaceMap };
}

// ─── DOM refs ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dropZone     = $('drop-zone');
const fileInput    = $('file-input');
const previewWrap  = $('preview-wrap');
const previewImg   = $('preview-img');
const proceedBtn   = $('proceed-btn');
const editorImg    = $('editor-img');
const editorCanvas = $('editor-canvas');
const ctx          = editorCanvas.getContext('2d');
const polyList     = $('poly-list');
const genMaskBtn   = $('gen-mask-btn');
const annotatedImg = $('annotated-img');
const originalImg  = $('original-img');
const outputImg    = $('output-img');
const regionChips  = $('region-chips');
const regionCount  = $('region-count');
const describeTag  = $('describe-region-tag');
const promptTxt    = $('prompt-txt');
const generateBtn  = $('generate-btn');
const generateAllBtn = $('generate-all-btn');
const promptProgress = $('prompt-progress');
const viewFrame    = $('view-frame');
const viewBottom   = $('view-bottom');
const downloadBtn  = $('download-btn');
const resultPH     = $('result-placeholder');
const tabResult    = $('tab-result');
const tabCompare   = $('tab-compare');
const compareEl    = $('compare');
const cmpAfter     = $('cmp-after');
const cmpBefore    = $('cmp-before');
const cmpDivider   = $('cmp-divider');
const cmpRange     = $('cmp-range');
const toast        = $('toast');

function updateCompare(pct) {
  cmpBefore.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  cmpDivider.style.left = pct + '%';
}
if (cmpRange) cmpRange.addEventListener('input', () => updateCompare(+cmpRange.value));

// Size the compare box to the image's EXACT displayed size within the frame
// (contain math) so there is no letterbox and the wipe aligns with the picture.
function sizeCompare() {
  const frame = $('view-frame');
  if (!S.imgW || !S.imgH || !frame) return;
  const pad = 28; // ~1.75rem padding on the frame
  const availW = frame.clientWidth  - pad * 2;
  const availH = frame.clientHeight - pad * 2;
  if (availW <= 0 || availH <= 0) return;
  const scale = Math.min(availW / S.imgW, availH / S.imgH);
  compareEl.style.width  = Math.round(S.imgW * scale) + 'px';
  compareEl.style.height = Math.round(S.imgH * scale) + 'px';
}
window.addEventListener('resize', () => { if (compareEl.classList.contains('visible')) sizeCompare(); });

// ─── Video: loader (plays once on open, then hides) ──────────────────────────
(function () {
  const screen = $('loader-screen');
  const vid    = $('loader-video');
  if (!screen || !vid) return;
  vid.play().catch(() => {});   // muted autoplay; ignore transient block
  function hide() { screen.classList.add('hidden'); }
  vid.addEventListener('ended', hide);
  // Safety fallback: hide after 9 s even if the ended event doesn't fire.
  setTimeout(hide, 9000);
})();

// ─── Video: generate animation (shown while AI is running) ───────────────────
const genAnimOverlay = $('gen-anim-overlay');
const genAnimVideo   = $('gen-anim-video');

function showGenAnim() {
  if (!genAnimOverlay || !genAnimVideo) return;
  genAnimVideo.currentTime = 0;
  genAnimVideo.play().catch(() => {});
  genAnimOverlay.classList.add('active');
}
function hideGenAnim() {
  if (!genAnimOverlay || !genAnimVideo) return;
  genAnimOverlay.classList.remove('active');
  genAnimVideo.pause();
}
function showToast(msg, type='info') {
  toast.textContent = msg;
  toast.className = `show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.className='', 3800);
}

function setStage(n) {
  document.querySelectorAll('.stage').forEach(s => s.classList.remove('active'));
  $(`stage${n}`).classList.add('active');
  document.querySelectorAll('.stage-step').forEach((s,i) => {
    s.classList.remove('active','done');
    if (i+1 === n) s.classList.add('active');
    else if (i+1 < n) s.classList.add('done');
  });
}

function setLoading(btn, on) {
  btn.disabled = on;
  const sp = btn.querySelector('.spinner');
  if (sp) sp.style.display = on ? 'block' : 'none';
}

function canvasCoords(e) {
  const r = editorCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (editorCanvas.width  / r.width),
    y: (e.clientY - r.top)  * (editorCanvas.height / r.height),
  };
}

// Keep the canvas exactly over the letterboxed photo so pins land where clicked.
function syncCanvasToImage() {
  if (!S.imgW || !S.imgH) return;
  const cont = editorCanvas.parentElement;      // #canvas-container
  const cw = cont.clientWidth, ch = cont.clientHeight;
  if (!cw || !ch) return;
  const scale = Math.min(cw / S.imgW, ch / S.imgH);
  const dispW = S.imgW * scale, dispH = S.imgH * scale;
  editorCanvas.style.left   = ((cw - dispW) / 2) + 'px';
  editorCanvas.style.top    = ((ch - dispH) / 2) + 'px';
  editorCanvas.style.width  = dispW + 'px';
  editorCanvas.style.height = dispH + 'px';
}

window.addEventListener('resize', () => {
  if ($('stage2').classList.contains('active')) { syncCanvasToImage(); render(); }
});

// ─── STAGE 1: UPLOAD ─────────────────────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) uploadFile(f);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadFile(fileInput.files[0]); });

async function uploadFile(file) {
  setLoading(proceedBtn, true);
  proceedBtn.style.display = 'inline-flex';
  const fd = new FormData(); fd.append('image', file);
  try {
    const res = await fetch('/upload', {method:'POST', body:fd});
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    S.originalImage = data.image; S.imgW = data.width; S.imgH = data.height;
    previewImg.src = `data:image/png;base64,${data.image}`;
    dropZone.style.display = 'none';
    previewWrap.style.display = 'block';
    showToast('Image loaded — click Proceed when ready', 'success');
  } catch(e) { showToast('Upload failed: '+e.message, 'error'); }
  finally { setLoading(proceedBtn, false); }
}

proceedBtn.addEventListener('click', () => {
  setStage(2);
  requestAnimationFrame(() => requestAnimationFrame(initEditor));
});

$('back-to-upload').addEventListener('click', () => {
  // Let the user pick a new file immediately rather than resetting to the empty state.
  fileInput.value = '';
  fileInput.click();
});

// ─── STAGE 2: PLACE NUMBERED PINS (no segmentation) ──────────────────────────
function initEditor() {
  S.markers = []; S.colorIdx = 0;
  updateMarkerList();
  const prepare = () => {
    editorCanvas.width  = S.imgW;
    editorCanvas.height = S.imgH;
    syncCanvasToImage();
    render();
  };
  editorImg.onload = prepare;
  editorImg.src = `data:image/png;base64,${S.originalImage}`;
  if (editorImg.complete && editorImg.naturalWidth) prepare();
  setHint();
}

function setHint() {
  const h = $('editor-hint');
  if (h) h.innerHTML = '<strong>Click a surface</strong> to drop a numbered pin. Describe each number in the prompt on the next step. <strong>Right-click</strong> removes the last pin.';
}

editorCanvas.addEventListener('click', e => {
  const pt = canvasCoords(e);
  const color = COLORS[S.colorIdx % COLORS.length]; S.colorIdx++;
  S.markers.push({ number: S.markers.length + 1, x: pt.x, y: pt.y, color, surface: 'wall' });
  updateMarkerList(); render();
});
editorCanvas.addEventListener('contextmenu', e => { e.preventDefault(); removeLastMarker(); });

function removeLastMarker() {
  if (!S.markers.length) return;
  S.markers.pop();
  S.markers.forEach((m,i) => m.number = i+1);
  updateMarkerList(); render();
}

function updateMarkerList() {
  if (S.markers.length === 0) {
    polyList.innerHTML = '<p style="font-size:.78rem;color:var(--ink-muted);padding:.3rem 0">No points yet — click a surface to drop a numbered pin</p>';
    return;
  }
  polyList.innerHTML = '';
  S.markers.forEach((m,i) => {
    const d = document.createElement('div');
    d.className = 'region-row';
    const fillSw = m.fill ? m.fill.hex : 'transparent';
    const fillLabel = m.fill ? `${m.fill.name} · ${m.fill.hex}` : 'Choose palette';
    const colorOptions = COLOR_PALETTE.map(c => {
      const sel = (m.fill && m.fill.hex.toLowerCase() === c.hex.toLowerCase()) ? ' sel' : '';
      return `<button type="button" class="cs-opt${sel}" data-i="${i}" data-kind="color" data-name="${c.name}" data-hex="${c.hex}" title="${c.name} ${c.hex}">
         <span class="cs-dot" style="background:${c.hex}"></span>
         <span class="cs-hex">${c.hex}</span>
       </button>`;
    }).join('');
    const stickerOptions = WALL_STICKERS.map(s => {
      const sel = ((m.sticker && m.sticker.name === s.name) || (!m.sticker && s.name === 'None')) ? ' sel' : '';
      const dot = s.file
        ? `<span class="cs-dot cs-thumb" style="background-image:url('${STICKER_BASE}${s.file}')"></span>`
        : `<span class="cs-dot cs-emoji">∅</span>`;
      return `<button type="button" class="cs-opt${sel}" data-i="${i}" data-kind="sticker" data-sticker="${s.name}" data-file="${s.file}" data-desc="${s.desc}" title="${s.name}">
         ${dot}
         <span class="cs-name">${s.name}</span>
       </button>`;
    }).join('');
    const stickerLabel = m.sticker ? m.sticker.name : 'Wall Design';
    const stickerBtnDot = (m.sticker && m.sticker.file)
      ? `<span class="cs-dot cs-dot-sm cs-thumb" style="background-image:url('${STICKER_BASE}${m.sticker.file}')"></span>`
      : `<span class="cs-dot cs-dot-sm cs-thumb-empty"></span>`;
    const surf = m.surface || 'wall';
    const surfaceBtns = SURFACES.map(s =>
      `<button type="button" class="surf-opt${surf === s ? ' active' : ''}" data-i="${i}" data-surf="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</button>`
    ).join('');
    d.innerHTML = `
      <div class="region-head">
        <span class="region-pin" style="background:${m.color}">${m.number}</span>
        <span class="region-title">Region ${m.number}</span>
        <button class="del-btn" data-del="${i}" title="Delete">✕</button>
      </div>
      <div class="surface-select">${surfaceBtns}</div>
      <div class="color-select" data-i="${i}">
        <button type="button" class="cs-btn" data-i="${i}">
          <span class="cs-dot cs-dot-sm" style="background:${fillSw};${m.fill?'':'border:1.5px dashed var(--border)'}"></span>
          <span class="cs-label">${fillLabel}</span>
          <span class="cs-caret">▾</span>
        </button>
        <div class="cs-menu">
          <div class="cs-menu-title">Choose a colour</div>
          <div class="cs-grid">${colorOptions}</div>
        </div>
      </div>
      <div class="color-select sticker-select" data-i="${i}">
        <button type="button" class="cs-btn" data-i="${i}">
          ${stickerBtnDot}
          <span class="cs-label">${stickerLabel}</span>
          <span class="cs-caret">▾</span>
        </button>
        <div class="cs-menu">
          <div class="cs-menu-title">Choose a wall design</div>
          <div class="cs-grid">${stickerOptions}</div>
        </div>
      </div>`;
    polyList.appendChild(d);
  });

  // delete
  polyList.querySelectorAll('.del-btn').forEach(b => b.addEventListener('click', () => {
    S.markers.splice(+b.dataset.del, 1);
    S.markers.forEach((m,i) => m.number = i+1);
    updateMarkerList(); render();
  }));
  // surface type (wall / floor / ceiling)
  polyList.querySelectorAll('.surf-opt').forEach(b => b.addEventListener('click', () => {
    S.markers[+b.dataset.i].surface = b.dataset.surf;
    updateMarkerList();
  }));
  // open/close dropdown
  polyList.querySelectorAll('.cs-btn').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const sel = b.closest('.color-select');
    const open = sel.classList.contains('open');
    closeAllColorMenus();
    if (!open) sel.classList.add('open');
  }));
  // pick a colour or a sticker
  polyList.querySelectorAll('.cs-opt').forEach(o => o.addEventListener('click', (e) => {
    e.stopPropagation();
    const i = +o.dataset.i;
    if (o.dataset.kind === 'sticker') {
      if (o.dataset.sticker === 'None') {
        S.markers[i].sticker = null;
      } else {
        S.markers[i].sticker = { name: o.dataset.sticker, file: o.dataset.file, desc: o.dataset.desc };
        S.markers[i].fill = null;      // one at a time — sticker clears colour
      }
    } else {
      S.markers[i].fill = { name: o.dataset.name, hex: o.dataset.hex };
      S.markers[i].sticker = null;     // one at a time — colour clears sticker
    }
    closeAllColorMenus();
    updateMarkerList();
  }));
}

function closeAllColorMenus() {
  document.querySelectorAll('.color-select.open').forEach(s => s.classList.remove('open'));
}
document.addEventListener('click', closeAllColorMenus);

// ─── Canvas rendering (numbered pins only) ───────────────────────────────────
function render() {
  ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
  S.markers.forEach(m => drawPin(m));
}

function drawPin(m) {
  const r = Math.max(14, Math.min(S.imgW / 75, 28));
  ctx.save();
  // Drop shadow for depth
  ctx.shadowColor = 'rgba(0,0,0,0.32)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  // Circle
  ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
  ctx.fillStyle = m.color; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, r / 6); ctx.stroke();
  // Number — most reliable centering: textBaseline middle + small font so
  // the digit sits comfortably inside the circle
  const fontSize = Math.round(r * 0.78);
  ctx.font = `800 ${fontSize}px "Inter", "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(m.detecting ? '…' : m.number), m.x, m.y);
  ctx.restore();
}

// Toolbar buttons
$('undo-btn').addEventListener('click', removeLastMarker);
$('clear-all-btn').addEventListener('click', () => {
  S.markers = []; S.colorIdx = 0;
  updateMarkerList(); render();
});
$('back-to-upload2').addEventListener('click', () => setStage(1));

// Finalize: build the numbered preview and go to stage 3.
genMaskBtn.addEventListener('click', async () => {
  if (S.markers.length === 0) { showToast('Click a surface to drop at least one numbered pin first', 'error'); return; }
  setLoading(genMaskBtn, true);
  try {
    const markers = S.markers.map(m => ({ number: m.number, x: Math.round(m.x), y: Math.round(m.y), color: m.color }));
    const res = await fetch('/generate-mask', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ image: S.originalImage, markers })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    // Carry each region's chosen palette colour into stage 3.
    S.regions = S.markers.map(m => ({ number: m.number, x: Math.round(m.x), y: Math.round(m.y), color: m.color, fill: m.fill || null }));
    const { colorMap, stickerMap, surfaceMap } = buildRegionTemplate();
    S.regionColors = colorMap;
    S.regionStickers = stickerMap;
    S.regionSurfaces = surfaceMap;
    annotatedImg.src = `data:image/png;base64,${data.annotated_image}`;
    originalImg.src  = `data:image/png;base64,${S.originalImage}`;
    S.selectedRegion = 0;
    S.workingImage = S.originalImage;
    renderRegionChips();
    setStage(3);
  } catch(e) { showToast('Failed: '+e.message, 'error'); }
  finally { setLoading(genMaskBtn, false); }
});

// ─── STAGE 3: region chips ───────────────────────────────────────────────────
function renderRegionChips() {
  const n = S.regions.length;
  if (S.selectedRegion >= n) S.selectedRegion = 0;
  if (regionCount) {
    regionCount.textContent = n === 0 ? 'No regions yet'
      : `You have ${n} region${n > 1 ? 's' : ''} — pick one to edit`;
  }
  if (regionChips) {
    regionChips.innerHTML = '';
    S.regions.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'region-chip' + (i === S.selectedRegion ? ' active' : '');
      b.innerHTML = `<span class="region-chip-dot" style="background:${p.color}"></span> Region ${p.number}`;
      b.addEventListener('click', () => { S.selectedRegion = i; renderRegionChips(); });
      regionChips.appendChild(b);
    });
  }
  updateActiveRegionUI();
}

function updateActiveRegionUI() {
  const p = S.regions[S.selectedRegion];
  const num = p ? p.number : 1;
  if ($('active-region-num')) $('active-region-num').textContent = num;
  if (describeTag) describeTag.textContent = `Region ${num}`;
}

// Redraw the numbered preview over the CURRENT working image.
async function refreshAnnotated() {
  if (!S.workingImage || !S.regions.length) return;
  try {
    const res = await fetch('/generate-mask', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ image: S.workingImage, markers: S.regions })
    });
    const data = await res.json();
    if (data.annotated_image) annotatedImg.src = `data:image/png;base64,${data.annotated_image}`;
  } catch (e) { /* non-fatal */ }
}

// ─── STAGE 3: VIEW TABS ──────────────────────────────────────────────────────
const views = { annotated: annotatedImg, original: originalImg, result: outputImg };

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const v = btn.dataset.view;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(views).forEach(img => img.classList.remove('visible'));
    compareEl.classList.remove('visible');
    resultPH.style.display = 'none';
    if (v === 'compare') {
      if (outputImg.src.startsWith('data')) { compareEl.classList.add('visible'); sizeCompare(); }
      else resultPH.style.display = 'flex';
    } else if (v === 'result' && !outputImg.src.startsWith('data')) {
      resultPH.style.display = 'flex';
    } else if (views[v]) {
      views[v].classList.add('visible');
    }
  });
});

// (Reference-image feature removed — no handlers needed.)

// ─── STAGE 3: GENERATE (marker-guided, no masks) ─────────────────────────────

// Marker-guided edit: the model redesigns the whole surface each numbered pin
// sits on, driven by that region's chosen colour / sticker. Fills the surface
// properly (no blobby masks) while the strict prompt keeps objects untouched.
async function runEditMarkers(markers, baseImage) {
  const res = await fetch('/edit', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      original_image: S.originalImage,
      base_image: baseImage,
      markers,
      region_colors: S.regionColors || {},
      region_stickers: S.regionStickers || {},
      region_surfaces: S.regionSurfaces || {},
      prompt: '',
      reference_image: null,
    })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Unknown error');
  return data.output_image;
}

// Does a region have a colour or sticker chosen?
function regionHasSelection(num) {
  return !!(S.regionColors[num] || S.regionStickers[num]);
}
function markerFor(r) { return { number: r.number, x: r.x, y: r.y, color: r.color }; }

function showResult(b64, filename) {
  hideGenAnim();
  const src = `data:image/png;base64,${b64}`;
  outputImg.src = src;
  downloadBtn.href = src; downloadBtn.download = filename;
  // Feed the before/after slider (before = original, after = result).
  cmpAfter.src = src;
  cmpBefore.src = `data:image/png;base64,${S.originalImage}`;
  cmpRange.value = 50; updateCompare(50);
  sizeCompare();
  tabCompare.disabled = false;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  tabResult.classList.add('active'); tabResult.disabled = false;
  Object.values(views).forEach(img => img.classList.remove('visible'));
  compareEl.classList.remove('visible');
  outputImg.classList.add('visible');
  viewBottom.classList.add('visible');
}

function beginBusy() {
  showGenAnim();
  viewFrame.classList.add('busy');
  Object.values(views).forEach(img => img.classList.remove('visible'));
  compareEl.classList.remove('visible');
  resultPH.style.display='none';
  viewBottom.classList.remove('visible');
}

// Generate just the selected region, using its chosen colour / sticker.
generateBtn.addEventListener('click', async () => {
  const region = S.regions[S.selectedRegion];
  if (!region) { showToast('No region selected', 'error'); return; }
  if (!regionHasSelection(region.number)) {
    showToast(`Pick a colour or sticker for Region ${region.number} first (on the mask step)`, 'error');
    return;
  }
  setLoading(generateBtn, true); beginBusy();
  try {
    const out = await runEditMarkers([markerFor(region)], S.workingImage || S.originalImage);
    S.workingImage = out;
    showResult(out, `room_edit_r${region.number}.png`);
    refreshAnnotated();
    showToast(`✨ Region ${region.number} updated!`, 'success');
  } catch(e) { hideGenAnim(); showToast('Generation failed: '+e.message, 'error'); resultPH.style.display='flex'; }
  finally { setLoading(generateBtn,false); viewFrame.classList.remove('busy'); }
});

// Generate ALL regions that have a colour / sticker, in one edit.
generateAllBtn.addEventListener('click', async () => {
  const jobs = S.regions.filter(r => regionHasSelection(r.number));
  if (!jobs.length) { showToast('Pick a colour or sticker for at least one region (on the mask step)', 'error'); return; }
  setLoading(generateAllBtn, true); beginBusy();
  try {
    // One edit for all regions at once — fills each surface properly.
    const out = await runEditMarkers(jobs.map(markerFor), S.originalImage);
    S.workingImage = out;
    showResult(out, 'room_edit_all.png');
    refreshAnnotated();
    if (promptProgress) promptProgress.textContent = '';
    showToast(`✨ Updated ${jobs.length} region${jobs.length>1?'s':''}!`, 'success');
  } catch(e) {
    hideGenAnim();
    showToast('Generation failed: '+e.message, 'error');
    resultPH.style.display='flex';
    if (promptProgress) promptProgress.textContent = '';
  }
  finally { setLoading(generateAllBtn,false); viewFrame.classList.remove('busy'); }
});

$('back-to-editor').addEventListener('click', () => {
  setStage(2);
  // Poll until #canvas-container has painted and has real dimensions,
  // then position the canvas over the photo. A fixed timeout is unreliable
  // because the fadeUp animation + flex layout can take varying time.
  let attempts = 0;
  function trySync() {
    const cont = editorCanvas.parentElement;
    if (!cont) return;
    const cw = cont.clientWidth, ch = cont.clientHeight;
    if (cw > 0 && ch > 0) {
      editorCanvas.width  = S.imgW;
      editorCanvas.height = S.imgH;
      syncCanvasToImage();
      render();
    } else if (attempts++ < 30) {
      // Retry up to ~600ms (30 × 20ms)
      setTimeout(trySync, 20);
    }
  }
  setTimeout(trySync, 20);
});

$('edit-again-btn').addEventListener('click', () => {
  viewBottom.classList.remove('visible');
  Object.values(views).forEach(img => img.classList.remove('visible'));
  compareEl.classList.remove('visible');
  annotatedImg.classList.add('visible');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('[data-view="annotated"]').classList.add('active');
});
