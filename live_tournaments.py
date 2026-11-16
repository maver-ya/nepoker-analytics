# -*- coding: utf-8 -*-
"""Сохраняет расписание, результаты дней и опубликованные места финала."""
import math
import re
from datetime import datetime

DAY_FIELDS = ('start', 'entry', 'extra', 'exit')


def is_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def day_rows(rows, normalize):
    if not all(isinstance(r.get('name'), str) and r['name'].strip()
               and is_number(r.get('total'))
               and all(is_number(r[k]) for k in DAY_FIELDS if k in r)
               for r in rows):
        return []
    players = [dict(name=normalize(r['name']), total=r['total'],
                    **{k: r[k] for k in DAY_FIELDS if k in r}) for r in rows]
    if len({p['name'] for p in players}) != len(players):
        return []
    return sorted(players, key=lambda p: -p['total'])

def date_key(value):
    return datetime.strptime(value, '%d.%m.%Y').date()


def tournament_code(title):
    match = re.search(r'(?<!\d)(\d+)[-–](\d+)(?!\d)', title)
    return '-'.join(match.groups()) if match else None


def final_rows(rows, normalize, expected_count=None):
    if not rows:
        return []
    if expected_count is None:
        # A mixed tournament table must explicitly distinguish the final field.
        statuses = {str(r.get('status', '')).strip().casefold() for r in rows}
        if statuses != {'участник финала', 'участник турнира'}:
            return []
        rows = [r for r in rows if r['status'].strip().casefold() == 'участник финала']
    elif len(rows) != expected_count:
        return []
    if not all(isinstance(r.get('name'), str) and r['name'].strip()
               and type(r.get('place')) is int for r in rows):
        return []
    rows = sorted(rows, key=lambda r: r['place'])
    names = [normalize(r['name']) for r in rows]
    if (len(rows) < 3 or [r['place'] for r in rows] != list(range(1, len(rows) + 1))
            or len(set(names)) != len(rows)):
        return []
    return [dict(name=n, place=r['place'], stack=None, points=None, visits=None, days=[])
            for n, r in zip(names, rows)]


def ingest(result, page, normalize, today):
    warnings = []
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
                players = day_rows(page['days'].get(day, []), normalize)
                if players and len(players) >= len(schedule.get('players', [])):
                    schedule['players'] = players
                elif page['days'].get(day) or schedule.get('players'):
                    warnings.append(f'{code}, день {day}: получена неполная или некорректная таблица.')
            rows = final_rows(page['final_rows'], normalize, page.get('final_count'))
            if rows and date_key(final_date) <= today and len(rows) >= len(card['rows']):
                card['rows'] = rows
            elif page['final_rows']:
                warnings.append(f'{code}: финальный протокол не прошёл проверку даты, состава или мест.')

    previous_code = tournament_code(page['previous_title'])
    if previous_code and re.search(r'турнир', page['previous_title'], re.I):
        pending = [t for t in archive.values() if t['short'] == previous_code
                   and date_key(t['final_date']) <= today]
        if len(pending) == 1:
            # Общая турнирная таблица пригодна только с явными статусами финала.
            previous = page['previous_rows']
            rows = final_rows(previous, normalize)
            if rows and len(rows) >= len(pending[0]['rows']):
                pending[0]['rows'] = rows
            elif previous and not pending[0]['rows']:
                warnings.append(f'{previous_code}: в архиве источника нет подтверждённого протокола финала.')

    for card in archive.values():
        card['status'] = ('Завершён' if card['rows'] else
                          'Ожидаем итоги' if today > date_key(card['final_date']) else 'Идёт отбор')
    merge_completed(result)
    return warnings


def merge_completed(result):
    archive = result.get('live_tournaments', {})
    automatic_ids = {t['id'] for t in archive.values()}
    tournaments = [t for t in result['tournaments'] if t['id'] not in automatic_ids]
    manual = {(t['short'], t['year']) for t in tournaments}
    for tournament in tournaments:
        card = archive.get(f"{tournament['short']}-{tournament['year']}")
        if card:
            tournament['live_schedule'] = card['schedule']
    for card in archive.values():
        if card['rows'] and (card['short'], card['year']) not in manual:
            tournaments.append(dict(
                id=card['id'], title=card['title'], short=card['short'], year=card['year'],
                final_date=card['final_date'], nonstandard=False, stack_available=False,
                days=[], rows=card['rows'], finalists=len(card['rows']), rating_event=None,
                live=True, live_schedule=card['schedule']))
    result['tournaments'] = sorted(tournaments, key=lambda t: date_key(t['final_date']))
