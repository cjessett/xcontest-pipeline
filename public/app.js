const siteNames = ['EJ Bowl', 'VOR', 'Skyport', 'Nuthouse'];
const siteColors = { 'EJ Bowl': '#30664c', VOR: '#446892', Skyport: '#9c6a45', Nuthouse: '#6b5690' };
const state = { response: null, filter: 'All sites', loading: false };
const el = id => document.getElementById(id);
const dateField = el('flight-date');
const dateFormatter = new Intl.DateTimeFormat('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric', timeZone:'UTC' });
const launchTimeFormatter = new Intl.DateTimeFormat('en-US', { hour:'numeric', minute:'2-digit', timeZone:'America/Los_Angeles' });
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prettyDate = date => dateFormatter.format(new Date(`${date}T12:00:00Z`));
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const validFlightUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'www.xcontest.org' ? value : null; } catch { return null; } };
const formatDuration = duration => {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration || '');
  if (!match) return '—';
  const h = Number(match[1] || 0), m = Number(match[2] || 0), s = Number(match[3] || 0);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`;
};
const formatTime = value => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.valueOf()) ? '—' : launchTimeFormatter.format(d); };
const formatNum = n => typeof n === 'number' ? numberFormat.format(n) : '—';

function shiftDate(delta) {
  const date = dateField.value || todayLocal();
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  dateField.value = d.toISOString().slice(0, 10);
  loadFlights();
}

function activeSites() {
  if (!state.response) return siteNames.map(name => ({ name, status:'idle', flights:[] }));
  return state.response.sites;
}

function selectedSites() { return activeSites().filter(site => state.filter === 'All sites' || site.name === state.filter); }
function selectedFlights() { return selectedSites().flatMap(site => site.flights); }

function renderChips() {
  const all = activeSites();
  el('site-chips').innerHTML = ['All sites', ...siteNames].map(name => {
    const count = name === 'All sites' ? all.reduce((sum, site) => sum + site.flights.length, 0) : (all.find(s => s.name === name)?.flights.length || 0);
    const active = state.filter === name;
    return `<button type="button" class="chip ${active ? 'active' : ''}" data-site="${escapeHtml(name)}" aria-pressed="${active}">${escapeHtml(name)} <span class="count">${state.response ? count : '—'}</span></button>`;
  }).join('');
  el('site-chips').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.site; render(); }));
}

function renderMetrics() {
  const flights = selectedFlights();
  const totalDistance = flights.reduce((sum, f) => sum + (f.distanceKm || 0), 0);
  const totalPoints = flights.reduce((sum, f) => sum + (f.points || 0), 0);
  const longest = flights.reduce((max, f) => (f.distanceKm ?? -1) > (max?.distanceKm ?? -1) ? f : max, null);
  el('total-flights').textContent = state.response ? formatNum(flights.length) : '—';
  el('total-distance').textContent = state.response ? formatNum(totalDistance) : '—';
  el('total-points').textContent = state.response ? formatNum(totalPoints) : '—';
  el('longest-flight').textContent = state.response ? formatNum(longest?.distanceKm ?? null) : '—';
  el('longest-pilot').textContent = longest ? longest.pilot : 'Farthest distance';
  el('export-button').disabled = !state.response || !flights.length;
}

function renderSitePanel(site) {
  const color = siteColors[site.name] || '#30664c';
  const sorted = [...site.flights].sort((a,b) => (b.points ?? -1) - (a.points ?? -1));
  const content = site.status === 'error'
    ? `<div class="error-site">Could not load ${escapeHtml(site.name)}: ${escapeHtml(site.error)}</div>`
    : !sorted.length
      ? '<div class="empty-site">No flights returned for this site and date.</div>'
      : `<div class="table-scroll"><table><thead><tr><th>Pilot</th><th>Launch time (PT)</th><th>Duration</th><th>Glider</th><th class="number">Distance (km)</th><th class="number">Points</th><th>Flight</th></tr></thead><tbody>${sorted.map(f => {
        const safeUrl = validFlightUrl(f.url);
        return `<tr><td><span class="pilot">${escapeHtml(f.pilot)}</span><span class="username">${escapeHtml(f.username)}</span></td><td>${escapeHtml(formatTime(f.start))}</td><td>${escapeHtml(formatDuration(f.duration))}</td><td>${escapeHtml(f.glider || '—')}</td><td class="number">${formatNum(f.distanceKm)}</td><td class="number score">${formatNum(f.points)}</td><td>${safeUrl ? `<a class="flight-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">View ↗</a>` : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  return `<article class="site-panel"><div class="site-panel-header"><div><h3><span style="color:${color}">●</span> ${escapeHtml(site.name)}</h3><small>${site.status === 'error' ? 'Request failed' : 'XContest FAI3 · United States'}</small></div><span class="pill">${site.status === 'error' ? 'Error' : `${site.flights.length} flight${site.flights.length === 1 ? '' : 's'}`}</span></div>${content}</article>`;
}

function render() {
  renderChips();
  renderMetrics();
  const date = state.response?.date || dateField.value;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) el('day-heading').textContent = prettyDate(date);
  el('season-label').textContent = state.response ? `XContest ${state.response.season} season` : '';
  if (!state.response) return;
  const chosen = selectedSites();
  const failureCount = chosen.filter(site => site.status === 'error').length;
  const okCount = chosen.length - failureCount;
  const flights = selectedFlights();
  el('result-caption').textContent = `${flights.length} recorded flights · ${okCount} of ${chosen.length} sites loaded`;
  el('status').innerHTML = failureCount === chosen.length
    ? '<div class="alert">All XContest requests failed. Check the errors below. The public API key may need updating, or direct server access may be restricted.</div>'
    : failureCount
      ? `<div class="alert">${failureCount} site request${failureCount > 1 ? 's' : ''} failed; the results below may be incomplete.</div>`
      : '';
  el('site-results').innerHTML = chosen.map(renderSitePanel).join('');
}

async function loadFlights() {
  if (state.loading || !dateField.value) return;
  state.loading = true;
  state.response = null;
  const target = dateField.value;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  el('find-button').disabled = true;
  el('find-button').textContent = 'Loading…';
  el('status').textContent = 'Loading public XContest flights from all four launch sites…';
  el('site-results').innerHTML = '';
  render();
  try {
    const response = await fetch(`/api/flights?date=${encodeURIComponent(target)}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    state.response = data;
    const url = new URL(window.location.href);
    url.searchParams.set('date', target);
    history.replaceState(null, '', url.toString());
    render();
  } catch (error) {
    el('status').textContent = `Could not load flights: ${error.name === 'AbortError' ? 'Request timed out' : error.message}`;
    el('result-caption').textContent = 'Request unsuccessful';
    renderMetrics();
    renderChips();
  } finally {
    clearTimeout(timeout);
    state.loading = false;
    el('find-button').disabled = false;
    el('find-button').innerHTML = 'Find flights <span aria-hidden="true">→</span>';
  }
}

const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
function exportCsv() {
  const columns = ['date','site','pilot','username','start_utc','duration','distance_km','points','route_type','average_speed_kmh','glider','xcontest_url'];
  const fields = ['date','site','pilot','username','start','duration','distanceKm','points','routeType','avgSpeedKmh','glider','url'];
  const rows = [columns.join(','), ...selectedFlights().map(f => fields.map(key => csvCell(f[key])).join(','))];
  const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `xcontest-${dateField.value}-${state.filter === 'All sites' ? 'all-sites' : state.filter.toLowerCase().replaceAll(' ', '-')}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

el('date-form').addEventListener('submit', event => { event.preventDefault(); loadFlights(); });
el('prev-day').addEventListener('click', () => shiftDate(-1));
el('next-day').addEventListener('click', () => shiftDate(1));
el('export-button').addEventListener('click', exportCsv);
const requested = new URL(window.location.href).searchParams.get('date');
dateField.value = /^\d{4}-\d{2}-\d{2}$/.test(requested || '') ? requested : todayLocal();
render();
loadFlights();
