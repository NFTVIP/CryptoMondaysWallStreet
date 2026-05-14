#!/usr/bin/env node
// Run once per event after dropping media into images/events/<slug>/
// Usage: node gallery/build-manifest.js <slug> "<title>" <YYYY-MM-DD>
// Example: node gallery/build-manifest.js consensus-opening-2026 "Consensus Opening Event 2026" 2026-05-11

'use strict';

const fs   = require('fs');
const path = require('path');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);

const [,, slug, title, date] = process.argv;

if (!slug || !title || !date) {
  console.error('Usage: node gallery/build-manifest.js <slug> "<title>" <YYYY-MM-DD>');
  process.exit(1);
}

const mediaDir    = path.join('images', 'events', slug);
const manifestPath = path.join('gallery', 'media.json');

if (!fs.existsSync(mediaDir)) {
  console.error(`Directory not found: ${mediaDir}\nCreate it and drop your media files in, then rerun.`);
  process.exit(1);
}

// Collect, filter hidden files, sort alphabetically for deterministic output
const files = fs.readdirSync(mediaDir)
  .filter(f => !f.startsWith('.'))
  .sort();

let imgCount = 0;
let vidCount = 0;
let counter  = 0;
const items  = [];

files.forEach(file => {
  const ext     = path.extname(file).toLowerCase();
  const isImage = IMAGE_EXTS.has(ext);
  const isVideo = VIDEO_EXTS.has(ext);
  if (!isImage && !isVideo) return;

  counter++;
  const id   = `item-${String(counter).padStart(3, '0')}`;
  const src  = `images/events/${slug}/${file}`;
  let   thumb = src;

  // For videos, prefer a same-stem .jpg as the poster thumbnail
  if (isVideo) {
    const stem       = path.basename(file, ext);
    const posterFile = stem + '.jpg';
    if (fs.existsSync(path.join(mediaDir, posterFile))) {
      thumb = `images/events/${slug}/${posterFile}`;
    }
  }

  items.push({ id, type: isImage ? 'image' : 'video', src, thumb, caption: '' });
  if (isImage) imgCount++;
  if (isVideo) vidCount++;
});

if (items.length === 0) {
  console.warn(`No media files found in ${mediaDir}. Supported: jpg jpeg png webp gif mp4 webm mov`);
  process.exit(0);
}

// First 3 items become featured
const featured = items.slice(0, 3).map(it => it.id);

const event = { id: slug, title, date, featured, items };

// Merge into existing manifest (preserves other events)
let manifest = { events: [] };
if (fs.existsSync(manifestPath)) {
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (_) { console.warn('Could not parse existing manifest — starting fresh.'); }
}

const existingIdx = manifest.events.findIndex(e => e.id === slug);
if (existingIdx >= 0) {
  manifest.events[existingIdx] = event;
} else {
  manifest.events.unshift(event); // newest event first
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`✓ Wrote ${items.length} items (${imgCount} images, ${vidCount} videos) for event "${slug}"`);
console.log(`  Manifest: ${manifestPath}`);
