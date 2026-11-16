"""Historical finals and player identities in the same SQLite file as live results."""
import argparse
import json
import sqlite3
from contextlib import closing

from tournament_db import DB

SCHEMA = """
CREATE TABLE IF NOT EXISTS history_players (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS history_aliases (
    alias TEXT PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES history_players(id)
);
CREATE TABLE IF NOT EXISTS history_tournaments (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    details TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history_final_results (
    tournament_id TEXT NOT NULL REFERENCES history_tournaments(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    player_id INTEGER NOT NULL REFERENCES history_players(id),
    place INTEGER NOT NULL,
    details TEXT NOT NULL,
    PRIMARY KEY (tournament_id, position),
    UNIQUE (tournament_id, player_id)
);
CREATE TABLE IF NOT EXISTS history_inputs (
    key TEXT PRIMARY KEY, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history_rating_events (
    id INTEGER PRIMARY KEY, details TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history_rating_results (
    player_id INTEGER REFERENCES history_players(id),
    event_id INTEGER REFERENCES history_rating_events(id),
    points REAL NOT NULL, rating REAL NOT NULL, rank INTEGER,
    PRIMARY KEY (player_id, event_id)
);
CREATE TABLE IF NOT EXISTS history_interseasons (
    id TEXT PRIMARY KEY, details TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history_interseason_sources (
    start TEXT PRIMARY KEY, payload TEXT NOT NULL
);
"""

GENERATED_KEYS = {'tournaments', 'players', 'events', 'interseason', 'attendance',
                  'live_tournaments', 'checks_summary', 'generated', 'player_directory'}


def canonical_name(value, aliases):
    name = str(value).strip()
    seen = set()
    while name in aliases and aliases[name] != name:
        if name in seen:
            raise ValueError(f'Циклический алиас игрока: {value}')
        seen.add(name)
        name = aliases[name]
    return name


def normalize_rows(rows, normalize, context):
    seen = set()
    for row in rows:
        name = normalize(row['name'])
        if name in seen:
            raise ValueError(f'{context}: алиас связывает две строки игрока «{name}». Требуется ручная сверка.')
        row['name'] = name
        seen.add(name)


def save_history(result, aliases, path=DB, current_inter=None):
    live_ids = {t['id'] for t in result.get('live_tournaments', {}).values()}
    tournaments = [t for t in result['tournaments'] if t['id'] not in live_ids]
    names = set(result['players']) | set(aliases.values())
    names.update(r['name'] for t in tournaments for r in t['rows'])
    names.update(p['name'] for p in result.get('interseason', {}).get('alltime', []))
    names.update(result.get('attendance_core', {}).get('pc', {}))
    with closing(sqlite3.connect(path)) as db:
        db.execute('PRAGMA foreign_keys = ON')
        db.executescript(SCHEMA)
        with db:
            db.execute('BEGIN IMMEDIATE')
            db.executemany('INSERT OR IGNORE INTO history_players (name) VALUES (?)',
                           ((name,) for name in sorted(names)))
            ids = dict(db.execute('SELECT name, id FROM history_players'))
            db.executemany('INSERT OR IGNORE INTO history_aliases VALUES (?, ?)',
                           ((alias, ids[name]) for alias, name in sorted(aliases.items())))
            db.execute('DELETE FROM history_tournaments')
            for i, t in enumerate(tournaments):
                details = {k: v for k, v in t.items() if k not in ('id', 'rows', 'live_schedule')}
                db.execute('INSERT INTO history_tournaments VALUES (?, ?, ?)',
                           (t['id'], i, json.dumps(details, ensure_ascii=False)))
                db.executemany('INSERT INTO history_final_results VALUES (?, ?, ?, ?, ?)',
                               ((t['id'], j, ids[r['name']], r['place'],
                                 json.dumps({k: v for k, v in r.items() if k not in ('name', 'place')}, ensure_ascii=False))
                                for j, r in enumerate(t['rows'])))
            inputs = {k: v for k, v in result.items() if k not in GENERATED_KEYS}
            inputs['player_metadata'] = {
                name: {k: p[k] for k in ('passport', 'series', 'rating_now', 'rating_rank') if k in p}
                for name, p in result['players'].items()
                if 'passport' in p or 'series' in p or 'rating_now' in p
            }
            events = {int(k): v for k, v in result['events'].items() if v['kind'] != 'inter'}
            db.execute('DELETE FROM history_rating_results')
            db.execute('DELETE FROM history_rating_events')
            db.executemany('INSERT INTO history_rating_events VALUES (?, ?)',
                           ((e, json.dumps(v, ensure_ascii=False)) for e, v in events.items()))
            for name, p in inputs['player_metadata'].items():
                series = [z for z in p.get('series', []) if z['e'] in events]
                if 'series' in p:
                    p['series'] = []
                if series:
                    p.update(rating_now=series[-1]['rating'], rating_rank=series[-1]['rank'])
                db.executemany('INSERT INTO history_rating_results VALUES (?, ?, ?, ?, ?)',
                               ((ids[name], z['e'], z['pts'], z['rating'], z['rank']) for z in series))
            db.executemany('INSERT OR REPLACE INTO history_inputs VALUES (?, ?)',
                           ((k, json.dumps(v, ensure_ascii=False)) for k, v in inputs.items()))
            _save_interseasons(db, result.get('interseason', {}).get('series', []), current_inter)


