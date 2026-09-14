"use strict";

const $ = id => document.getElementById(id);

function icon(name, className = "icon") {
  return `
    <svg class="${className}" aria-hidden="true">
      <use href="#icon-${name}"></use>
    </svg>
  `;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* ---------------------------------------------------------
   Intro controller

   Four typical 100px mouse-wheel ticks complete the sequence.
   Small trackpad deltas accumulate naturally.
--------------------------------------------------------- */

class RoomIntro {
  constructor() {
    this.frameCount = 120;
    this.wheelDistance = 400;
    this.swipeDistance = 360;

    this.stage = $("stage1");
    this.canvas = $("hero-canvas");
    this.context = this.canvas.getContext("2d");
    this.card = $("upload-card");

    this.frames = new Array(this.frameCount + 1);
    this.failed = new Set();
    this.settled = 0;

    this.progress = 0;
    this.target = 0;
    this.lastTime = 0;
    this.raf = 0;
    this.complete = false;
    this.lastDrawn = -1;
    this.touchPoints = new Map();

    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    this.bindEvents();
    this.resize();

    if (this.reducedMotion.matches) {
      this.progress = 1;
      this.target = 1;
      this.reveal();
    }

    this.preload();
  }

  get active() {
    return !this.stage.hidden;
  }

  bindEvents() {
    this.stage.addEventListener(
      "wheel",
      event => {
        if (!this.active || this.complete || event.ctrlKey || event.metaKey) {
          return;
        }

        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          return;
        }

        event.preventDefault();

        const multiplier =
          event.deltaMode === 1 ? 16 :
          event.deltaMode === 2 ? this.stage.clientHeight : 1;

        const delta = clamp(event.deltaY * multiplier, -120, 120);
        this.advance(delta / this.wheelDistance);
      },
      { passive: false }
    );

    this.stage.addEventListener("pointerdown", event => {
      if (
        event.pointerType !== "touch" ||
        this.complete ||
        event.target.closest("button, a, input")
      ) {
        return;
      }

      this.touchPoints.set(event.pointerId, event.clientY);
    });

    this.stage.addEventListener("pointermove", event => {
      if (
        this.complete ||
        !this.touchPoints.has(event.pointerId)
      ) {
        return;
      }

      const previousY = this.touchPoints.get(event.pointerId);
      this.touchPoints.set(event.pointerId, event.clientY);

      if (this.touchPoints.size !== 1) {
        return;
      }

      this.advance((previousY - event.clientY) / this.swipeDistance);
    });

    const endTouch = event => {
      this.touchPoints.delete(event.pointerId);
    };

    window.addEventListener("pointerup", endTouch);
    window.addEventListener("pointercancel", endTouch);

    document.addEventListener("keydown", event => {
      if (
        !this.active ||
        this.complete ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.target.closest(
          "button, a, input, select, textarea, [contenteditable='true']"
        )
      ) {
        return;
      }

      if (["ArrowDown", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        this.advance(.25);
      } else if (["ArrowUp", "PageUp"].includes(event.key)) {
        event.preventDefault();
        this.advance(-.25);
      } else if (event.key === "End") {
        event.preventDefault();
        this.skip();
      } else if (event.key === "Home") {
        event.preventDefault();
        this.target = 0;
        this.startAnimation();
      }
    });

    $("advance-intro").addEventListener("click", () => this.advance(.25));
    $("skip-intro").addEventListener("click", () => this.skip());
    $("replay-intro").addEventListener("click", () => this.replay());

    window.addEventListener("resize", () => this.resize());

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => this.resize());
    }

    this.reducedMotion.addEventListener("change", event => {
      if (event.matches && this.active) {
        this.skip();
      }
    });
  }

  advance(amount) {
    if (this.complete || !this.active) {
      return;
    }

    this.target = clamp(this.target + amount, 0, 1);

    if (this.reducedMotion.matches) {
      this.skip();
      return;
    }

    this.startAnimation();
  }

  startAnimation() {
    if (this.raf) {
      return;
    }

    this.lastTime = 0;
    this.raf = requestAnimationFrame(time => this.animate(time));
  }

  animate(time) {
    this.raf = 0;

    if (!this.active || this.complete) {
      return;
    }

    const elapsed = this.lastTime ? Math.min(time - this.lastTime, 50) : 16;
    this.lastTime = time;

    const difference = this.target - this.progress;

    // Limit travel speed so a fast wheel gesture still has a visible sequence.
    const step = Math.min(Math.abs(difference), elapsed / 1800);

    this.progress += Math.sign(difference) * step;

    if (Math.abs(this.target - this.progress) < .0001) {
      this.progress = this.target;
    }

    this.render();
    this.updateProgress();

    if (this.progress >= 1 && this.target >= 1) {
      this.finishWhenReady();
      return;
    }

    if (this.progress !== this.target) {
      this.raf = requestAnimationFrame(nextTime => this.animate(nextTime));
    }
  }

  updateProgress() {
    $("intro-progress-bar").style.transform = `scaleX(${this.progress})`;
  }

  async preload() {
    const remaining = Array.from(
      { length: this.frameCount - 2 },
      (_, index) => index + 2
    );

    // Load the opening and final frames first.
    const queue = [1, this.frameCount, ...remaining];
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length) {
        const frame = queue[cursor++];
        await this.loadFrame(frame);
      }
    };

    // Bound concurrent requests instead of starting 120 at once.
    await Promise.all(
      Array.from({ length: 6 }, () => worker())
    );
  }

  loadFrame(number) {
    return new Promise(resolve => {
      const image = new Image();
      image.decoding = "async";

      let finished = false;

      const finish = successful => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;

        if (successful) {
          this.frames[number] = image;
        } else {
          this.failed.add(number);
        }

        this.settled++;

        if (this.active) {
          this.render();
        }

        if (!this.complete) {
          $("intro-status").textContent =
            this.settled < this.frameCount
              ? `Preparing sequence ${Math.round(
                  this.settled / this.frameCount * 100
                )}%`
              : this.failed.size
                ? "Some frames unavailable. You can continue."
                : "Scroll, swipe or use the arrow keys";
        }

        if (this.progress >= 1 && !this.complete) {
          this.finishWhenReady();
        }

        resolve();
      };

      const timeout = setTimeout(() => finish(false), 12000);

      image.onload = () => finish(true);
      image.onerror = () => finish(false);

      image.src =
        `/static/gwr_frames/frame_${String(number).padStart(3, "0")}.webp`;
    });
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Limit pixel density for tablet memory and rendering cost.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.lastDrawn = -1;

    if (this.active) {
      this.render();
    }
  }

  render() {
    if (!this.context) {
      return;
    }

    const desired = Math.round(
      this.progress * (this.frameCount - 1)
    ) + 1;

    let number = desired;

    // Prefer the closest earlier loaded frame while loading.
    while (number > 0 && !this.frames[number]) {
      number--;
    }

    // Before frame 1 is ready, keep the CSS background instead of
    // displaying a later frame out of order.
    if (!number) {
      return;
    }

    if (number === this.lastDrawn) {
      return;
    }

    const image = this.frames[number];
    const width = this.canvas.width;
    const height = this.canvas.height;
    const scale = Math.max(
      width / image.naturalWidth,
      height / image.naturalHeight
    );

    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;

    this.context.clearRect(0, 0, width, height);
    this.context.drawImage(
      image,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight
    );

    this.lastDrawn = number;
  }

  finishWhenReady() {
    if (this.frames[this.frameCount] || this.failed.has(this.frameCount)) {
      this.render();
      this.reveal();
    } else {
      $("intro-status").textContent = "Preparing the final view…";
    }
  }

  reveal() {
    this.complete = true;
    this.touchPoints.clear();

    cancelAnimationFrame(this.raf);
    this.raf = 0;

    $("intro-copy").hidden = true;
    $("intro-controls").hidden = true;

    this.card.hidden = false;
    this.card.inert = false;

    requestAnimationFrame(() => {
      this.card.classList.add("visible");

      if (
        this.active &&
        !this.reducedMotion.matches &&
        (
          document.activeElement === document.body ||
          document.activeElement === $("skip-intro") ||
          document.activeElement === $("advance-intro")
        )
      ) {
        $("browse-btn").focus({ preventScroll: true });
      }
    });
  }

  skip() {
    this.progress = 1;
    this.target = 1;
    this.render();
    this.updateProgress();

    // Explicit skip must never be blocked by slow or missing frames.
    this.reveal();
  }

  replay() {
    this.complete = false;
    this.progress = 0;
    this.target = 0;
    this.lastDrawn = -1;

    this.card.classList.remove("visible");
    this.card.inert = true;
    this.card.hidden = true;

    $("intro-copy").hidden = false;
    $("intro-controls").hidden = false;
    $("intro-status").textContent = "Scroll, swipe or use the arrow keys";

    this.render();
    this.updateProgress();

    $("skip-intro").focus({ preventScroll: true });
  }
}

