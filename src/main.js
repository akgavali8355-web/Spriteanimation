import './style.css';

// ─── Config ──────────────────────────────────────────────────────────────────
const FRAME_COUNT    = 180;  // Total frames
const PX_PER_FRAME   = 40;   // Scroll pixels per frame  → 180×40 = 7200px animation zone
const LERP_EASE      = 0.10; // Base lerp factor (refined by delta-time)

// ─── DOM ─────────────────────────────────────────────────────────────────────
const loader          = document.getElementById('loader');
const loaderPct       = document.getElementById('loader-pct');
const progressBar     = document.getElementById('progress-bar');
const canvas          = document.getElementById('canvas');
const grainCanvas     = document.getElementById('grain-canvas');
const vignette        = document.getElementById('vignette');
const scrollSpacer    = document.getElementById('scroll-spacer');
const productSections = document.getElementById('product-sections');
const siteNav         = document.getElementById('site-nav');
const heroOverlay      = document.getElementById('hero-overlay');
const scrollCue        = document.getElementById('scroll-cue');
const mobileMenuBtn    = document.getElementById('mobile-menu-btn');
const mobileMenu       = document.getElementById('mobile-menu');

// ─── Canvas Contexts ──────────────────────────────────────────────────────────
// Main canvas — high quality rendering
const ctx = canvas.getContext('2d', {
  alpha: false,             // Opaque = faster composite
  desynchronized: true,     // Reduce latency
  powerPreference: 'high-performance',
});

// Grain canvas
const gCtx = grainCanvas.getContext('2d', { alpha: true });

// ─── State ───────────────────────────────────────────────────────────────────
const images     = new Array(FRAME_COUNT);
let loadedCount  = 0;
let targetFrame  = 0;
let currentFrame = 0;
let lastTimestamp = 0;

// ─── Utility ─────────────────────────────────────────────────────────────────
function pad(n, size = 3) {
  return String(n).padStart(size, '0');
}

// Time-based lerp — frame-rate independent smoothing
function lerpDelta(a, b, factor, dt) {
  // Convert per-frame factor to per-millisecond: smooth regardless of FPS
  const t = 1 - Math.pow(1 - factor, dt / 16.67);
  return a + (b - a) * t;
}

// ─── Canvas Resize ───────────────────────────────────────────────────────────
let dpr = 1;

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2× for perf
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width  = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';

  grainCanvas.width  = Math.floor(w * dpr);
  grainCanvas.height = Math.floor(h * dpr);
  grainCanvas.style.width  = w + 'px';
  grainCanvas.style.height = h + 'px';

  // Keep image smoothing quality high after resize
  ctx.imageSmoothingEnabled  = true;
  ctx.imageSmoothingQuality  = 'high';

  drawFrame(Math.round(currentFrame));
}

// ─── Draw Frame — Cover-fit + High Quality ───────────────────────────────────
function drawFrame(index) {
  const clampedIdx = Math.max(0, Math.min(FRAME_COUNT - 1, index));
  const img = images[clampedIdx];
  if (!img || !img.complete || img.naturalWidth === 0) return;

  const cw = canvas.width;
  const ch = canvas.height;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  const imgRatio    = iw / ih;
  const canvasRatio = cw / ch;

  let sw, sh, sx, sy;
  if (canvasRatio > imgRatio) {
    sw = cw;
    sh = Math.round(cw / imgRatio);
    sx = 0;
    sy = Math.round((ch - sh) / 2);
  } else {
    sw = Math.round(ch * imgRatio);
    sh = ch;
    sx = Math.round((cw - sw) / 2);
    sy = 0;
  }

  ctx.clearRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh);
}

// ─── Film Grain ───────────────────────────────────────────────────────────────
// Pre-allocate a single ImageData for efficiency
let grainImageData = null;
let grainFrameTick = 0;
const GRAIN_REFRESH_FRAMES = 2; // Refresh grain every N animation frames for perf

function generateGrain() {
  const w = grainCanvas.width;
  const h = grainCanvas.height;

  if (!grainImageData || grainImageData.width !== w || grainImageData.height !== h) {
    grainImageData = gCtx.createImageData(w, h);
  }

  const data   = grainImageData.data;
  const len    = data.length;

  for (let i = 0; i < len; i += 4) {
    // Random noise value — white noise grain
    const v = (Math.random() * 255) | 0;
    data[i]     = v;   // R
    data[i + 1] = v;   // G
    data[i + 2] = v;   // B
    data[i + 3] = 255; // A fully opaque — CSS opacity controls final visibility
  }

  gCtx.putImageData(grainImageData, 0, 0);
}

