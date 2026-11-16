"""Describe which parts of the published rating can be reproduced."""


def build_rating_audit(result, source=None, normalize=str):
    limit = result['rating_top']
    event_map = result['events']
    before = {normalize(r['name']): r['rating'] for r in (source or {}).get('rating_before', [])}
    deltas = {}
    for rows in (source or {}).get('rating_add', {}).values():
        for row in rows:
            deltas.setdefault(normalize(row['name']), []).append(row['addition'])
    audit = {}
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
            matches=abs(rating - subtotal) < 0.01 and not any(rating_delta),
            source_before=before.get(name),
            source_delta=sum(rating_delta) if rating_delta else None,
        )
    result['rating_audit'] = dict(source_date=(source or {}).get('fetched'), players=audit)
