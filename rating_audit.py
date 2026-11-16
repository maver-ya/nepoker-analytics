"""Describe which parts of the published rating can be reproduced."""

INTERSEASON_DAYS = {
    1: ('04.12.2025', 900), 2: ('11.12.2025', 900),
    3: ('18.12.2025', 900), 4: ('25.12.2025', 900),
    14: ('26.02.2026', 900), 15: ('05.03.2026', 900),
    16: ('19.03.2026', 900), 17: ('26.03.2026', 900),
    28: ('21.05.2026', 900), 29: ('28.05.2026', 900),
    30: ('04.06.2026', 1300), 32: ('11.06.2026', 1300),
}
TOURNAMENT_COEFFICIENTS = (350, 550, 750, 1800, 2800, 3800)


def annotate_workbook_events(events, ledger):
    from math import floor, sqrt

    for number, rows in ledger.items():
        details = events.setdefault(str(number), dict(label=f'Событие {number}', kind='other', tid=None))
        count = len(rows)
        if number in INTERSEASON_DAYS:
            date, coefficient = INTERSEASON_DAYS[number]
            details.update(label=f'Межсезонка · {date}', kind='inter_day', date=date,
                           rating_rule=dict(k=coefficient, n=40 if number == 29 else count,
                                            n_inferred=number == 29))
            continue
        scores = sorted((row['pts'] for row in rows.values()), reverse=True)
        for coefficient in TOURNAMENT_COEFFICIENTS:
            if all(floor(sqrt(count * coefficient / place) + 0.5) == points
                   for place, points in enumerate(scores, 1)):
                details['rating_rule'] = dict(k=coefficient, n=count)
                break


def build_rating_audit(result, source=None, normalize=str):
    limit = result['rating_top']
    event_map = result['events']
    before = {normalize(r['name']): r['rating'] for r in (source or {}).get('rating_before', [])}
    deltas = {}
    for rows in (source or {}).get('rating_add', {}).values():
        for row in rows:
            deltas.setdefault(normalize(row['name']), []).append(row['addition'])
    audit = {}
    replay = result.get('rating_replay')
    for name, player in result['players'].items():
        rating = player.get('rating_now')
        if rating is None:
            continue
        points = sorted((r['pts'] for r in player.get('series', [])
                         if r.get('pts', 0) > 0 and event_map[str(r['e'])]['kind'] != 'inter'),
                        reverse=True)
        subtotal = sum(points[:limit])
        rating_delta = deltas.get(name, [])
        audit[name] = dict(
            known_total=subtotal,
            difference=rating - subtotal,
            matches=abs(rating - subtotal) < 0.01 and (
                name not in replay['unresolved'] if replay else not any(rating_delta)),
            source_before=before.get(name),
            source_delta=sum(rating_delta) if rating_delta else None,
        )
    result['rating_audit'] = dict(source_date=(source or {}).get('fetched'),
                                  source_label=(source or {}).get('label'),
                                  source_url=(source or {}).get('url'), players=audit)