/* ---------------------------------------------------------
   Existing palettes and sticker catalog
--------------------------------------------------------- */

const PIN_COLORS = [
  "#FF6B6B", "#4ECDC4", "#FFE66D", "#A8E6CF", "#FF8B94",
  "#B4A8FF", "#FFA07A", "#00CED1", "#FF99CD", "#ADFF2F",
  "#FF956C", "#B79ADB", "#00FA9A", "#FF947F", "#74B7FF"
];

const FAMILIES = [
  { name: 'Whites', hue: 0, sMax: 10, vMin: 90, vMax: 100 },
  { name: 'Greys', hue: 0, sMax: 10, vMin: 15, vMax: 90 },
  { name: 'Black', hue: 0, sMax: 15, vMin: 0, vMax: 15 },
  { name: 'Beige & Cream', hue: 35 },
  { name: 'Brown', hue: 25 },
  { name: 'Red', hue: 0 },
  { name: 'Orange', hue: 30 },
  { name: 'Yellow', hue: 60 },
  { name: 'Green', hue: 120 },
  { name: 'Cyan & Teal', hue: 180 },
  { name: 'Blue', hue: 240 },
  { name: 'Purple', hue: 280 },
  { name: 'Pink', hue: 320 },
];

const WALL_STICKERS = [
  { name: "None", file: "", desc: "" },
  {
    name: "Blue Groovy Swirls",
    file: "w1.jpg",
    desc: "retro groovy swirling wave pattern in navy and blue tones"
  },
  {
    name: "Crimson Squiggle",
    file: "w2.jpg",
    desc: "organic crimson-red and cream squiggle/blob pattern"
  },
  {
    name: "Ocean Waves",
    file: "w3.jpg",
    desc: "flowing blue ocean wave line-art pattern"
  },
  {
    name: "Magenta Flow",
    file: "w4.jpg",
    desc: "abstract magenta-to-white flowing fluid art mural"
  },
  {
    name: "Purple Marble",
    file: "w5.jpg",
    desc: "purple and white liquid marble swirl pattern"
  },
  {
    name: "Green Leaves",
    file: "w6.jpg",
    desc: "lush green leaf botanical pattern on dark background"
  },
  {
    name: "Teal Blossoms",
    file: "w7.jpg",
    desc: "teal and cream blossom flowers with golden centres"
  },
  {
    name: "Peacock Feathers",
    file: "w8.jpg",
    desc: "vibrant peacock feather pattern in teal, green and gold"
  }
];

