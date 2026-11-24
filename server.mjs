#!/usr/bin/env node
/**
 * XContest public flights dashboard. Node 18+; zero dependencies.
 * A same-origin backend avoids browser CORS restrictions on xcontest.org.
 * No login, cookies, or user credentials are used.
 */
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const KEY = process.env.XCONTEST_KEY || '03ECF5952EB046AC-A53195E89B7996E4-D1B128E82C3E2A66';
const PAGE_SIZE = 500;
const MAX_PAGES = 20;
const REMOTE_TIMEOUT_MS = 15_000;
const SITES = Object.freeze([
  { name: 'EJ Bowl', id: 'MzA3MA.i-Dv49EdvLvP' },
  { name: 'VOR', id: 'NTM3Ng.MUwwVm8qOWcG' },
  { name: 'Skyport', id: 'MjAxMw.NLNIO60jT8y_' },
  { name: 'Nuthouse', id: 'Mzk3NA.nyJCEVt1_2_F' }
]);

export function validateDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  if (year < 2000 || year > 2100) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function seasonForDate(date) {
  if (!validateDate(date)) throw new Error('Invalid date; expected YYYY-MM-DD');
  const year = Number(date.slice(0, 4));
  return year + (Number(date.slice(5, 7)) >= 10 ? 1 : 0);
}

export function buildXcontestUrl(date, siteId, start = 0) {
  if (!validateDate(date)) throw new Error('Invalid date; expected YYYY-MM-DD');
  if (!SITES.some(s => s.id === siteId)) throw new Error('Unknown XContest site');
  if (!Number.isSafeInteger(start) || start < 0) throw new Error('Invalid offset');
  const season = seasonForDate(date);
  // Critical: preserve raw `flights/world/YYYY` as XContest's *query key*.
  // Do not encode its slashes (or turn it into a pathname).
  return 'https://www.xcontest.org/api/data/?' + [
    `flights/world/${season}=`,
    'lng=en',
    `key=${encodeURIComponent(KEY)}`,
    `list[start]=${start}`,
    `list[num]=${PAGE_SIZE}`,
    'list[sort]=sum_points',
    'list[dir]=down',
    `filter[date]=${date}`,
    'filter[country]=US',
    'filter[catg]=FAI3',
    `filter[site]=${siteId}`
  ].join('&');
}

function normalizeFlight(item, fallbackSite, date) {
  const r = item?.league?.route;
  return {
    id: item.id ?? null,
    date,
    site: item.takeoff?.name || fallbackSite,
    pilot: item.pilot?.name || item.pilot?.username || 'Unknown pilot',
    username: item.pilot?.username || '',
    start: item.pointStart?.time || null,
    duration: item.stats?.duration || null,
    distanceKm: Number.isFinite(r?.distance) ? r.distance : null,
    points: Number.isFinite(r?.points) ? r.points : null,
    routeType: r?.type || null,
    avgSpeedKmh: Number.isFinite(r?.avgSpeed) ? r.avgSpeed : null,
    glider: item.glider?.name || item.glider?.nameCompact || '',
    url: item.league?.flight?.link || null
  };
}

export async function querySite(date, site, fetchImpl = fetch) {
  const flights = [];
  const seen = new Set();
  let offset = 0;
  let expected = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = buildXcontestUrl(date, site.id, offset);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (compatible; XContestFlightViewer/1.0)',
          'Referer': `https://www.xcontest.org/${seasonForDate(date)}/world/en/hotspots`
        },
        signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS)
      });
    } catch (err) {
      throw new Error(`XContest request failed: ${err.message}`);
    }
    if (!response.ok) {
      throw new Error(`XContest returned HTTP ${response.status}${response.status === 403 ? ' (possible access restriction or expired key)' : ''}`);
    }
    let data;
    try { data = await response.json(); }
    catch { throw new Error('XContest did not return valid JSON'); }
    if (data?.error) throw new Error(`XContest: ${data.error.message || 'API error'}`);
    if (!Array.isArray(data?.items) || !data.list || !Number.isInteger(data.list.numberItems)) {
      throw new Error('Unexpected XContest response structure');
    }
    const numItems = data.list.numberItems;
    expected = numItems;
    for (const item of data.items) {
      // Verify the takeoff as well as sending the server-side site filter.
      if ((item?.takeoff?.name || '').trim().toLowerCase() !== site.name.toLowerCase()) continue;
      const flight = normalizeFlight(item, site.name, date);
      const key = flight.id === null ? flight.url : String(flight.id);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      flights.push(flight);
    }
    offset += data.items.length;
    if (offset >= numItems) {
      return { name: site.name, siteId: site.id, status: 'ok', reported: numItems, flights };
    }
    if (!data.items.length) throw new Error('Pagination stopped before all flights were returned');
  }
  throw new Error(`Too many pages: XContest reported ${expected} flights; safety limit reached`);
}

export async function getFlightsForDate(date, fetchImpl = fetch) {
  if (!validateDate(date)) throw new Error('Invalid date; expected YYYY-MM-DD');
  const results = await Promise.all(SITES.map(async site => {
    try { return await querySite(date, site, fetchImpl); }
    catch (error) { return { name: site.name, siteId: site.id, status: 'error', error: error.message, reported: null, flights: [] }; }
  }));
  return {
    date,
    season: seasonForDate(date),
    sites: results,
    flights: results.flatMap(result => result.flights).sort((a, b) => (b.points ?? -1) - (a.points ?? -1)),
    generatedAt: new Date().toISOString()
  };
}

const STATIC_FILES = {
  '/': { path: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { path: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { path: 'app.js', type: 'application/javascript; charset=utf-8' },
  '/styles.css': { path: 'styles.css', type: 'text/css; charset=utf-8' }
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

export function createAppServer(fetchImpl = fetch) {
  return createHttpServer(async (req, res) => {
    try {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/api/flights') {
        const date = url.searchParams.get('date');
        if (!validateDate(date)) return sendJson(res, 400, { error: 'Provide a valid date in YYYY-MM-DD format' });
        const data = await getFlightsForDate(date, fetchImpl);
        return sendJson(res, 200, data);
      }
      const file = STATIC_FILES[url.pathname];
      if (!file) return sendJson(res, 404, { error: 'Not found' });
      const bytes = await readFile(join(DIR, 'public', file.path));
      res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(bytes);
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Internal server error' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createAppServer().listen(PORT, HOST, () => {
    console.log(`XContest flight viewer running at http://${HOST}:${PORT}`);
    console.log('No XContest login is used. Press Ctrl+C to stop.');
  });
}
