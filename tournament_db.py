"""SQLite storage for tournaments collected from the results site."""
import sqlite3
from contextlib import closing
from pathlib import Path
from live_tournaments import DAY_FIELDS

DB = Path(__file__).with_name('data') / 'tournaments.sqlite3'

SCHEMA = """
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
    for row in db.execute(
            'SELECT * FROM day_results ORDER BY tournament, day, position'):
        values = dict(row)
        player = dict(name=row['player'], total=row['total'],
                      **{k: values[k] for k in DAY_FIELDS if values.get(k) is not None})
        archive[row['tournament']]['schedule'][str(row['day'])].setdefault('players', []).append(player)
    for key, place, player in db.execute('SELECT * FROM final_results ORDER BY tournament, place'):
        archive[key]['rows'].append(
            dict(name=player, place=place, stack=None, points=None, visits=None, days=[]))
    return archive


def load_archive(fallback=None, path=DB):
    if not path.exists():
        return fallback if fallback is not None else {}
    with closing(sqlite3.connect(path)) as db:
        db.row_factory = sqlite3.Row
        return _read(db)


def save_archive(archive, path=DB):
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
            previous = _read(db)
            for key in previous.keys() - archive.keys():
                db.execute('DELETE FROM tournaments WHERE key = ?', (key,))
            for key, card in archive.items():
                if previous.get(key) == card:
                    continue
                db.execute('DELETE FROM tournaments WHERE key = ?', (key,))
                db.execute('INSERT INTO tournaments VALUES (?, ?, ?, ?, ?, ?, ?)',
                           (key, card['id'], card['year'], card['short'], card['title'],
                            card['final_date'], card['status']))
                for day, data in card['schedule'].items():
                    db.execute('INSERT INTO game_days VALUES (?, ?, ?)', (key, day, data['date']))
                    db.executemany('''INSERT INTO day_results
                                   (tournament, day, position, player, total, start, entry, extra, exit)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                                   ((key, day, i, p['name'], p['total'], *(p.get(k) for k in DAY_FIELDS))
                                    for i, p in enumerate(data.get('players', []), 1)))
                db.executemany('INSERT INTO final_results VALUES (?, ?, ?)',
                               ((key, r['place'], r['name']) for r in card['rows']))