/* ---------------------------------------------------------
   Application state and helpers
--------------------------------------------------------- */

const state = {
  stage: 1,
  image: null,
  width: 0,
  height: 0,
  markers: [],
  regions: [],
  selected: 0,
  annotated: null,
  working: null,
  result: null,
  view: "annotated",
  uploading: false,
  confirming: false,
  generating: false,
  generationMode: null,
  annotationVersion: 0
};

const editorCanvas = $("editor-canvas");
const editorContext = editorCanvas.getContext("2d");

let toastTimer;
let intro;

function imageSource(base64) {
  return `data:image/png;base64,${base64}`;
}

function showToast(message, type = "info") {
  clearTimeout(toastTimer);

  $("toast").textContent = message;
  $("toast").className = `show ${type}`;

  toastTimer = setTimeout(() => {
    $("toast").className = "";
  }, 4500);
}

async function requestJSON(url, options = {}, timeoutMs = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        response.status === 413
          ? "The upload exceeds the server size limit."
          : "The server returned an unreadable response."
      );
    }

    if (!response.ok || data.error || data.success === false) {
      throw new Error(
        data.error || `The request failed (${response.status}).`
      );
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "The request timed out. The server may still be processing it."
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function postJSON(url, body) {
  return requestJSON(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function setButtonLoading(id, loading) {
  const spinner = $(id).querySelector(".spinner");

  if (spinner) {
    spinner.hidden = !loading;
  }
}

function updateControls() {
  $("browse-btn").disabled = state.uploading;
  $("file-input").disabled = state.uploading;
  $("back-to-upload").disabled = state.uploading;
  $("replay-intro").disabled = state.uploading;
  $("proceed-btn").disabled = state.uploading || !state.image;

  $("proceed-label").textContent =
    state.uploading ? "Uploading your room…" : "Continue to surfaces";

  setButtonLoading("proceed-btn", state.uploading);

  $("gen-mask-btn").disabled =
    state.confirming || state.markers.length === 0;

  $("back-to-upload2").disabled = state.confirming;
  $("undo-btn").disabled = state.confirming || !state.markers.length;
  $("clear-all-btn").disabled = state.confirming || !state.markers.length;
  $("poly-list").inert = state.confirming;

  setButtonLoading("gen-mask-btn", state.confirming);

  $("back-to-editor").disabled = state.generating;
  $("edit-again-btn").disabled = state.generating;

  $("generate-btn").disabled =
    state.generating || !state.regions.length;

  $("generate-all-btn").disabled =
    state.generating || !state.regions.length;

  document.querySelectorAll(".region-chip").forEach(button => {
    button.disabled = state.generating;
  });

  document.querySelectorAll(".tab-btn").forEach(button => {
    const requiresResult = ["result", "compare"].includes(
      button.dataset.view
    );

    button.disabled = state.generating || (requiresResult && !state.result);
  });

  setButtonLoading(
    "generate-btn",
    state.generating && state.generationMode === "selected"
  );

  setButtonLoading(
    "generate-all-btn",
    state.generating && state.generationMode === "all"
  );

  $("gen-anim-overlay").hidden = !state.generating;
  $("view-frame").setAttribute("aria-busy", String(state.generating));
  $("view-bottom").hidden = !state.result || state.generating;
}

function setStage(number) {
  state.stage = number;

  for (let index = 1; index <= 3; index++) {
    const active = index === number;

    $(`stage${index}`).hidden = !active;
    $(`stage${index}`).classList.toggle("active", active);

    const step = $(`step${index}`);

    step.classList.toggle("active", active);
    step.classList.toggle("done", index < number);

    if (active) {
      step.setAttribute("aria-current", "step");
    } else {
      step.removeAttribute("aria-current");
    }
  }

  requestAnimationFrame(() => {
    if (number === 1) {
      intro.resize();
    } else if (number === 2) {
      syncEditor();
      $("editor-title").focus({ preventScroll: true });
    } else {
      sizeCompare();
      $("design-title").focus({ preventScroll: true });
    }
  });

  updateControls();
}

/* ---------------------------------------------------------
   Upload
--------------------------------------------------------- */

$("browse-btn").addEventListener("click", () => {
  if (!state.uploading) {
    $("file-input").click();
  }
});

$("back-to-upload").addEventListener("click", () => {
  if (!state.uploading) {
    $("file-input").value = "";
    $("file-input").click();
  }
});

$("file-input").addEventListener("change", event => {
  const file = event.target.files[0];

  if (file) {
    uploadFile(file);
  }

  event.target.value = "";
});

$("drop-zone").addEventListener("dragover", event => {
  event.preventDefault();

  if (!state.uploading) {
    $("drop-zone").classList.add("dragover");
  }
});

$("drop-zone").addEventListener("dragleave", event => {
  if (!$("drop-zone").contains(event.relatedTarget)) {
    $("drop-zone").classList.remove("dragover");
  }
});

$("drop-zone").addEventListener("drop", event => {
  event.preventDefault();
  $("drop-zone").classList.remove("dragover");

  const file = event.dataTransfer.files[0];

  if (file && !state.uploading) {
    uploadFile(file);
  }
});

// Prevent dropped files outside the drop zone from replacing the page.
window.addEventListener("dragover", event => {
  if (Array.from(event.dataTransfer?.types || []).includes("Files")) {
    event.preventDefault();
  }
});

window.addEventListener("drop", event => {
  if (Array.from(event.dataTransfer?.types || []).includes("Files")) {
    event.preventDefault();
  }
});

async function uploadFile(file) {
  if (state.uploading) {
    return;
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  const allowedExtension = /\.(jpe?g|png|webp)$/i.test(file.name);

  if (
    (file.type && !allowedTypes.includes(file.type)) ||
    (!file.type && !allowedExtension)
  ) {
    showToast("Please choose a JPG, PNG or WEBP image.", "error");
    return;
  }

  // Leave room for multipart overhead within Flask's 20 MiB request limit.
  const maximumFileSize = 20 * 1024 * 1024 - 64 * 1024;

  if (file.size > maximumFileSize) {
    showToast("Choose an image smaller than 20 MB.", "error");
    return;
  }

  state.uploading = true;
  $("upload-actions").hidden = false;
  updateControls();

  const formData = new FormData();
  formData.append("image", file);

  try {
    const data = await requestJSON(
      "/upload",
      { method: "POST", body: formData },
      90000
    );

    if (
      typeof data.image !== "string" ||
      !Number.isFinite(data.width) ||
      !Number.isFinite(data.height) ||
      data.width <= 0 ||
      data.height <= 0
    ) {
      throw new Error("The server did not return a valid room image.");
    }

    state.image = data.image;
    state.width = data.width;
    state.height = data.height;
    state.markers = [];
    state.regions = [];
    state.selected = 0;
    state.annotated = null;
    state.working = data.image;
    state.result = null;
    state.annotationVersion++;

    $("preview-img").src = imageSource(data.image);
    $("preview-wrap").hidden = false;
    $("drop-zone").hidden = true;

    showToast("Your room is ready. Continue to select surfaces.");
  } catch (error) {
    showToast(`Upload failed: ${error.message}`, "error");
  } finally {
    state.uploading = false;
    $("upload-actions").hidden = !state.image;
    updateControls();
  }
}

$("proceed-btn").addEventListener("click", () => {
  if (!state.image || state.uploading) {
    return;
  }

  $("editor-img").src = imageSource(state.image);

  editorCanvas.width = state.width;
  editorCanvas.height = state.height;

  renderMarkerList();
  setStage(2);
});

$("back-to-upload2").addEventListener("click", () => {
  if (!state.confirming) {
    setStage(1);
  }
});

/* ---------------------------------------------------------
   Surface pins and palette selection
--------------------------------------------------------- */

function syncEditor() {
  if (!state.image || state.stage !== 2) {
    return;
  }

  const container = $("canvas-container");
  const width = container.clientWidth;
  const height = container.clientHeight;

  if (!width || !height) {
    return;
  }

  const scale = Math.min(
    width / state.width,
    height / state.height
  );

  const displayWidth = state.width * scale;
  const displayHeight = state.height * scale;

  editorCanvas.style.left = `${(width - displayWidth) / 2}px`;
  editorCanvas.style.top = `${(height - displayHeight) / 2}px`;
  editorCanvas.style.width = `${displayWidth}px`;
  editorCanvas.style.height = `${displayHeight}px`;

  drawPins();
}

function drawPins() {
  editorContext.clearRect(
    0,
    0,
    editorCanvas.width,
    editorCanvas.height
  );

  const displayedWidth = editorCanvas.getBoundingClientRect().width;
  const ratio = displayedWidth ? state.width / displayedWidth : 1;

  // Keep pins approximately 14 CSS pixels in radius.
  const radius = Math.max(10, 14 * ratio);

  state.markers.forEach(marker => {
    editorContext.save();

    editorContext.shadowColor = "rgba(0,0,0,.4)";
    editorContext.shadowBlur = 5 * ratio;
    editorContext.shadowOffsetY = 2 * ratio;

    editorContext.beginPath();
    editorContext.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
    editorContext.fillStyle = marker.color;
    editorContext.fill();

    editorContext.shadowColor = "transparent";
    editorContext.strokeStyle = "#fff";
    editorContext.lineWidth = 2 * ratio;
    editorContext.stroke();

    editorContext.font = `700 ${12 * ratio}px Inter, sans-serif`;
    editorContext.textAlign = "center";
    editorContext.textBaseline = "middle";
    editorContext.fillStyle = "#111";
    editorContext.fillText(String(marker.number), marker.x, marker.y);

    editorContext.restore();
  });
}

editorCanvas.addEventListener("click", event => {
  if (!state.image || state.confirming) {
    return;
  }

  const bounds = editorCanvas.getBoundingClientRect();

  if (!bounds.width || !bounds.height) {
    return;
  }

  state.markers.push({
    number: state.markers.length + 1,
    x: clamp(
      (event.clientX - bounds.left) * state.width / bounds.width,
      0,
      state.width - 1
    ),
    y: clamp(
      (event.clientY - bounds.top) * state.height / bounds.height,
      0,
      state.height - 1
    ),
    color: PIN_COLORS[state.markers.length % PIN_COLORS.length],
    surface: "wall",
    fill: null,
    sticker: null
  });

  renderMarkerList();
  drawPins();
});

editorCanvas.addEventListener("contextmenu", event => {
  event.preventDefault();
  removeLastMarker();
});

function renumberMarkers() {
  state.markers.forEach((marker, index) => {
    marker.number = index + 1;
  });
}

function removeLastMarker() {
  if (state.confirming || !state.markers.length) {
    return;
  }

  state.markers.pop();
  renumberMarkers();
  renderMarkerList();
  drawPins();
}

$("undo-btn").addEventListener("click", removeLastMarker);

$("clear-all-btn").addEventListener("click", () => {
  if (state.confirming) {
    return;
  }

  state.markers = [];
  renderMarkerList();
  drawPins();
});

function renderMarkerList() {
  const list = $("poly-list");
  const scrollTop = list.scrollTop;

  $("marker-count").textContent =
    `${state.markers.length} surface${state.markers.length === 1 ? "" : "s"}`;

  if (!state.markers.length) {
    list.innerHTML = `
      <p class="empty-state">
        Tap a wall, floor or ceiling in your room photo to add a numbered pin.
        Then choose its colour or wall design here.
      </p>
    `;

    updateControls();
    return;
  }

  list.innerHTML = state.markers.map((marker, index) => {
    const surfaces = ["wall", "floor", "ceiling"].map(surface => `
      <button
        class="surface-option ${marker.surface === surface ? "active" : ""}"
        type="button"
        data-action="surface"
        data-index="${index}"
        data-value="${surface}"
        aria-pressed="${marker.surface === surface}"
      >${surface[0].toUpperCase() + surface.slice(1)}</button>
    `).join("");

    const stickers = WALL_STICKERS.map((sticker, stickerIndex) => {
      const selected = sticker.file
        ? marker.sticker?.file === sticker.file
        : !marker.sticker;

      return `
        <button
          class="sticker-option ${selected ? "selected" : ""}"
          type="button"
          data-action="sticker"
          data-index="${index}"
          data-value="${stickerIndex}"
          aria-pressed="${selected}"
        >
          ${
            sticker.file
              ? `<img
                  src="/wallstickers/${sticker.file}"
                  alt=""
                  loading="lazy"
                >`
              : ""
          }
          <span>${escapeHTML(sticker.name)}</span>
        </button>
      `;
    }).join("");

    const selection = marker.fill?.name ||
      marker.sticker?.name ||
      "No finish selected";

    return `
      <article class="region-row">
        <div class="region-head">
          <span class="region-pin" style="background:${marker.color}">
            ${marker.number}
          </span>
          <span class="region-title">Surface ${marker.number}</span>
          <button
            class="delete-region"
            type="button"
            data-action="delete"
            data-index="${index}"
            aria-label="Delete surface ${marker.number}"
          >${icon("trash")}</button>
        </div>

        <div class="surface-select" role="group" aria-label="Surface type">
          ${surfaces}
        </div>

        <div class="region-options" style="padding-top: 12px;">
          <button type="button" class="btn btn-outline btn-block" data-action="open-picker" data-index="${index}">
            <span class="palette-swatch" style="background:${marker.fill ? marker.fill.hex : 'transparent'}; width:18px; height:18px; margin:0 8px 0 0; display:inline-block; border-color:var(--border-strong);"></span>
            ${marker.fill ? escapeHTML(marker.fill.name) : 'Choose a colour'}
          </button>
        </div>

        <details class="region-options">
          <summary>Or choose a wall design</summary>
          <div class="sticker-grid">${stickers}</div>
        </details>

        <p class="selection-note">${escapeHTML(selection)}</p>
      </article>
    `;
  }).join("");

  list.scrollTop = scrollTop;
  updateControls();
}

// Missing artwork should not display broken-image icons.
$("poly-list").addEventListener(
  "error",
  event => {
    if (event.target instanceof HTMLImageElement) {
      event.target.hidden = true;
    }
  },
  true
);

$("poly-list").addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");

  if (!button || state.confirming) {
    return;
  }

  const index = Number(button.dataset.index);
  const marker = state.markers[index];

  if (!marker) {
    return;
  }

  const action = button.dataset.action;

  if (action === "delete") {
    state.markers.splice(index, 1);
    renumberMarkers();
  } else if (action === "surface") {
    marker.surface = button.dataset.value;
  } else if (action === "open-picker") {
    openColorPicker(index);
  } else if (action === "sticker") {
    const sticker = WALL_STICKERS[Number(button.dataset.value)];
    marker.sticker = sticker.file ? { ...sticker } : null;

    if (marker.sticker) {
      marker.fill = null;
    }
  }

  renderMarkerList();
  drawPins();
});

/* ---------------------------------------------------------
   Confirm surfaces
--------------------------------------------------------- */

function markerPayload(marker) {
  return {
    number: marker.number,
    x: Math.round(marker.x),
    y: Math.round(marker.y),
    color: marker.color
  };
}

$("gen-mask-btn").addEventListener("click", async () => {
  if (state.confirming || !state.markers.length) {
    return;
  }

  state.confirming = true;
  updateControls();

  try {
    const data = await postJSON("/generate-mask", {
      image: state.image,
      markers: state.markers.map(markerPayload)
    });

    if (typeof data.annotated_image !== "string") {
      throw new Error("No surface preview was returned.");
    }

    state.regions = state.markers.map(marker => ({
      ...marker,
      fill: marker.fill ? { ...marker.fill } : null,
      sticker: marker.sticker ? { ...marker.sticker } : null
    }));

    state.selected = 0;
    state.annotated = data.annotated_image;
    state.working = state.image;
    state.result = null;
    state.annotationVersion++;

    $("annotated-img").src = imageSource(state.annotated);
    $("original-img").src = imageSource(state.image);
    $("output-img").removeAttribute("src");
    $("download-btn").removeAttribute("href");
    $("prompt-progress").textContent = "";

    renderRegionChips();
    showView("annotated");
    setStage(3);
  } catch (error) {
    showToast(`Could not prepare surfaces: ${error.message}`, "error");
  } finally {
    state.confirming = false;
    updateControls();
  }
});

$("back-to-editor").addEventListener("click", () => {
  if (!state.generating) {
    setStage(2);
  }
});

/* ---------------------------------------------------------
   Region chips and generation
--------------------------------------------------------- */

function hasSelection(region) {
  return Boolean(region.fill || region.sticker);
}

function renderRegionChips() {
  $("region-count").textContent =
    `${state.regions.length} surface${
      state.regions.length === 1 ? "" : "s"
    } ready to review`;

  $("region-chips").innerHTML = state.regions.map((region, index) => `
    <button
      class="region-chip ${index === state.selected ? "active" : ""}"
      type="button"
      data-region="${index}"
      aria-pressed="${index === state.selected}"
    >
      <span class="region-chip-dot" style="background:${region.color}"></span>
      Surface ${region.number}
    </button>
  `).join("");

  const region = state.regions[state.selected];

  $("selection-summary").textContent = region
    ? `Surface ${region.number} · ${region.surface} · ${
        region.fill?.name || region.sticker?.name ||
        "Return to the editor to choose a finish"
      }`
    : "Select a surface to continue.";

  updateControls();
}

$("region-chips").addEventListener("click", event => {
  const button = event.target.closest("[data-region]");

  if (!button || state.generating) {
    return;
  }

  state.selected = Number(button.dataset.region);
  renderRegionChips();
});

function buildSelectionMaps() {
  const colours = {};
  const stickers = {};
  const surfaces = {};

  state.regions.forEach(region => {
    surfaces[region.number] = region.surface;

    if (region.fill) {
      colours[region.number] = region.fill;
    }

    if (region.sticker) {
      stickers[region.number] = region.sticker;
    }
  });

  return { colours, stickers, surfaces };
}

async function generate(mode) {
  if (state.generating) {
    return;
  }

  const selected = state.regions[state.selected];

  const regions = mode === "all"
    ? state.regions.filter(hasSelection)
    : selected && hasSelection(selected)
      ? [selected]
      : [];

  if (!regions.length) {
    showToast(
      "Choose a colour or wall design on the surfaces step first.",
      "error"
    );
    return;
  }

  const maps = buildSelectionMaps();

  state.generating = true;
  state.generationMode = mode;

  $("prompt-progress").textContent = "Generating your design…";
  updateControls();

  try {
    const data = await postJSON("/edit", {
      original_image: state.image,

      // Preserve the repository's behavior:
      // individual edits accumulate; Generate All starts from the original.
      base_image: mode === "all"
        ? state.image
        : state.working || state.image,

      markers: regions.map(markerPayload),
      region_colors: maps.colours,
      region_stickers: maps.stickers,
      region_surfaces: maps.surfaces,
      prompt: "",
      reference_image: null
    });

    if (typeof data.output_image !== "string") {
      throw new Error("No generated image was returned.");
    }

    state.result = data.output_image;
    state.working = data.output_image;

    const source = imageSource(data.output_image);

    $("output-img").src = source;
    $("cmp-after").src = source;
    $("cmp-before").src = imageSource(state.image);

    $("download-btn").href = source;
    $("download-btn").download = mode === "all"
      ? "room_edit_all.png"
      : `room_edit_r${selected.number}.png`;

    $("cmp-range").value = "50";
    updateCompare(50);

    showView("result");
    refreshAnnotated();

    $("prompt-progress").textContent = "Your design is ready.";
    showToast("Your room design is ready to review.");
  } catch (error) {
    $("prompt-progress").textContent = "Generation could not be completed.";
    showToast(`Generation failed: ${error.message}`, "error");
  } finally {
    state.generating = false;
    state.generationMode = null;
    updateControls();
  }
}

$("generate-btn").addEventListener("click", () => generate("selected"));
$("generate-all-btn").addEventListener("click", () => generate("all"));

async function refreshAnnotated() {
  const version = ++state.annotationVersion;

  try {
    const data = await postJSON("/generate-mask", {
      image: state.working,
      markers: state.regions.map(markerPayload)
    });

    if (
      version === state.annotationVersion &&
      typeof data.annotated_image === "string"
    ) {
      state.annotated = data.annotated_image;
      $("annotated-img").src = imageSource(data.annotated);
    }
  } catch {
    // Keep the existing annotated preview when refreshing it fails.
  }
}

/* ---------------------------------------------------------
   Preview modes and before/after comparison
--------------------------------------------------------- */

function showView(view) {
  if (["result", "compare"].includes(view) && !state.result) {
    return;
  }

  state.view = view;

  $("annotated-img").hidden = view !== "annotated";
  $("original-img").hidden = view !== "original";
  $("output-img").hidden = view !== "result";
  $("compare").hidden = view !== "compare";

  document.querySelectorAll(".tab-btn").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (view === "compare") {
    requestAnimationFrame(sizeCompare);
  }
}

document.querySelectorAll(".tab-btn").forEach(button => {
  button.addEventListener("click", () => {
    if (!button.disabled && !state.generating) {
      showView(button.dataset.view);
    }
  });
});

$("edit-again-btn").addEventListener("click", () => {
  if (!state.generating) {
    showView("annotated");
  }
});

function updateCompare(value) {
  const percentage = clamp(Number(value), 0, 100);

  $("cmp-before").style.clipPath =
    `inset(0 ${100 - percentage}% 0 0)`;

  $("cmp-divider").style.left = `${percentage}%`;
}

$("cmp-range").addEventListener("input", event => {
  updateCompare(event.target.value);
});

function sizeCompare() {
  if (!state.width || !state.height || state.stage !== 3) {
    return;
  }

  const frame = $("view-frame");
  const scale = Math.min(
    frame.clientWidth / state.width,
    frame.clientHeight / state.height
  );

  if (!Number.isFinite(scale) || scale <= 0) {
    return;
  }

  $("compare").style.width = `${state.width * scale}px`;
  $("compare").style.height = `${state.height * scale}px`;
}

/* ---------------------------------------------------------
   Startup and responsive canvas sizing
--------------------------------------------------------- */

$("editor-img").addEventListener("load", syncEditor);

window.addEventListener("resize", () => {
  syncEditor();
  sizeCompare();
});

if ("ResizeObserver" in window) {
  const observer = new ResizeObserver(() => {
    syncEditor();
    sizeCompare();
  });

  observer.observe($("canvas-container"));
  observer.observe($("view-frame"));
}

intro = new RoomIntro();

renderMarkerList();
updateControls();

/* ---------------------------------------------------------
   Color Picker UI Logic
--------------------------------------------------------- */

const cp = {
  activeMarker: null,
  h: 0, s: 100, v: 100,
  draftHex: "#FFFFFF",
  family: "Whites",
  recent: [],
  isDragging: false,
  raf: null
};

let pickerResizeObserver;

function openColorPicker(index) {
  cp.activeMarker = index;
  const marker = state.markers[index];
  
  document.querySelectorAll('details.region-options').forEach((det, i) => {
    if (i !== index) det.removeAttribute('open');
  });

  if (marker.fill) {
    let hex = marker.fill.hex;
    let hsv = hexToHsv(hex);
    if (hsv) {
      cp.h = hsv[0]; cp.s = hsv[1]; cp.v = hsv[2];
      cp.family = marker.fill.name;
    }
  } else {
    selectFamily('Whites');
  }
  
  $('color-picker-popover').hidden = false;
  
  if (!pickerResizeObserver) {
    pickerResizeObserver = new ResizeObserver(() => resizePalette());
    pickerResizeObserver.observe($('cp-palette-wrap'));
  }
  
  loadRecent();
  renderFamilies();
  resizePalette();
  updateUIForCurrentHSV();
}

function closeColorPicker() {
  $('color-picker-popover').hidden = true;
  cp.activeMarker = null;
}

$('cp-close-btn').addEventListener('click', closeColorPicker);
$('cp-cancel').addEventListener('click', closeColorPicker);
$('cp-apply').addEventListener('click', () => {
  if (cp.activeMarker !== null) {
    const marker = state.markers[cp.activeMarker];
    marker.fill = { name: cp.family, hex: cp.draftHex };
    marker.sticker = null;
    saveRecent(cp.draftHex);
    renderMarkerList();
    drawPins();
  }
  closeColorPicker();
});

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('color-picker-popover').hidden) {
    closeColorPicker();
  }
});

