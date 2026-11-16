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


ACE_SEASONS = {'весны': 'spring', 'лета': 'summer', 'осени': 'autumn', 'зимы': 'winter'}


def named_oneday(title):
    match = re.search(r'\bтуз(?:а)?\s+(весны|лета|осени|зимы)\b', title, re.I)
    return match.group(1).casefold() if match else None


def import_named_oneday(result, title, date, rows, count, normalize, today):
    season = named_oneday(title)
    if season is None or not rows:
        return None
    label = 'Туз ' + season.capitalize()
    date = date or next(iter(re.findall(r'\b\d{1,2}\.\d{1,2}\.\d{4}\b', title)), None)
    years = set(map(int, re.findall(r'\b20\d{2}\b', title)))
    if date:
        try:
            years.add(date_key(date).year)
        except ValueError:
            return f'{label}: не удалось прочитать дату протокола.'
    if len(years) != 1:
        return f'{label}: нужен однозначно указанный год протокола.'
    year = years.pop()
    key = f'ace-{ACE_SEASONS[season]}-{year}'
    archive = result.setdefault('live_tournaments', {})
    matches = [t for t in result['tournaments']
               if t['year'] == year and named_oneday(t['title']) == season and t['id'] != 'live-' + key]
    if len(matches) > 1:
        return f'{label} {year}: в архиве несколько подходящих событий.'
    known = matches[0] if matches else archive.get(key)
    if not date:
        date = known['final_date'] if known else None
    if not date or date_key(date) > today or (known and date_key(date) != date_key(known['final_date'])):
        return f'{label} {year}: дата протокола отсутствует или расходится с архивом.'
    expected = count if count is not None else len(known['rows']) if known else None
    if not expected:
        return f'{label} {year}: источник не указал число опубликованных мест.'
    places = final_rows(rows, normalize, expected)
    statuses = [str(r.get('status', '')).casefold() for r in rows]
    winners = [r for r, status in zip(rows, statuses) if status.startswith('победитель')]
    if not places or (any(statuses) and (len(winners) != 1 or winners[0].get('place') != 1
                    or any(status != 'участник турнира' and not status.startswith('победитель')
                           for status in statuses))):
        return f'{label} {year}: протокол не прошёл сверку состава, мест или статусов.'
    if known and sorted((r['place'], normalize(r['name'])) for r in known['rows']) != [
            (r['place'], r['name']) for r in places]:
        return f'{label} {year}: опубликованные места расходятся с архивом.'
    archive[key] = dict(id='live-' + key, year=year, short=known['short'] if known else label,
                        title=known['title'] if known else f'Однодневный турнир Туза {season.capitalize()} {year}',
                        final_date=date, status='Завершён', schedule={}, rows=places)
    return None


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

    for title, date, rows, count in (
        (page['title'], page.get('final_date'), page['final_rows'], page.get('final_count')),
        (page['previous_title'], None, page['previous_rows'], page.get('previous_count')),
    ):
        warning = import_named_oneday(result, title, date, rows, count, normalize, today)
        if warning:
            warnings.append(warning)

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
        if card and card['schedule']:
            tournament['live_schedule'] = card['schedule']
    for card in archive.values():
        season = named_oneday(card['title'])
        matches = [t for t in tournaments if season and t['year'] == card['year']
                   and named_oneday(t['title']) == season]
        if len(matches) == 1:
            matches[0]['source_tournament_id'] = card['id']
        if card['rows'] and not matches and (card['short'], card['year']) not in manual:
            tournaments.append(dict(
                id=card['id'], title=card['title'], short=card['short'], year=card['year'],
                final_date=card['final_date'], nonstandard=False, stack_available=False,
                days=[], rows=card['rows'], finalists=len(card['rows']), rating_event=None,
                live=bool(card['schedule']), live_schedule=card['schedule']))
    result['tournaments'] = sorted(tournaments, key=lambda t: date_key(t['final_date']))
