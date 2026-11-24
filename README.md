# Santa Barbara XContest Flight Viewer + Scraper

A simple local web dashboard and a paced, resumable command-line scraper for public XContest paragliding flights from **EJ Bowl**, **VOR**, **Skyport**, and **Nuthouse**.

- Choose a date in a web browser, filter by launch site, and download **CSV** or **JSON**.
- Export one day or an entire date range with the Python scraper, using `npm run` commands.
- Automatically map flight dates to the correct XContest season (October 1 through September 30).
- Reuse successful days from a local cache; stop on errors instead of repeatedly retrying access-denied requests.
- No npm packages, Python packages, or XContest login required. Uses Node.js 18+ and Python 3.9+.

> This uses XContest's **undocumented public API**, so access, response fields, and behavior can change. The source can impose IP or rate restrictions. The project does not rotate IPs or bypass access denials.

## Requirements

- [Node.js](https://nodejs.org/) **18+**
- **Python 3.9+** (`python3` available in your terminal)

There are no dependencies to install. `npm install` is optional; the npm scripts work directly.

## Quick start — web viewer

In the project directory:

```bash
npm start
```

Open **http://127.0.0.1:8787**. Choose a date, click **Find flights**, and optionally choose one of the four launch-site filters. Click **Export CSV** or **Export JSON** to download only the currently selected site(s).

To run with Node's development watch mode:

```bash
npm run dev
```

The page also accepts a date in the URL: `http://127.0.0.1:8787/?date=2025-12-05`.

## Date-range scraping

**Keep `npm start` running in one terminal**. The Python script talks to the local Node server at `http://127.0.0.1:8787/api/flights`, which fetches all four launch sites for a given date.

In another terminal, run any of these:

```bash
# One date, CSV only
npm run scrape:csv -- 2025-12-05

# A full month, JSON only
npm run scrape:json -- 2025-12-01 2025-12-31

# Both formats for a range
npm run scrape:both -- 2025-12-01 2025-12-31

# General command: choose the output at runtime
npm run scrape -- 2025-12-01 2025-12-31 --format csv
```

The `--` after the npm script name is **important**: it passes the dates and flags to Python.

Alternatively run Python directly:

```bash
python3 xcontest_paced.py 2025-12-01 2025-12-31 --format json
```

### Command-line options

| Option | Meaning | Default |
| --- | --- | --- |
| `START` | First date, `YYYY-MM-DD` (required) | — |
| `END` | Last date, `YYYY-MM-DD` (inclusive) | Same as START |
| `--format csv\|json\|both` | Choose output format | `both` |
| `--output PREFIX` | Path and basename **without** `.csv` or `.json` | `xcontest_START_to_END` |
| `--delay SECONDS` | Minimum pause **between date requests** | `30` |
| `--jitter SECONDS` | Additional random pause | `10` |
| `--max-days N` | Fetch at most N uncached dates in this run | All dates |
| `--cache DIRECTORY` | Store completed per-day API responses | `.xcontest-cache` |
| `--base-url URL` | Local web server address | `http://127.0.0.1:8787` |
| `--timeout SECONDS` | Local HTTP timeout | `120` |

Example with a custom folder and a small test run:

```bash
npm run scrape:csv -- 2025-12-01 2025-12-31 --max-days 3 --delay 30 --jitter 10 --output exports/december-2025
```

Creates `exports/december-2025.csv`. `--format json` creates only `.json`; `--format both` creates both. The `--output` directory is created as needed. All exported files and cache directories are ignored by Git by default.

### Output fields

The CSV has one row per flight with date, site, flight ID, pilot name, username, start time (UTC), duration, distance (km), points, route type, average speed (km/h), glider, and XContest flight URL.

The JSON includes these normalized flight records **plus** `completedDates`, `days`, per-site API statuses, and `failures`. It does **not** reproduce every field of XContest's original nested flight JSON.

Both formats contain data for only the dates successfully fetched (or previously cached). A partial or failed day is **not** labeled as a zero-flight day. The scraper exits nonzero on request errors and leaves already completed days cached.

### Caching and pacing

Each date costs up to four XContest site queries, plus any required pagination. The local Node server currently fetches the four sites concurrently. **`--delay` controls the gap between dates, not the gap between those four requests.** It also doesn't guarantee that XContest will allow sustained collection.

Successful days are cached under `.xcontest-cache/`. Running the same command again skips cached days, helping avoid duplicate requests. If XContest denies access, the scraper stops instead of automatically retrying through another IP.

If you want to refresh previously completed data, remove the corresponding date's file from `.xcontest-cache/` manually. For date ranges across seasons, the server selects the correct XContest season automatically.

## XContest season and launch IDs

XContest season **2026** covers **2025-10-01 through 2026-09-30**; season **2027** starts **2026-10-01**. See `seasonForDate()` in `server.mjs`.

| Site | XContest site identifier |
| --- | --- |
| EJ Bowl | `MzA3MA.i-Dv49EdvLvP` |
| VOR | `NTM3Ng.MUwwVm8qOWcG` |
| Skyport | `MjAxMw.NLNIO60jT8y_` |
| Nuthouse | `Mzk3NA.nyJCEVt1_2_F` |

The server preserves XContest's special URL query key `flights/world/<season>` literally, because encoding its slashes changes how XContest interprets the request.

## API key and access errors

The Node backend has a captured fallback `key` from previous working XContest requests. **It does not automatically refresh the key.** To override it with a key you obtained legitimately from a public Hot-Spots page request:

```bash
XCONTEST_KEY='your-current-key' npm start
```

If the site returns `Access forbidden for remote IP address ...`, that is an access denial from XContest; changing date, output format, or parsing will not resolve it. Compare the browser's public API response with the local server's, and respect XContest's published limits or seek authorized API access. The tool stops on failures rather than making repeated blocked requests.

## Project layout

```text
.
├── package.json           # npm start / test / scraper commands
├── server.mjs             # Local API and static web server
├── xcontest_paced.py      # Date-range CSV/JSON scraper
├── public/
│   ├── index.html         # Dashboard page
│   ├── app.js             # Date picking, filtering, CSV/JSON exports
│   └── styles.css
├── tests/
│   ├── server.test.mjs    # Node API and season tests
│   ├── test_scraper.py    # Python export, cache, and CLI tests
│   └── xcontest-sample.json
└── .gitignore             # Caches and generated files
```

## Test

```bash
npm test
```

Node tests run against mocked XContest responses; Python tests use a local fixture, not a live XContest connection. Live API availability must be verified on your own connection.

## Sharing

This folder can be committed directly to a Git repository. No credentials, `.xcontest-cache` data, or generated CSV/JSON exports need to be committed. Before publishing, review whether you want to include a software license and whether your data use is consistent with XContest's terms.
