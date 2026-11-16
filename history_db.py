"""Historical finals and player identities in the same SQLite file as live results."""
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
"""


def save_history(result, aliases, path=DB):
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
            db.execute('DELETE FROM history_aliases')
            db.executemany('INSERT INTO history_aliases VALUES (?, ?)',
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


if __name__ == '__main__':
    from build_data import ALIAS25, ALIASES

    result = json.loads(DB.with_name('data.json').read_text(encoding='utf-8'))
    save_history(result, {**ALIASES, **ALIAS25})
    tournaments, aliases = load_history()
    print(f'Imported {len(tournaments)} historical tournaments and {len(aliases)} aliases.')