$('cp-palette-wrap').addEventListener('keydown', e => {
  if ($('color-picker-popover').hidden || document.activeElement.tagName === 'INPUT') return;
  
  let step = e.shiftKey ? 10 : 1;
  let changed = false;
  
  if (e.key === 'ArrowUp') { cp.v = clamp(cp.v + step, 0, 100); changed = true; }
  else if (e.key === 'ArrowDown') { cp.v = clamp(cp.v - step, 0, 100); changed = true; }
  else if (e.key === 'ArrowLeft') { cp.s = clamp(cp.s - step, 0, 100); changed = true; }
  else if (e.key === 'ArrowRight') { cp.s = clamp(cp.s + step, 0, 100); changed = true; }
  
  if (changed) {
    e.preventDefault();
    let limits = getPaletteLimits();
    cp.s = clamp(cp.s, 0, limits.sMax);
    cp.v = clamp(cp.v, limits.vMin, limits.vMax);
    updateUIForCurrentHSV();
  }
});

const cpWrap = $('cp-palette-wrap');

cpWrap.addEventListener('pointerdown', e => {
  cp.isDragging = true;
  cpWrap.setPointerCapture(e.pointerId);
  handlePaletteMove(e);
});

cpWrap.addEventListener('pointermove', e => {
  if (cp.isDragging) {
    if (!cp.raf) {
      cp.raf = requestAnimationFrame(() => {
        handlePaletteMove(e);
        cp.raf = null;
      });
    }
  }
});

