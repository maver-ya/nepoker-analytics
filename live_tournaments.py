# -*- coding: utf-8 -*-
"""Сохраняет расписание, результаты дней и опубликованные места финала."""
import re
from datetime import datetime


def date_key(value):
    return datetime.strptime(value, '%d.%m.%Y').date()


def tournament_code(title):
    match = re.search(r'(?<!\d)(\d+)[-–](\d+)(?!\d)', title)
    return '-'.join(match.groups()) if match else None


def final_rows(rows, normalize):
    if not rows or not all(isinstance(r.get('name'), str) and r['name'].strip()
                           and type(r.get('place')) is int for r in rows):
        return []
    rows = sorted(rows, key=lambda r: r['place'])
    if [r['place'] for r in rows] != list(range(1, len(rows) + 1)):
        return []
    if any(r.get('status') == 'Участник турнира' for r in rows):
        rows = [r for r in rows if r.get('status') != 'Участник турнира']
    names = [normalize(r['name']) for r in rows]
    if ([r['place'] for r in rows] != list(range(1, len(rows) + 1))
            or not rows or len(set(names)) != len(rows)):
        return []
    return [dict(name=n, place=r['place'], stack=None, points=None, visits=None, days=[])
            for n, r in zip(names, rows)]


def ingest(result, page, normalize, today):
    archive = result.setdefault('live_tournaments', {})
    title = page['title']
    code = tournament_code(title)
    final_date = page.get('final_date')
    if code and final_date and page['dates']:
        year = date_key(final_date).year
        existing = next((t for t in result['tournaments']
                         if t['year'] == year and t['short'] == code), None)
        key = f'{code}-{year}'
        if existing is None or key in archive:
            card = archive.setdefault(key, dict(id='live-' + key, year=year,
                                               short=code, schedule={}, rows=[]))
            card.update(title=title, final_date=final_date)
            for day, date in page['dates'].items():
                schedule = card['schedule'].setdefault(str(day), {})
                schedule['date'] = date
                players = page['days'].get(day, [])
                if players and all('name' in p and 'total' in p for p in players):
                    schedule['players'] = sorted(
                        (dict(name=normalize(p['name']), total=p['total']) for p in players),
                        key=lambda p: -p['total'])
            rows = final_rows(page['final_rows'], normalize)
            if rows:
                card['rows'] = rows

    previous_code = tournament_code(page['previous_title'])
    if previous_code and re.search(r'турнир', page['previous_title'], re.I):
        pending = [t for t in archive.values() if t['short'] == previous_code
                   and date_key(t['final_date']) <= today]
        if len(pending) == 1:
            # Общая турнирная таблица пригодна только с явными статусами финала.
            previous = page['previous_rows']
            if previous and all(r.get('status') for r in previous) and any(
                    r.get('status') == 'Участник финала' for r in previous):
                rows = final_rows(previous, normalize)
                if rows:
                    pending[0]['rows'] = rows

    for card in archive.values():
        card['status'] = ('Завершён' if card['rows'] else
                          'Ожидаем итоги' if today > date_key(card['final_date']) else 'Идёт отбор')
    merge_completed(result)


def merge_completed(result):
    archive = result.get('live_tournaments', {})
    automatic_ids = {t['id'] for t in archive.values()}
    tournaments = [t for t in result['tournaments'] if t['id'] not in automatic_ids]
    manual = {(t['short'], t['year']) for t in tournaments}
    for card in archive.values():
        if card['rows'] and (card['short'], card['year']) not in manual:
            tournaments.append(dict(
                id=card['id'], title=card['title'], short=card['short'], year=card['year'],
                final_date=card['final_date'], nonstandard=False, stack_available=False,
                days=[], rows=card['rows'], finalists=len(card['rows']), rating_event=None,
                live=True, live_schedule=card['schedule']))
    result['tournaments'] = sorted(tournaments, key=lambda t: date_key(t['final_date']))
