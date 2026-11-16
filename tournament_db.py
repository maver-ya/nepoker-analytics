"""SQLite storage for tournaments collected from the results site."""
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from live_tournaments import DAY_FIELDS

DB = Path(__file__).with_name('data') / 'tournaments.sqlite3'

SCHEMA = """
CREATE TABLE IF NOT EXISTS history_players (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS import_snapshots (
    id INTEGER PRIMARY KEY, source TEXT NOT NULL, fetched TEXT NOT NULL,
    digest TEXT NOT NULL, payload TEXT NOT NULL, warnings TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tournaments (
    key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, year INTEGER NOT NULL,
    short TEXT NOT NULL, title TEXT NOT NULL, final_date TEXT NOT NULL,
    status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS game_days (
    tournament TEXT REFERENCES tournaments(key) ON DELETE CASCADE,
    day INTEGER, date TEXT NOT NULL, PRIMARY KEY (tournament, day)
);
CREATE TABLE IF NOT EXISTS day_results (
    tournament TEXT, day INTEGER, position INTEGER, player TEXT NOT NULL,
    total REAL NOT NULL, PRIMARY KEY (tournament, day, position),
    FOREIGN KEY (tournament, day) REFERENCES game_days(tournament, day) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS final_results (
    tournament TEXT REFERENCES tournaments(key) ON DELETE CASCADE,
    place INTEGER, player TEXT NOT NULL, PRIMARY KEY (tournament, place)
);
"""


def _read(db):
    archive = {}
    for row in db.execute('SELECT * FROM tournaments ORDER BY key'):
        card = dict(row)
        key = card.pop('key')
        archive[key] = dict(card, schedule={}, rows=[])
    for key, day, date in db.execute('SELECT * FROM game_days ORDER BY tournament, day'):
        archive[key]['schedule'][str(day)] = dict(date=date)
    identities = (dict(db.execute('SELECT id, name FROM history_players'))
                  if db.execute("SELECT 1 FROM sqlite_master WHERE name='history_players'").fetchone()
                  else {})
    for row in db.execute(
            'SELECT * FROM day_results ORDER BY tournament, day, position'):
        values = dict(row)
        player = dict(name=identities.get(values.get('player_id'), row['player']), total=row['total'],
                      **{k: values[k] for k in DAY_FIELDS if values.get(k) is not None})
        archive[row['tournament']]['schedule'][str(row['day'])].setdefault('players', []).append(player)
    for row in db.execute('SELECT * FROM final_results ORDER BY tournament, place'):
        player = identities.get(dict(row).get('player_id'), row['player'])
        archive[row['tournament']]['rows'].append(
            dict(name=player, place=row['place'], stack=None, points=None, visits=None, days=[]))
    return archive


def load_archive(fallback=None, path=DB):
    if not path.exists():
        return fallback if fallback is not None else {}
    with closing(sqlite3.connect(path)) as db:
        db.row_factory = sqlite3.Row
        return _read(db)


def save_archive(archive, path=DB, snapshot=None, warnings=(), additional_players=()):
    with closing(sqlite3.connect(path)) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys = ON')
        db.executescript(SCHEMA)
        with db:
            db.execute('BEGIN IMMEDIATE')
            columns = {row['name'] for row in db.execute('PRAGMA table_info(day_results)')}
            for field in DAY_FIELDS:
                if field not in columns:
                    db.execute(f'ALTER TABLE day_results ADD COLUMN "{field}" REAL')
            for table in ('day_results', 'final_results'):
                if 'player_id' not in {row['name'] for row in db.execute(f'PRAGMA table_info({table})')}:
                    db.execute(f'ALTER TABLE {table} ADD COLUMN player_id INTEGER REFERENCES history_players(id)')
            names = {p['name'] for t in archive.values() for d in t['schedule'].values()
                     for p in d.get('players', [])}
            names.update(r['name'] for t in archive.values() for r in t['rows'])
            names.update(additional_players)
            db.executemany('INSERT OR IGNORE INTO history_players(name) VALUES (?)',
                           ((name,) for name in sorted(names)))
            identities = dict(db.execute('SELECT name, id FROM history_players'))
            unlinked = set()
            for table in ('day_results', 'final_results'):
                unlinked.update(row[0] for row in db.execute(
                    f'SELECT DISTINCT tournament FROM {table} WHERE player_id IS NULL'))
            previous = _read(db)
            for key in previous.keys() - archive.keys():
                db.execute('DELETE FROM tournaments WHERE key = ?', (key,))
            for key, card in archive.items():
                if previous.get(key) == card and key not in unlinked:
                    continue
                db.execute('DELETE FROM tournaments WHERE key = ?', (key,))
                db.execute('INSERT INTO tournaments VALUES (?, ?, ?, ?, ?, ?, ?)',
                           (key, card['id'], card['year'], card['short'], card['title'],
                            card['final_date'], card['status']))
                for day, data in card['schedule'].items():
                    db.execute('INSERT INTO game_days VALUES (?, ?, ?)', (key, day, data['date']))
                    db.executemany('''INSERT INTO day_results
                                   (tournament, day, position, player, total, start, entry, extra, exit, player_id)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                                   ((key, day, i, p['name'], p['total'], *(p.get(k) for k in DAY_FIELDS),
                                     identities[p['name']])
                                    for i, p in enumerate(data.get('players', []), 1)))
                db.executemany('INSERT INTO final_results (tournament, place, player, player_id) VALUES (?, ?, ?, ?)',
                               ((key, r['place'], r['name'], identities[r['name']]) for r in card['rows']))
            if snapshot is not None:
                payload = json.dumps({k: v for k, v in snapshot.items() if k != 'fetched'},
                                     ensure_ascii=False, sort_keys=True)
                digest = hashlib.sha256(payload.encode('utf-8')).hexdigest()
                source = snapshot['source']
                last = db.execute('SELECT digest FROM import_snapshots WHERE source=? ORDER BY id DESC LIMIT 1',
                                  (source,)).fetchone()
                if last is None or last['digest'] != digest:
                    db.execute('INSERT INTO import_snapshots (source, fetched, digest, payload, warnings) VALUES (?, ?, ?, ?, ?)',
                               (source, snapshot['fetched'], digest, payload, json.dumps(warnings, ensure_ascii=False)))


def player_ids(path=DB):
    with closing(sqlite3.connect(path)) as db:
        return dict(db.execute('SELECT name, id FROM history_players'))


def rating_snapshots(path=DB):
    with closing(sqlite3.connect(path)) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='import_snapshots'").fetchone():
            return []
        return [json.loads(payload) for (payload,) in db.execute(
            "SELECT payload FROM import_snapshots WHERE json_extract(payload, '$.title') LIKE '%3-9%' ORDER BY id")]
