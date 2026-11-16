"""Reconstruct event points only when the published change confirms them."""
from math import floor, log, sqrt


# Source revisions are pinned because the source replaces arrays after each event.
REVISIONS = (
    ('e5a5e60c7', '08.10.2026', 'Межсезонка · день 1', 'day1Data', 'Day1', 1500, True),
    ('b522e41dd', '15.10.2026', 'Межсезонка · день 2', 'day2Data', 'Day2', 1500, True),
    ('ee3457f96', '22.10.2026', 'Межсезонка · день 3', 'day3Data', 'Day3', 1500, True),
    ('a46330ed3', '24.10.2026', 'Туз Осени 2026', 'previousTournamentResults', 'Day3', 3800, False),
    ('9aa753fc4', '29.10.2026', 'Межсезонка · день 4', 'day4Data', 'Day4', 1500, True),
    ('e73fef1ee', '05.11.2026', '3-9 · день 1', 'day1Data', 'Day1', 750, False),
    ('765749234', '12.11.2026', '3-9 · день 2', 'day2Data', 'Day2', 750, False),
)
SOURCE = 'https://github.com/shurikshilkin/turnir-results'


def load_revisions(read):
    from fetch_site import parse_arrays

    steps = []
    for ref, date, label, table, suffix, k, interseason in REVISIONS:
        data = parse_arrays(read(ref))
        rows = data[table]
        changes = data['ratingAdditionsAfter' + suffix]
        if not rows or {r['name'] for r in rows} != {r['name'] for r in changes}:
            raise ValueError(f'{ref}: таблица участников и рейтинговые дельты расходятся.')
        steps.append(dict(
            date=date, label=label, url=f'{SOURCE}/blob/{ref}/script.js',
            k=k, interseason=interseason, before=data['ratingBeforeFinal'], changes=changes,
            players=[dict(name=r['name'], place=r.get('place', i), extra=r.get('extra', 0))
                     for i, r in enumerate(rows, 1)],
        ))
    return steps


def extend_39(steps, snapshots):
    """Use new 3-9 day snapshots only when results and additions cover the same field."""
    from live_tournaments import tournament_code

    by_day = {}
    for page in snapshots:
        if tournament_code(page['title']) != '3-9' or not (page.get('final_date') or '').endswith('.2026'):
            continue
        for day, changes in page['rating_add'].items():
            day = str(day)
            players = page['days'].get(day, page['days'].get(int(day), []))
            date = page['dates'].get(day, page['dates'].get(int(day)))
            if (int(day) <= 2 or not date or not players or not page['rating_before']
                    or {p['name'] for p in players} != {p['name'] for p in changes}):
                continue
            by_day[int(day)] = dict(
                date=date, label=f'3-9 · день {day}', url=page['source'], k=750,
                interseason=False, before=page['rating_before'], changes=changes,
                players=[dict(name=p['name'], place=i, extra=0)
                         for i, p in enumerate(sorted(players, key=lambda p: -p['total']), 1)],
            )
    return steps + [by_day[day] for day in sorted(by_day)]


def replay(result, steps, normalize, empty_player):
    limit = result['rating_top']
    players = result['players']
    excluded = {}
    first = max(map(int, result['events']), default=0)
    summary = []
    for event, step in enumerate(steps, first + 1):
        before = {normalize(r['name']): r['rating'] for r in step['before']}
        delta = {normalize(r['name']): r['addition'] for r in step['changes']}
        if len(delta) != len(step['changes']) or len(before) != len(step['before']):
            raise ValueError(f"{step['label']}: несколько строк снимка у одного игрока.")
        totals = {name: before.get(name, 0) + delta.get(name, 0)
                  for name in dict.fromkeys([*before, *delta])}
        ranks = {name: i for i, name in enumerate(sorted(totals, key=totals.get, reverse=True), 1)}
        count = len(step['players'])
        details = dict(label=step['label'], date=step['date'], kind='replayed', tid=None,
                       source_url=step['url'], rating_rule=dict(k=step['k'], n=count))
        result['events'][str(event)] = details
        posted = set()
        rejected = []
        for row in step['players']:
            name = normalize(row['name'])
            player = players.setdefault(name, empty_player(name))
            series = player.setdefault('series', [])
            known = sorted((r['pts'] for r in series if r.get('pts', 0) > 0), reverse=True)
            threshold = known[limit - 1] if len(known) >= limit else 0
            divisor = log(row['extra'] / 1000 + 2.718) if step['interseason'] else 1
            points = floor(sqrt(count * step['k'] / row['place']) / divisor + 0.5)
            predicted = max(0, points - threshold)
            reason = excluded.get(name)
            if reason is None and (sum(known[:limit]) != before.get(name, 0) or predicted != delta[name]):
                reason = dict(event=event, expected=predicted, published=delta[name],
                              known_before=sum(known[:limit]), published_before=before.get(name, 0))
                excluded[name] = reason
            record = dict(e=event, rating=totals[name], rank=ranks[name], delta=delta[name])
            if reason is None:
                record['pts'] = points
            else:
                rejected.append(name)
            series.append(record)
            posted.add(name)
        for name, total in totals.items():
            player = players.setdefault(name, empty_player(name))
            if name not in posted and total != player.get('rating_now', 0) and total > 0:
                player.setdefault('series', []).append(dict(e=event, rating=total, rank=ranks[name], snapshot=True))
            player.update(rating_now=total, rating_rank=ranks[name] if total > 0 else None)
        for name in players.keys() - totals.keys():
            if players[name].get('rating_now'):
                players[name].update(rating_now=None, rating_rank=None)
        summary.append(dict(event=event, confirmed=count - len(rejected), disputed=rejected))
    result['rating_replay'] = dict(events=summary, unresolved=excluded)
    return dict(fetched=steps[-1]['date'], label=steps[-1]['label'], url=steps[-1]['url'],
                rating_before=steps[-1]['before'],
                rating_add={'1': steps[-1]['changes']})
