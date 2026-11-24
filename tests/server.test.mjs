import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildXcontestUrl, seasonForDate, validateDate, querySite, getFlightsForDate, createAppServer } from '../server.mjs';

const fixtures = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'xcontest-sample.json')));
const ej = { name:'EJ Bowl', id:'MzA3MA.i-Dv49EdvLvP' };
function mockFetch(url) {
  assert.match(url, /^https:\/\/www\.xcontest\.org\/api\/data\/\?flights\/world\/2026=/);
  const u = new URL(url);
  const site = u.searchParams.get('filter[site]');
  const offset = Number(u.searchParams.get('list[start]'));
  const nameById = { [ej.id]: 'EJ Bowl', 'NTM3Ng.MUwwVm8qOWcG':'VOR', 'MjAxMw.NLNIO60jT8y_':'Skyport', 'Mzk3NA.nyJCEVt1_2_F':'Nuthouse' };
  const name = nameById[site];
  assert.ok(name, `Unknown site ${site}`);
  assert.equal(u.searchParams.get('filter[date]'), '2025-12-04');
  assert.equal(u.searchParams.get('filter[country]'), 'US');
  assert.equal(u.searchParams.get('filter[catg]'), 'FAI3');
  const all = fixtures[name] || [];
  // Split EJ Bowl into two pages to exercise pagination.
  const page = name === 'EJ Bowl' ? all.slice(offset, offset + 2) : all.slice(offset, offset + 500);
  return Promise.resolve(new Response(JSON.stringify({ list: { startItemIndex: offset, numberItemsRequested:500, numberItemsReturned: page.length, numberItems: all.length }, items: page }), {status:200, headers:{'content-type':'application/json'}}));
}

test('validates calendar dates rather than matching just the pattern', () => {
  assert.equal(validateDate('2025-12-04'), true);
  assert.equal(validateDate('2025-02-29'), false);
  assert.equal(validateDate('2024-02-29'), true);
  assert.equal(validateDate('not a date'), false);
});
test('October through September XContest seasons', () => {
  assert.equal(seasonForDate('2025-09-30'), 2025);
  assert.equal(seasonForDate('2025-10-01'), 2026);
  assert.equal(seasonForDate('2025-12-04'), 2026);
  assert.equal(seasonForDate('2026-11-23'), 2027);
});
test('leaves XContest source type unencoded in generated API URL', () => {
  const url = buildXcontestUrl('2025-12-05', ej.id, 500);
  assert.ok(url.includes('?flights/world/2026='), url);
  assert.ok(!url.includes('flights%2Fworld'));
  assert.ok(url.includes('list[start]=500'));
  assert.ok(url.includes('filter[date]=2025-12-05'));
  assert.ok(url.endsWith('filter[site]=MzA3MA.i-Dv49EdvLvP'));
});
test('normalizes real XContest flight payload and paginates', async () => {
  const result = await querySite('2025-12-04', ej, mockFetch);
  assert.equal(result.status,'ok');
  assert.equal(result.reported,3);
  assert.equal(result.flights.length,3);
  const flight = result.flights[0];
  assert.equal(flight.pilot,'CJ Jessett');
  assert.equal(flight.distanceKm,90.664);
  assert.equal(flight.points,108.8);
  assert.equal(flight.start,'2025-12-04T19:13:32Z');
  assert.equal(flight.site,'EJ Bowl');
  assert.match(flight.url,/xcontest.org\/2026\/world\/en\/flights\/detail:cjessett/);
});
test('aggregates every configured site with known real EJ Bowl/VOR records', async () => {
  const result = await getFlightsForDate('2025-12-04',mockFetch);
  assert.equal(result.sites.length,4);
  assert.deepEqual(result.sites.map(s => s.flights.length), [3,1,0,0]);
  assert.equal(result.flights.length,4);
  assert.equal(result.flights[0].pilot,'CJ Jessett');
  assert.equal(result.season,2026);
});
test('serves actual webpage and anonymous API on the same origin', async t => {
  const server = createAppServer(mockFetch);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await fetch(base);
  assert.equal(html.status,200);
  const body = await html.text();
  assert.ok(body.includes('Flights by launch site'));
  assert.ok(body.includes('Flight date'));
  const invalid = await fetch(`${base}/api/flights?date=2025-02-29`);
  assert.equal(invalid.status,400);
  const res = await fetch(`${base}/api/flights?date=2025-12-04`);
  assert.equal(res.status,200);
  const data = await res.json();
  assert.deepEqual(data.sites.map(s => s.name),['EJ Bowl','VOR','Skyport','Nuthouse']);
  assert.equal(data.flights.length,4);
  assert.equal(data.sites[0].flights[0].glider,'OZONE Zeolite 2 GT');
});
test('marks a failing site instead of fabricating a zero-flight result',async () => {
  const failing = async url => url.includes('NTM3Ng.MUwwVm8qOWcG') ? new Response('bad gateway',{status:502}) : mockFetch(url);
  const result = await getFlightsForDate('2025-12-04', failing);
  assert.equal(result.sites[1].status, 'error');
  assert.match(result.sites[1].error,/HTTP 502/);
  assert.equal(result.flights.length,3);
});