cpWrap.addEventListener('pointerup', e => {
  cp.isDragging = false;
  cpWrap.releasePointerCapture(e.pointerId);
});

cpWrap.addEventListener('pointercancel', e => {
  cp.isDragging = false;
});

$('cp-hue').addEventListener('input', e => {
  handleHueChange(parseInt(e.target.value, 10));
});

$('cp-hex').addEventListener('input', e => {
  let val = e.target.value;
  let hex = normalizeHex(val);
  if (hex) {
    e.target.style.borderColor = '';
    let hsv = hexToHsv(hex);
    if (hsv) {
      cp.draftHex = hex;
      cp.h = hsv[0];
      cp.s = hsv[1];
      cp.v = hsv[2];
      updateUIForCurrentHSV(hex);
    }
  } else {
    e.target.style.borderColor = 'var(--danger)';
  }
});

function handlePaletteMove(e) {
  const rect = cpWrap.getBoundingClientRect();
  let x = clamp(e.clientX - rect.left, 0, rect.width);
  let y = clamp(e.clientY - rect.top, 0, rect.height);
  
  let limits = getPaletteLimits();
  cp.s = (x / rect.width) * limits.sMax;
  cp.v = limits.vMax - (y / rect.height) * (limits.vMax - limits.vMin);
  
  updateUIForCurrentHSV();
}

