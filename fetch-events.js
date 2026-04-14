#!/usr/bin/env node
/**
 * CryptoMondays Wall Street — Luma Event Fetcher
 * ================================================
 * Pulls events from the Luma API (server-side only) and writes the
 * normalized events.json file that the static site reads client-side.
 * The API key is NEVER sent to the browser.
 *
 * Quick start
 * -----------
 *   cp .env.example .env          # copy template
 *   # Fill in LUMA_API_KEY and LUMA_CALENDAR_ID in .env
 *   npm install                   # installs dotenv
 *   node fetch-events.js          # run manually
 *
 * Luma API docs:  https://docs.lu.ma/reference/getting-started
 * Your API key:   https://lu.ma/settings → Integrations → API Key
 * Calendar ID:    https://lu.ma/dashboard → your calendar → Settings → scroll to "API ID"
 *                 It looks like: cal-xxxxxxxxxxxxxxxx
 */

'use strict';

// Load .env automatically when present — graceful if dotenv isn't installed yet
try { require('dotenv').config(); } catch (_) { /* npm install to enable */ }

const fs   = require('fs');
const path = require('path');

// ── Configuration ─────────────────────────────────────────────────────────────
const LUMA_API_KEY     = (process.env.LUMA_API_KEY     || '').trim();
const LUMA_CALENDAR_ID = (process.env.LUMA_CALENDAR_ID || '').trim();
const OUTPUT_FILE      = path.join(__dirname, 'events.json');

const LUMA_BASE        = 'https://api.lu.ma';
const PER_PAGE         = 50;   // max Luma allows per request
const RATE_LIMIT_MS    = 1100; // pause between paginated requests (free tier: ~1 req/sec)

// ── Guards ────────────────────────────────────────────────────────────────────
function validateConfig() {
  const missing = [];
  if (!LUMA_API_KEY)     missing.push('LUMA_API_KEY');
  if (!LUMA_CALENDAR_ID) missing.push('LUMA_CALENDAR_ID');
  return missing;
}

// ── Luma API: full paginated fetch ────────────────────────────────────────────
async function fetchAllLumaEvents() {
  const all    = [];
  let cursor   = null;
  let page     = 1;

  do {
    const params = new URLSearchParams({
      calendar_api_id:  LUMA_CALENDAR_ID,
      pagination_limit: String(PER_PAGE),
    });
    if (cursor) params.set('pagination_cursor', cursor);

    const url = `${LUMA_BASE}/public/v1/calendar/list-events?${params}`;
    console.log(`  Page ${page}: GET ${url}`);

    const res = await fetch(url, {
      headers: {
        'x-luma-api-key': LUMA_API_KEY,
        'Accept':         'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Luma API responded ${res.status}:\n  ${body}`);
    }

    const data    = await res.json();
    const entries = Array.isArray(data.entries) ? data.entries : [];
    all.push(...entries);
    console.log(`  → ${entries.length} events (running total: ${all.length})`);

    cursor = data.has_more ? data.next_cursor : null;
    if (cursor) await sleep(RATE_LIMIT_MS); // be kind to the rate limit
    page++;
  } while (cursor);

  return all;
}

// ── Normalize one Luma entry into our schema ──────────────────────────────────
function normalizeEvent(entry) {
  const ev  = entry.event || entry;
  const now = new Date();

  // Parse start time
  const start = ev.start_at ? new Date(ev.start_at) : null;
  const tz    = ev.timezone || 'America/New_York';

  // Best available location string — try all known Luma fields in priority order
  const geo  = ev.geo_address_info || {};
  const geoJ = (() => {
    try { return typeof ev.geo_address_json === 'string' ? JSON.parse(ev.geo_address_json) : (ev.geo_address_json || {}); }
    catch (_) { return {}; }
  })();
  const venue = ev.venue || {};

  // Build a city/region fallback from structured geo sub-fields
  const cityRegion = [geo.city || geoJ.city, geo.region || geo.state || geoJ.region, geo.country || geoJ.country]
    .filter(Boolean).join(', ');

  const location =
    geo.full_address    ||
    geoJ.full_address   ||
    geo.address         ||
    geoJ.address        ||
    ev.location_address ||
    (venue.name && venue.address ? `${venue.name}, ${venue.address}` : null) ||
    venue.name          ||
    cityRegion          ||
    (ev.zoom_meeting_url ? 'Virtual (Zoom)' : '') ||
    (ev.meeting_url      ? 'Virtual'        : '') ||
    'Wall Street, New York, NY';

  // Human-readable date/time in the event's own timezone
  const dateLabel = start
    ? start.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: tz,
      })
    : '';
  const timeLabel = start
    ? start.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: tz,
      })
    : '';

  return {
    id:          ev.api_id || ev.id || '',
    title:       ev.name   || 'Untitled Event',
    description: ev.description_short || (ev.description || '').replace(/<[^>]+>/g, '').slice(0, 240) || '',
    image:       ev.cover_url || (ev.cover && ev.cover.url) || '',
    date_iso:    ev.start_at || '',
    date_label:  dateLabel,
    time_label:  timeLabel,
    location,
    url:         ev.url || `https://lu.ma/${ev.slug || ''}`,
    period:      (start && start >= now) ? 'upcoming' : 'past',
    featured:    false,  // first upcoming gets true below
    guest_count: ev.guest_count      || 0,
    tags:        (ev.tags || []).map(t => t.label || t.name || String(t)).filter(Boolean),
  };
}