// ─── Preloader ───────────────────────────────────────────────────────────────
function preload() {
  return new Promise((resolve) => {
    let firstFrameDrawn = false;

    for (let i = 1; i <= FRAME_COUNT; i++) {
      const idx = i - 1;
      const img = new Image();

      img.decode().catch(() => {}); // Warm up browser image decoder

      img.onload = () => {
        // Draw frame 1 instantly as background during load
        if (idx === 0 && !firstFrameDrawn) {
          firstFrameDrawn = true;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          drawFrame(0);
        }

        loadedCount++;
        const pct = Math.round((loadedCount / FRAME_COUNT) * 100);
        if (loaderPct) loaderPct.textContent = pct + '%';

        if (loadedCount === FRAME_COUNT) {
          setTimeout(() => {
            if (loader) loader.classList.add('hidden');
            resolve();
          }, 600);
        }
      };

      img.onerror = () => {
        loadedCount++;
        if (loadedCount === FRAME_COUNT) {
          if (loader) loader.classList.add('hidden');
          resolve();
        }
      };

      img.src = `/frames/ezgif-frame-${pad(i)}.jpg`;
      images[idx] = img;
    }
  });
}

// ─── Scroll Handler ──────────────────────────────────────────────────────────
function onScroll() {
  const scrollTop    = window.scrollY;
  // Animation zone = height of the scroll-spacer only
  const animZone     = scrollSpacer ? scrollSpacer.offsetHeight : FRAME_COUNT * PX_PER_FRAME;
  // Clamp 0..1 within the spacer region
  const frac         = Math.min(Math.max(scrollTop / animZone, 0), 1);

  targetFrame = frac * (FRAME_COUNT - 1);

  // Progress bar tracks the animation zone
  if (progressBar) {
    progressBar.style.width = (frac * 100).toFixed(3) + '%';
  }

  // Once scrolled past the animation zone, fade the fixed canvas layer out
  // so the product sections below are fully visible
  const pastAnimation = scrollTop >= animZone;
  const opacity       = pastAnimation ? '0' : '1';
  const visibility    = pastAnimation ? 'hidden' : 'visible';

  canvas.style.opacity      = opacity;
  canvas.style.visibility   = visibility;
  grainCanvas.style.opacity = pastAnimation ? '0' : '0.045';
  grainCanvas.style.visibility = visibility;
  if (vignette) {
    vignette.style.opacity    = opacity;
    vignette.style.visibility = visibility;
  }
  if (progressBar) {
    progressBar.style.opacity    = opacity;
    progressBar.style.visibility = visibility;
  }

  // Hero copy fades out quickly as soon as the visitor starts scrolling,
  // handing the stage over to the sprite animation.
  if (heroOverlay) {
    const HERO_FADE_FRAC = 0.16; // fully gone by 16% of the animation zone
    const heroOpacity = Math.max(0, 1 - frac / HERO_FADE_FRAC);
    heroOverlay.style.opacity = heroOpacity.toString();
    heroOverlay.classList.toggle('hero-hidden', heroOpacity <= 0.01 || pastAnimation);
  }

  // Nav goes from a transparent glass bar over the video to a solid,
  // light bar once the product sections are in view.
  if (siteNav) {
    siteNav.classList.toggle('nav-solid', pastAnimation);
  }
}

// ─── Animation Loop ───────────────────────────────────────────────────────────
function animate(timestamp) {
  const dt = lastTimestamp ? Math.min(timestamp - lastTimestamp, 64) : 16.67;
  lastTimestamp = timestamp;

  const diff = targetFrame - currentFrame;

  if (Math.abs(diff) > 0.001) {
    currentFrame = lerpDelta(currentFrame, targetFrame, LERP_EASE, dt);
  } else {
    currentFrame = targetFrame;
  }

  drawFrame(Math.round(currentFrame));

  // Animated film grain — refresh periodically to avoid static noise
  grainFrameTick++;
  if (grainFrameTick >= GRAIN_REFRESH_FRAMES) {
    generateGrain();
    grainFrameTick = 0;
  }

  requestAnimationFrame(animate);
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  // Set scroll spacer height
  const totalScrollHeight = FRAME_COUNT * PX_PER_FRAME + window.innerHeight;
  if (scrollSpacer) scrollSpacer.style.height = totalScrollHeight + 'px';

  // Initial canvas sizing
  resizeCanvas();

  // Preload all frames
  await preload();

  // Wire events
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    resizeCanvas();
    if (scrollSpacer) {
      scrollSpacer.style.height = (FRAME_COUNT * PX_PER_FRAME + window.innerHeight) + 'px';
    }
  });

  // Mobile nav toggle
  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener('click', () => {
      const nowClosed = mobileMenu.classList.toggle('closed');
      const isOpen = !nowClosed;
      mobileMenuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      mobileMenuBtn.querySelector('.material-symbols-outlined').textContent = isOpen ? 'close' : 'menu';
    });
    mobileMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('closed');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
        mobileMenuBtn.querySelector('.material-symbols-outlined').textContent = 'menu';
      });
    });
  }

  // Scroll cue nudges the visitor into the sprite animation
  if (scrollCue) {
    scrollCue.addEventListener('click', () => {
      window.scrollTo({ top: window.innerHeight * 0.9, behavior: 'smooth' });
    });
  }

  // Initial state for nav/hero before any scroll event fires
  onScroll();

  // Kick off render loop
  requestAnimationFrame(animate);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