function handleHueChange(newH) {
  cp.h = newH;
  let closest = FAMILIES.filter(f => f.sMax === undefined).reduce((prev, curr) => {
    let dPrev = Math.min(Math.abs(prev.hue - newH), 360 - Math.abs(prev.hue - newH));
    let dCurr = Math.min(Math.abs(curr.hue - newH), 360 - Math.abs(curr.hue - newH));
    return dCurr < dPrev ? curr : prev;
  });
  
  cp.family = closest.name;
  renderFamilies();
  drawPalette();
  updateUIForCurrentHSV();
}

function selectFamily(famName) {
  let fam = FAMILIES.find(f => f.name === famName);
  cp.family = fam.name;
  cp.h = fam.hue;
  
  if (fam.sMax !== undefined) {
     cp.s = Math.min(cp.s, fam.sMax);
     cp.v = clamp(cp.v, fam.vMin, fam.vMax);
  }
  renderFamilies();
  drawPalette();
  updateUIForCurrentHSV();
}

function updateUIForCurrentHSV(exactHex = null) {
  let hex = exactHex || hsvToHex(cp.h, cp.s, cp.v);
  if (!exactHex) {
    cp.draftHex = hex;
  }
  
  let hsl = hsvToHsl(cp.h, cp.s, cp.v);
  $('cp-h').textContent = hsl[0];
  $('cp-s').textContent = hsl[1] + '%';
  $('cp-l').textContent = hsl[2] + '%';
  
  $('cp-swatch').style.background = hex;
  if (!exactHex) {
    $('cp-hex').value = hex;
    $('cp-hex').style.borderColor = '';
  }
  
  $('cp-family-name').textContent = cp.family;
  $('cp-hue').value = cp.h;
  
  updateCursor();
}