// ── Write events.json ─────────────────────────────────────────────────────────
function writeEventsJson(events) {
  // Upcoming: soonest first  ·  Past: most recent first
  const upcoming = events
    .filter(e => e.period === 'upcoming')
    .sort((a, b) => new Date(a.date_iso) - new Date(b.date_iso));
  const past = events
    .filter(e => e.period === 'past')
    .sort((a, b) => new Date(b.date_iso) - new Date(a.date_iso));

  // Pin the next event
  if (upcoming.length) upcoming[0].featured = true;

  const payload = {
    fetched_at:   new Date().toISOString(),
    calendar_id:  LUMA_CALENDAR_ID,
    source:       'Luma API',
    upcoming,
    past,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf8');

  console.log('\n✓ events.json written successfully');
  console.log(`  Upcoming : ${upcoming.length}`);
  console.log(`  Past     : ${past.length}`);
  console.log(`  Output   : ${OUTPUT_FILE}`);
  if (upcoming.length) {
    console.log(`  Next     : "${upcoming[0].title}" on ${upcoming[0].date_label}`);
  }
}

// ── Sample / fallback data ────────────────────────────────────────────────────
function writeSampleEvents() {
  // If the file already has real Luma data, don't overwrite it with samples
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
      if (existing.source === 'Luma API') {
        console.log('  Existing events.json (Luma data) preserved.');
        return;
      }
    } catch (_) { /* malformed JSON — overwrite */ }
  }

  const sample = {
    fetched_at: new Date().toISOString(),
    source:     'Sample data — set LUMA_API_KEY & LUMA_CALENDAR_ID to pull live events',
    calendar_id: '',
    upcoming: [
      {
        id: 'sample-1', featured: true,
        title: 'The Convergence: TradFi & DeFi Summit',
        description: 'Where institutional capital meets the digital frontier. An invitation-only evening of high-signal networking and market intelligence.',
        image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBXUu097EY9HXw6hmtvcQkHxyEvIfCgVbEyAiPkw7C6HJtn61zTJNlOs8xbCsUKSArv6wu90CuQRK0WLrEYNoa75yzMVhqTni-Arn-hf6qK1ILXVv2J5CX4U_9gQgh3Crg1jI1jNVy4naXrtG2xo8v2lI1xG_ykc8smFGW7DEjFzsAXfMXJ1ftg7j_HZYHsV93p4rcBt1CtiArsngy2tMiwNXKfcxQjFKISmv63_wgzoCmuraQC8Nx86JXYTQffOYG7w85QWpmLdNU',
        date_iso: '2026-05-19T18:00:00-04:00', date_label: 'May 19, 2026', time_label: '6:00 PM EDT',
        location: 'Wall Street, New York, NY', url: 'https://lu.ma/user/WallStreet',
        period: 'upcoming', guest_count: 0, tags: [],
      },
      {
        id: 'sample-2', featured: false,
        title: 'Regulatory Clarity & Institutional Custody',
        description: 'An intimate roundtable on the evolving landscape of digital asset security frameworks.',
        image: '',
        date_iso: '2026-06-02T18:00:00-04:00', date_label: 'Jun 2, 2026', time_label: '6:00 PM EDT',
        location: 'Wall Street, New York, NY', url: 'https://lu.ma/user/WallStreet',
        period: 'upcoming', guest_count: 0, tags: [],
      },
      {
        id: 'sample-3', featured: false,
        title: 'Venture Capital & Tokenomics Networking Night',
        description: 'Connecting high-growth startups with established Tier-1 liquidity providers.',
        image: '',
        date_iso: '2026-06-23T18:30:00-04:00', date_label: 'Jun 23, 2026', time_label: '6:30 PM EDT',
        location: 'Wall Street, New York, NY', url: 'https://lu.ma/user/WallStreet',
        period: 'upcoming', guest_count: 0, tags: [],
      },
    ],
    past: [
      {
        id: 'past-1', featured: false,
        title: 'Institutional Bitcoin Adoption Panel', description: '',
        image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDM7G5QItrXVH2x8hlvKIThrC6CFUYadHaVgq7AvMw2p2TLBtniTQvYJFGGAaPDuhi7BlkAxDLahQPWXoaiNDvQt9psCHJpCCZUK5iP5-g_x3e0pf665Asltu4eO3RszpTQfRKGq0AEnjwkidUlk4ZN98EI4ZdKi27jqmX80weCkftglNFuK3wziL51bNLMYnWDZuDBGI-eZk_7DT1y3Uz6Qf81NQK0tSUCF894g-VbC-1MzLSubQt0D1x7FkyozXqwEnHQMUe_tfc',
        date_iso: '2026-04-01T18:00:00-04:00', date_label: 'Apr 1, 2026', time_label: '6:00 PM EDT',
        location: 'New York, NY', url: 'https://lu.ma/user/WallStreet',
        period: 'past', guest_count: 0, tags: [],
      },
      {
        id: 'past-2', featured: false,
        title: 'Global Macro & Digital Assets Summit', description: '',
        image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDaVJE-uNo3wqyylf24FtM4KiKPuVz39jiQ0qr2r_xerT9ZYyE9mHc68vuMQG7YIyIfSzxXM7StDomyVyVQXUktsmUrM-S4nWHZRR3OsiVqKOCEFs5ullt1nj6euhVNY7462v9e2foRZ-N88yh2Q4s6AETikObIJvSPK7BUs03lbV_FKLqatYk6k1eOE9Fq5R4e_52skX8bkU3_wdg7_QIXHpUelmjN3Ir_hBnTIQj-q683BmIvtwg-6PvXI34Zi8voElJ_3qv776M',
        date_iso: '2026-03-10T18:00:00-04:00', date_label: 'Mar 10, 2026', time_label: '6:00 PM EDT',
        location: 'Miami, FL', url: 'https://lu.ma/user/WallStreet',
        period: 'past', guest_count: 0, tags: [],
      },
      {
        id: 'past-3', featured: false,
        title: 'Yield Derivatives & Liquidity Protocols', description: '',
        image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDoJvOVgrNq6vOm3OelSOA_-ccFWvaB_qWQUW0DeKDOkHU7ycNOb_Nt3mKcA5fPCx7gfRRxwXdoeuvjxglRGyE2qufEefbAlq1MNEKObqZcW-D8_bUfNg04rSIc6I-SwAevL1TG4vhk1jLNyIl81tp_Rn_Z4Fe-wfSdNqOqGBk1XEDuksKOPxlw3adF2kzUd-VmfPVU8nXBxewMs0XepcDC-podMTkgC4gizLQAxjy156Ym_e3AN2q7ibzyyyUhIZjtOTFse4ZxI_g',
        date_iso: '2026-02-12T18:00:00-05:00', date_label: 'Feb 12, 2026', time_label: '6:00 PM EST',
        location: 'London, UK', url: 'https://lu.ma/user/WallStreet',
        period: 'past', guest_count: 0, tags: [],
      },
    ],
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(sample, null, 2), 'utf8');
  console.log('✓ Wrote sample events.json (placeholder data)');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('CryptoMondays Wall Street — Luma Event Fetcher');
  console.log('================================================\n');

  const missing = validateConfig();
  if (missing.length) {
    console.error(`✗ Missing env vars: ${missing.join(', ')}`);
    console.error('  See .env.example — copy it to .env and fill in your values.\n');
    writeSampleEvents();
    process.exit(0);
  }

  console.log(`Calendar : ${LUMA_CALENDAR_ID}`);
  console.log(`Output   : ${OUTPUT_FILE}\n`);

  try {
    const raw        = await fetchAllLumaEvents();
    const normalized = raw.map(normalizeEvent);
    writeEventsJson(normalized);
  } catch (err) {
    console.error('\n✗ Fetch failed:', err.message);
    console.error('  Writing sample data as fallback...\n');
    writeSampleEvents();
    process.exit(1);
  }
})();
