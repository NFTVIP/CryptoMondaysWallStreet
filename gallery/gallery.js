(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  // After creating your Google Form, replace both placeholders.
  // See setup guide at the bottom of this file.
  const FORM_ACTION      = 'https://docs.google.com/forms/d/e/1FAIpQLSfWcOdAN7weZ-XjNx4SMiArw7B0TlTfJ66lwbr6JHjf8FW6XQ/formResponse';
  const FORM_EMAIL_FIELD = 'entry.1398050602';
  const STORAGE_KEY      = 'cmws_gallery_unlocked';
  const MANIFEST_URL     = 'gallery/media.json';

  // ── State ─────────────────────────────────────────────────────────────────
  let manifest       = null;
  let currentEvent   = null;
  let activeFilter   = 'all';
  let lightboxItems  = [];
  let lightboxIndex  = 0;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const gateSection    = document.getElementById('gate-section');
  const gallerySection = document.getElementById('gallery-section');
  const gateForm       = document.getElementById('gate-form');
  const gateStatus     = document.getElementById('gate-status');
  const eventSelector  = document.getElementById('event-selector');
  const featuredGrid   = document.getElementById('featured-grid');
  const mediaGrid      = document.getElementById('media-grid');
  const lightbox       = document.getElementById('lightbox');
  const lightboxMedia  = document.getElementById('lightbox-media');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const lightboxCounter = document.getElementById('lightbox-counter');

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    if (localStorage.getItem(STORAGE_KEY) === '1') {
      showGallery();
    } else {
      gateSection.classList.remove('hidden');
      wireGateForm();
    }
    wireLightboxControls();
  }

  // ── Gate ──────────────────────────────────────────────────────────────────
  function wireGateForm() {
    gateForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      const emailInput = gateForm.querySelector('input[type=email]');
      const email      = emailInput.value.trim();
      const submitBtn  = gateForm.querySelector('button[type=submit]');

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showGateStatus('Please enter a valid email address.', 'error');
        return;
      }

      submitBtn.disabled    = true;
      submitBtn.textContent = 'Submitting…';

      // Dev-mode: skip POST when placeholder not yet replaced
      if (FORM_ACTION.includes('REPLACE_WITH_FORM_ID')) {
        console.warn('[Gallery] Google Form not configured — bypassing gate in dev mode.');
        unlock();
        return;
      }

      try {
        const body = new FormData();
        body.append(FORM_EMAIL_FIELD, email);
        // no-cors: response is opaque — we can't read it, but the entry IS recorded by Google
        await fetch(FORM_ACTION, { method: 'POST', mode: 'no-cors', body });
        unlock();
      } catch (err) {
        showGateStatus('Something went wrong. Please try again.', 'error');
        submitBtn.disabled    = false;
        submitBtn.textContent = 'View Gallery';
      }
    });
  }

  function unlock() {
    localStorage.setItem(STORAGE_KEY, '1');
    showGallery();
  }

  function showGallery() {
    gateSection.classList.add('hidden');
    gallerySection.classList.remove('hidden');
    loadManifest();
  }

  function showGateStatus(msg, type) {
    gateStatus.textContent = msg;
    gateStatus.className   = type === 'error'
      ? 'mt-3 text-xs text-red-400'
      : 'mt-3 text-xs text-secondary';
  }

  // ── Manifest ──────────────────────────────────────────────────────────────
  async function loadManifest() {
    try {
      const res = await fetch(MANIFEST_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = await res.json();

      wireFilterChips();       // wire once after manifest ready
      renderEventSelector();
      currentEvent = manifest.events[0];
      renderGallery();
    } catch (err) {
      console.error('[Gallery] Failed to load media manifest:', err);
    }
  }

  // ── Event selector ────────────────────────────────────────────────────────
  function renderEventSelector() {
    manifest.events.forEach(function (ev) {
      const opt       = document.createElement('option');
      opt.value       = ev.id;
      opt.textContent = ev.title;
      eventSelector.appendChild(opt);
    });

    eventSelector.addEventListener('change', function () {
      currentEvent = manifest.events.find(function (ev) {
        return ev.id === eventSelector.value;
      });
      activeFilter = 'all';
      setActiveChip('all');
      renderGallery();
    });
  }

  // ── Filter chips ──────────────────────────────────────────────────────────
  function wireFilterChips() {
    document.querySelectorAll('[data-filter]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        activeFilter = chip.dataset.filter;
        setActiveChip(activeFilter);
        renderGrid();
      });
    });
  }

  function setActiveChip(filter) {
    document.querySelectorAll('[data-filter]').forEach(function (chip) {
      const active = chip.dataset.filter === filter;
      chip.classList.toggle('bg-primary-container',     active);
      chip.classList.toggle('text-on-primary-container', active);
      chip.classList.toggle('bg-surface-container-high', !active);
      chip.classList.toggle('text-on-surface-variant',   !active);
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderGallery() {
    renderFeatured();
    renderGrid();
  }

  function renderFeatured() {
    const featuredItems = currentEvent.featured
      .map(function (id) {
        return currentEvent.items.find(function (it) { return it.id === id; });
      })
      .filter(Boolean);

    featuredGrid.innerHTML = featuredItems.map(function (item) {
      return buildFeaturedTile(item);
    }).join('');

    // Wire clicks — lightbox uses full items list so prev/next covers everything
    featuredGrid.querySelectorAll('[data-item-id]').forEach(function (tile) {
      tile.addEventListener('click', function () {
        const idx = currentEvent.items.findIndex(function (it) {
          return it.id === tile.dataset.itemId;
        });
        openLightbox(currentEvent.items, idx);
      });
    });
  }

  function buildFeaturedTile(item) {
    const thumb    = item.thumb || item.src;
    const isVideo  = item.type === 'video';
    const caption  = item.caption
      ? `<div class="tile-caption">${escHtml(item.caption)}</div>`
      : '';
    const playBadge = isVideo
      ? '<div class="play-badge"><span class="material-symbols-outlined">play_arrow</span></div>'
      : '';

    return `<div data-item-id="${item.id}" class="gallery-tile">
      <img src="${thumb}" alt="${escHtml(item.caption || '')}" loading="lazy">
      ${playBadge}${caption}
    </div>`;
  }

  function renderGrid() {
    const filtered = currentEvent.items.filter(function (item) {
      if (activeFilter === 'all')   return true;
      if (activeFilter === 'image') return item.type === 'image';
      if (activeFilter === 'video') return item.type === 'video';
      return true;
    });

    mediaGrid.innerHTML = filtered.map(function (item) {
      return buildGridTile(item);
    }).join('');

    mediaGrid.querySelectorAll('[data-item-id]').forEach(function (tile) {
      tile.addEventListener('click', function () {
        const idx = filtered.findIndex(function (it) {
          return it.id === tile.dataset.itemId;
        });
        openLightbox(filtered, idx);
      });
    });
  }

  function buildGridTile(item) {
    const thumb    = item.thumb || item.src;
    const isVideo  = item.type === 'video';
    const playBadge = isVideo
      ? '<div class="play-badge"><span class="material-symbols-outlined">play_arrow</span></div>'
      : '';

    return `<div data-item-id="${item.id}" class="gallery-tile">
      <img src="${thumb}" alt="${escHtml(item.caption || '')}" loading="lazy">
      ${playBadge}
    </div>`;
  }

  // ── Lightbox ──────────────────────────────────────────────────────────────
  function wireLightboxControls() {
    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-prev').addEventListener('click', function () { navigateLightbox(-1); });
    document.getElementById('lightbox-next').addEventListener('click', function () { navigateLightbox(1); });

    // Close when clicking the backdrop (not the inner content)
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) closeLightbox();
    });

    document.addEventListener('keydown', function (e) {
      if (!lightbox.classList.contains('is-open')) return;
      if (e.key === 'ArrowLeft')  navigateLightbox(-1);
      if (e.key === 'ArrowRight') navigateLightbox(1);
      if (e.key === 'Escape')     closeLightbox();
    });
  }

  function openLightbox(items, index) {
    lightboxItems = items;
    lightboxIndex = index;
    renderLightboxItem();
    lightbox.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    pauseLightboxVideo();
    lightbox.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function navigateLightbox(direction) {
    pauseLightboxVideo();
    lightboxIndex = (lightboxIndex + direction + lightboxItems.length) % lightboxItems.length;
    renderLightboxItem();
  }

  function renderLightboxItem() {
    const item = lightboxItems[lightboxIndex];
    if (!item) return;

    if (item.type === 'video' && isYouTube(item.src)) {
      // YouTube — render iframe so the player loads properly
      const videoId = extractYouTubeId(item.src);
      lightboxMedia.innerHTML = `<iframe
        class="yt-embed"
        src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0"
        allow="autoplay; fullscreen"
        allowfullscreen></iframe>`;
    } else if (item.type === 'video') {
      // Self-hosted video — src set only when lightbox opens to avoid preload
      lightboxMedia.innerHTML = `<video controls autoplay src="${item.src}"></video>`;
    } else {
      lightboxMedia.innerHTML = `<img src="${item.src}" alt="${escHtml(item.caption || '')}">`;
    }

    if (lightboxCaption) {
      lightboxCaption.textContent = item.caption || '';
      lightboxCaption.classList.toggle('hidden', !item.caption);
    }

    if (lightboxCounter) {
      lightboxCounter.textContent = `${lightboxIndex + 1} / ${lightboxItems.length}`;
    }
  }

  function pauseLightboxVideo() {
    const video = lightboxMedia ? lightboxMedia.querySelector('video') : null;
    if (video) video.pause();
    // Stop YouTube iframe by blanking its src — no API needed
    const iframe = lightboxMedia ? lightboxMedia.querySelector('iframe') : null;
    if (iframe) iframe.src = '';
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Returns true if the src is a YouTube URL (watch or short link)
  function isYouTube(src) {
    return typeof src === 'string' && (src.includes('youtube.com') || src.includes('youtu.be'));
  }

  // Extracts the 11-char video ID from any YouTube URL format
  function extractYouTubeId(src) {
    const shortMatch = src.match(/youtu\.be\/([^?&]+)/);
    if (shortMatch) return shortMatch[1];
    const longMatch  = src.match(/[?&]v=([^?&]+)/);
    if (longMatch)  return longMatch[1];
    return src; // fallback: treat src itself as the ID
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  /*
   * ==========================================================================
   * GOOGLE FORM SETUP — do this once before going live
   * ==========================================================================
   *
   * 1. Go to https://forms.google.com → create a blank form.
   * 2. Title it "CryptoMondays Wall Street — Gallery Access".
   * 3. Add one Short answer question titled "Email", mark it Required.
   *    Click ⋮ on the question → Response validation → Text → Email.
   * 4. Click the Responses tab → click the Google Sheets icon to auto-export
   *    submissions to a spreadsheet.
   * 5. Get FORM_ACTION:
   *    Click Send → copy the form link
   *    (e.g. https://docs.google.com/forms/d/e/1FAIpQLSc.../viewform)
   *    Replace "viewform" with "formResponse" → paste as FORM_ACTION above.
   * 6. Get FORM_EMAIL_FIELD:
   *    Click ⋮ (top-right of form editor) → "Get pre-filled link".
   *    Type "test@example.com" → click "Get link" → copy it.
   *    The URL contains "entry.123456789=test%40example.com".
   *    Use "entry.123456789" as FORM_EMAIL_FIELD above.
   * 7. Test: submit a real email on the page and confirm it appears in the Sheet.
   * ==========================================================================
   */

}());