function updateCursor() {
  const wrap = $('cp-palette-wrap');
  let limits = getPaletteLimits();
  
  let sMax = limits.sMax || 1;
  let vRange = (limits.vMax - limits.vMin) || 1;
  
  let x = (cp.s / sMax) * wrap.clientWidth;
  let y = (1 - (cp.v - limits.vMin) / vRange) * wrap.clientHeight;
  
  const cursor = $('cp-cursor');
  cursor.style.left = `${x}px`;
  cursor.style.top = `${y}px`;
  
  cursor.style.borderColor = (cp.v > 50 && cp.s < 50) ? '#000' : '#fff';
}

function getPaletteLimits() {
  let fam = FAMILIES.find(f => f.name === cp.family);
  if (fam && fam.sMax !== undefined) {
    return { sMax: fam.sMax, vMin: fam.vMin, vMax: fam.vMax };
  }
  return { sMax: 100, vMin: 0, vMax: 100 };
}

function drawPalette() {
  const canvas = $('cp-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  
  let limits = getPaletteLimits();
  
  ctx.clearRect(0, 0, w, h);
  
  if (w === 0 || h === 0) return;
  const imgData = ctx.createImageData(w, h);
  const data = imgData.data;
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = (x / (w - 1)) * limits.sMax;
      let v = limits.vMax - (y / (h - 1)) * (limits.vMax - limits.vMin);
      
      let hex = hsvToHex(cp.h, s, v);
      let i = (y * w + x) * 4;
      data[i]   = parseInt(hex.substr(1,2), 16);
      data[i+1] = parseInt(hex.substr(3,2), 16);
      data[i+2] = parseInt(hex.substr(5,2), 16);
      data[i+3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function resizePalette() {
  const canvas = $('cp-canvas');
  const wrap = $('cp-palette-wrap');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w === 0 || h === 0) return;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    drawPalette();
    updateCursor();
  }
}

function renderFamilies() {
  const container = $('cp-families');
  container.innerHTML = FAMILIES.map(f => {
    let active = f.name === cp.family ? ' active' : '';
    return `<button type="button" class="cp-family-btn${active}" data-fam="${f.name}">${f.name}</button>`;
  }).join('');
}

$('cp-families').addEventListener('click', e => {
  if (e.target.tagName === 'BUTTON') {
    selectFamily(e.target.dataset.fam);
  }
});

function loadRecent() {
  try {
    let stored = JSON.parse(localStorage.getItem('interior_recent_colors') || '[]');
    cp.recent = stored.map(normalizeHex).filter(x => x).slice(0, 8);
  } catch(e) {
    cp.recent = [];
  }
  renderRecent();
}

function saveRecent(hex) {
  cp.recent = [hex, ...cp.recent.filter(h => h !== hex)].slice(0, 8);
  localStorage.setItem('interior_recent_colors', JSON.stringify(cp.recent));
  renderRecent();
}

function renderRecent() {
  const container = $('cp-recent');
  container.innerHTML = cp.recent.map(hex => 
    `<div class="cp-recent-swatch" style="background:${hex}" data-hex="${hex}"></div>`
  ).join('');
}

$('cp-recent').addEventListener('click', e => {
  if (e.target.classList.contains('cp-recent-swatch')) {
    let hex = e.target.dataset.hex;
    let hsv = hexToHsv(hex);
    if (hsv) {
      cp.draftHex = hex;
      cp.h = hsv[0]; cp.s = hsv[1]; cp.v = hsv[2];
      handleHueChange(cp.h);
      updateUIForCurrentHSV(hex);
    }
  }
});

/* Maths & Conversion Helpers */

function hsvToHex(h, s, v) {
  s /= 100; v /= 100;
  let f = (n, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  let r = Math.round(f(5) * 255).toString(16).padStart(2, '0');
  let g = Math.round(f(3) * 255).toString(16).padStart(2, '0');
  let b = Math.round(f(1) * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

function hsvToHsl(h, s, v) {
  s /= 100; v /= 100;
  let l = v * (1 - s / 2);
  let sl = (l === 0 || l === 1) ? 0 : (v - l) / Math.min(l, 1 - l);
  return [Math.round(h), Math.round(sl * 100), Math.round(l * 100)];
}

function hexToHsv(hex) {
  hex = normalizeHex(hex);
  if (!hex) return null;
  let r = parseInt(hex.substring(1, 3), 16) / 255;
  let g = parseInt(hex.substring(3, 5), 16) / 255;
  let b = parseInt(hex.substring(5, 7), 16) / 255;
  
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, v = max;
  
  let d = max - min;
  s = max === 0 ? 0 : d / max;
  
  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(v * 100)];
}

function normalizeHex(hex) {
  if (typeof hex !== 'string') return null;
  hex = hex.trim().toUpperCase();
  if (hex.startsWith('#')) hex = hex.substring(1);
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  if (hex.length === 6 && /^[0-9A-F]{6}$/i.test(hex)) {
    return '#' + hex;
  }
  return null;
}