def _save_interseasons(db, series, current):
    for item in series:
        details = {k: v for k, v in item.items() if k not in ('standings', 'players_total')}
        db.execute('''
            INSERT INTO history_interseasons VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET details=excluded.details
            WHERE details <> excluded.details
        ''', (item['id'], json.dumps(details, ensure_ascii=False)))
    if current is not None:
        payload = json.dumps(current, ensure_ascii=False)
        db.execute('''
            INSERT INTO history_inputs VALUES ('current_inter', ?)
            ON CONFLICT(key) DO UPDATE SET payload=excluded.payload
            WHERE payload <> excluded.payload
        ''', (payload,))
        day, month, year = current['dates']['1'].split('.')
        db.execute('''
            INSERT INTO history_interseason_sources VALUES (?, ?)
            ON CONFLICT(start) DO UPDATE SET payload=excluded.payload
            WHERE payload <> excluded.payload
        ''', (f'{year}-{month}-{day}', payload))


def save_interseasons(series, current, path=DB):
    with closing(sqlite3.connect(path)) as db, db:
        _save_interseasons(db, series, current)


def load_inputs(path=DB):
    if not path.exists():
        return None
    with closing(sqlite3.connect(path)) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='history_inputs'").fetchone():
            return None
        db.execute('BEGIN')
        inputs = {k: json.loads(v) for k, v in db.execute('SELECT key, payload FROM history_inputs')}
        if not inputs:
            return None
        inputs['events'] = {str(k): json.loads(v) for k, v in db.execute(
            'SELECT id, details FROM history_rating_events ORDER BY id')}
        for name, e, pts, rating, rank in db.execute('''
            SELECT p.name, r.event_id, r.points, r.rating, r.rank
            FROM history_rating_results r JOIN history_players p ON p.id = r.player_id
            ORDER BY r.event_id
        '''):
            inputs['player_metadata'][name].setdefault('series', []).append(
                dict(e=e, pts=pts, rating=rating, rank=rank))
        inputs['interseason_archive'] = [json.loads(v) for v, in db.execute(
            'SELECT details FROM history_interseasons ORDER BY id')]
        sources = (json.loads(v) for v, in db.execute(
            'SELECT payload FROM history_interseason_sources ORDER BY start DESC'))
        inputs['latest_rating_source'] = next((s for s in sources if s.get('rating_add')), None)
        return inputs


def load_history(path=DB):
    if not path.exists():
        return None
    with closing(sqlite3.connect(path)) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='history_tournaments'").fetchone():
            return None
        with db:
            db.execute('BEGIN')
            tournaments = {tid: dict(json.loads(details), id=tid, rows=[])
                           for tid, details in db.execute(
                               'SELECT id, details FROM history_tournaments ORDER BY position')}
            if not tournaments:
                return None
            for tid, name, place, details in db.execute('''
                SELECT r.tournament_id, p.name, r.place, r.details
                FROM history_final_results r
                JOIN history_players p ON p.id = r.player_id
                ORDER BY r.tournament_id, r.position
            '''):
                tournaments[tid]['rows'].append(dict(json.loads(details), name=name, place=place))
            aliases = dict(db.execute('''
                SELECT a.alias, p.name FROM history_aliases a
                JOIN history_players p ON p.id = a.player_id
            '''))
    return list(tournaments.values()), aliases


def add_alias(alias, name, path=DB):
    alias, name = alias.strip(), name.strip()
    if not alias or not name:
        raise ValueError('Алиас и имя должны быть непустыми.')
    with closing(sqlite3.connect(path)) as db, db:
        db.execute('PRAGMA foreign_keys = ON')
        db.execute('BEGIN IMMEDIATE')
        player = db.execute('SELECT id FROM history_players WHERE name=?', (name,)).fetchone()
        if player is None:
            raise ValueError(f'Игрок «{name}» отсутствует в реестре.')
        aliases = dict(db.execute('''
            SELECT a.alias, p.name FROM history_aliases a JOIN history_players p ON p.id = a.player_id
        '''))
        aliases[alias] = name
        canonical_name(alias, aliases)
        db.execute('INSERT OR REPLACE INTO history_aliases VALUES (?, ?)', (alias, player[0]))


if __name__ == '__main__':
    from build_data import ALIAS25, ALIASES

    parser = argparse.ArgumentParser()
    parser.add_argument('--alias', nargs=2, metavar=('ALIAS', 'NAME'))
    args = parser.parse_args()
    if args.alias:
        add_alias(*args.alias)
    else:
        result = json.loads(DB.with_name('data.json').read_text(encoding='utf-8'))
        current = DB.parent.parent / 'interseason' / 'current.json'
        save_history(result, {**ALIASES, **ALIAS25},
                     current_inter=json.loads(current.read_text(encoding='utf-8')) if current.exists() else None)
        tournaments, aliases = load_history()
        print(f'Imported {len(tournaments)} historical tournaments and {len(aliases)} aliases.')
