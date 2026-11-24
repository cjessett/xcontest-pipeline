#!/usr/bin/env python3
"""Paced, resumable XContest scrape using the existing local Flight Viewer.

Start the Flight Viewer in another terminal:
    node server.mjs

Example:
    python3 xcontest_paced.py 2025-12-01 2025-12-31 --delay 30 --jitter 10

--delay is a minimum number of seconds between date requests to the viewer.
Each viewer date request itself fetches the four configured launch sites.
Successful days are cached to avoid re-fetching them in future runs.

No login, proxy rotation, or attempts to bypass XContest access denials.
"""
import argparse
import csv
import datetime as dt
import json
import random
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

FIELDS = (
    'date', 'site', 'id', 'pilot', 'username', 'start', 'duration',
    'distanceKm', 'points', 'routeType', 'avgSpeedKmh', 'glider', 'url'
)
DENIED_RE = re.compile(r'Access forbidden for remote IP|HTTP\s*403|\bforbidden\b', re.I)
RATE_RE = re.compile(r'HTTP\s*429|Too Many Requests|rate.limit', re.I)


def parse_day(value):
    try:
        d = dt.date.fromisoformat(value)
        if d.isoformat() != value:
            raise ValueError(value)
        return d
    except ValueError as exc:
        raise argparse.ArgumentTypeError('Expected YYYY-MM-DD') from exc


def fetch_date(base_url, day, timeout):
    url = base_url.rstrip('/') + '/api/flights?date=' + quote(day)
    req = Request(url, headers={'Accept': 'application/json'})
    try:
        with urlopen(req, timeout=timeout) as res:
            data = json.load(res)
    except HTTPError as exc:
        raise RuntimeError(f'Local viewer HTTP {exc.code}') from exc
    except URLError as exc:
        raise RuntimeError(f'Cannot connect to local viewer: {exc.reason}') from exc
    if not isinstance(data, dict) or data.get('date') != day or not isinstance(data.get('sites'), list):
        raise RuntimeError('Malformed local viewer response')
    if len(data['sites']) == 0:
        raise RuntimeError('No site results in local viewer response')
    if not isinstance(data.get('flights'), list):
        raise RuntimeError('Malformed flight list in local viewer response')
    return data


def write_exports(path_prefix, start, end, days, failures):
    flights = []
    for day in days:
        flights.extend(day['flights'])
    flights.sort(key=lambda f: (f.get('date', ''), f.get('site', ''), -(f.get('points') or 0)))
    payload = {'startDate': start, 'endDate': end,
               'completedDates': [d['date'] for d in days],
               'flights': flights, 'failures': failures, 'days': days}
    prefix = Path(path_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    (prefix.parent / (prefix.name + '.json')).write_text(json.dumps(payload, indent=2), encoding='utf-8')
    with (prefix.parent / (prefix.name + '.csv')).open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(flights)
    return len(flights)


def main(argv=None, *, fetcher=fetch_date, sleeper=time.sleep, jitterer=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('start', type=parse_day)
    parser.add_argument('end', type=parse_day, nargs='?')
    parser.add_argument('--base-url', default='http://127.0.0.1:8787')
    parser.add_argument('--delay', type=float, default=30.0, help='Minimum seconds between date requests (default 30)')
    parser.add_argument('--jitter', type=float, default=10.0, help='Additional random 0..N seconds (default 10)')
    parser.add_argument('--max-days', type=int, default=None, help='Stop after fetching at most N uncached days')
    parser.add_argument('--cache', default='.xcontest-cache', help='Directory of successful daily responses')
    parser.add_argument('--output', default=None, help='Output filename prefix')
    parser.add_argument('--timeout', type=float, default=120.0)
    args = parser.parse_args(argv)
    end = args.end or args.start
    if end < args.start or (end - args.start).days > 365:
        parser.error('Date range must be ordered and at most 366 days')
    if args.delay < 0 or args.jitter < 0 or args.timeout <= 0:
        parser.error('Delay and jitter must be nonnegative, timeout positive')
    if args.max_days is not None and args.max_days < 1:
        parser.error('--max-days must be >= 1')

    start_str, end_str = args.start.isoformat(), end.isoformat()
    prefix = args.output or f'xcontest_{start_str}' + (f'_to_{end_str}' if end_str != start_str else '')
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    failures, days = [], []
    sent = 0
    jitterer = jitterer or random.uniform
    stopped = False
    for offset in range((end - args.start).days + 1):
        day = (args.start + dt.timedelta(days=offset)).isoformat()
        cache_file = cache / f'{day}.json'
        cached = False
        if cache_file.exists():
            try:
                data = json.loads(cache_file.read_text(encoding='utf-8'))
                cached = data.get('date') == day and isinstance(data.get('sites'), list) and isinstance(data.get('flights'), list) and all(s.get('status') == 'ok' for s in data['sites'])
            except (ValueError, OSError):
                cached = False
        if not cached:
            if args.max_days is not None and sent >= args.max_days:
                print('Reached --max-days; remaining dates are not yet checked.', file=sys.stderr)
                break
            if sent:
                delay = args.delay + jitterer(0, args.jitter)
                print(f'Sleeping {delay:.1f}s before next date...', file=sys.stderr)
                sleeper(delay)
            try:
                data = fetcher(args.base_url, day, args.timeout)
            except (RuntimeError, OSError, ValueError) as exc:
                failures.append({'date': day, 'type': 'request_error', 'error': str(exc)})
                print(f'{day}: ERROR {exc} — stopping', file=sys.stderr)
                stopped = True
                break
            sent += 1
        site_errors = [f"{s.get('name')}: {s.get('error', 'unknown error')}" for s in data['sites'] if s.get('status') != 'ok']
        if site_errors:
            summary = ' | '.join(site_errors)
            typ = 'access_denied' if DENIED_RE.search(summary) else ('rate_limited' if RATE_RE.search(summary) else 'site_error')
            failures.append({'date': day, 'type': typ, 'error': summary})
            print(f'{day}: {typ.upper()}: {summary}', file=sys.stderr)
            # Do not cache incomplete dates as if they were complete.
            # Stop on any site error to avoid uncontrolled retries.
            stopped = True
            break
        days.append(data)
        if not cached:
            cache_file.write_text(json.dumps(data, indent=2), encoding='utf-8')
        print(f"{day}: {len(data['flights'])} flights" + (' (cache)' if cached else ' (fetched)'), file=sys.stderr)

    n = write_exports(prefix, start_str, end_str, days, failures)
    print(f'Saved {n} flights across {len(days)} successful dates: {prefix}.csv / {prefix}.json')
    if stopped:
        print('Stopped on a failure. Successful days are cached; rerun to resume once access is available.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
