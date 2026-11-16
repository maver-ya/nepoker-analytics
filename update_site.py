# -*- coding: utf-8 -*-
"""Обновляет турниры и межсезонку с сайта результатов и пересобирает data/data.js.
Используется автозапуском на GitHub (.github/workflows/update.yml), локально тоже работает:   python update_site.py
При наличии мигрированной базы выгрузка целиком пересобирается из SQLite."""
import json, os, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
import fetch_site, build_data as bd
from history_db import canonical_name, load_history, load_inputs, normalize_rows, save_interseasons
from live_tournaments import date_key, ingest, named_oneday, tournament_code
from tournament_db import load_archive, player_ids, rating_snapshots, save_archive
from rating_audit import build_rating_audit
from rating_replay import extend_39, replay

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, 'data', 'data.json')


def write_atomic(path, content):
    with NamedTemporaryFile(mode='w', encoding='utf-8', dir=os.path.dirname(path),
                            delete=False) as fh:
        temporary = fh.name
        try:
            fh.write(content)
            fh.close()
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def main():
    inputs = load_inputs()
    rating_replay = inputs.pop('rating_replay_steps', []) if inputs is not None else []
    page = fetch_site.fetch()
    title = page['title'].strip()
    current_source = inputs.pop('current_inter', None) if inputs is not None else None
    rating_source = inputs.pop('latest_rating_source') if inputs is not None else None
    if title.casefold() == 'межсезонка':
        if not any(page['days'].values()) or not page['dates'].get(1):
            raise ValueError('На странице межсезонки не удалось прочитать результаты дней.')
        for date in page['dates'].values():
            date_key(date)
        if inputs is None:
            fetch_site.save_interseason(page, write_atomic)
        else:
            current_source = fetch_site.interseason_snapshot(page, current_source)
            if current_source['rating_add']:
                rating_source = current_source
    elif named_oneday(title):
        pass  # Its protocol has its own validation in ingest.
    elif not (tournament_code(title) and page['final_date'] and page['dates']):
        raise ValueError(f'Не распознано расписание события «{title}».')
    else:
        date_key(page['final_date'])
        for date in page['dates'].values():
            date_key(date)
    previous_data = Path(P).read_text(encoding='utf-8') if os.path.isfile(P) else '{}'
    previous = json.loads(previous_data)
    if inputs is None and not previous:
        raise ValueError('Для сборки необходима мигрированная база или прежняя выгрузка.')
    result = inputs if inputs is not None else dict(previous)
    result['live_tournaments'] = load_archive(previous.get('live_tournaments'))
    history = load_history()
    aliases = {**bd.ALIASES, **bd.ALIAS25}
    if history is not None:
        result['tournaments'], aliases = history

    def normalize(name):
        return canonical_name(name, aliases)

    for t in result['tournaments']:
        normalize_rows(t['rows'], normalize, t['title'])
    for t in result['live_tournaments'].values():
        normalize_rows(t['rows'], normalize, t['title'])
        for day, data in t['schedule'].items():
            normalize_rows(data.get('players', []), normalize, f"{t['title']}, день {day}")
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).date()
    import_warnings = ingest(result, page, normalize, today)
    bd.mark_estimated_stacks(result)
    old_players = result.pop('player_metadata', None) if inputs is not None else previous['players']
    metadata = {}
    for name, player in old_players.items():
        target = normalize(name)
        if target in metadata:
            raise ValueError(f'Алиасы связывают две истории рейтинга игрока «{target}». Требуется ручная сверка.')
        metadata[target] = player
    pl = bd.build_player_stats(result)
    for name, player in metadata.items():
        if player.get('series') or player.get('rating_now'):
            pl.setdefault(name, bd.empty_player(name))
    for name, player in pl.items():
        player.update({key: value for key, value in metadata.get(name, {}).items()
                       if key not in player})
    result['players'] = pl
    # убираем прежние межсезонные события и добавки рейтинга
    if inputs is None:
        result['events'] = {k: v for k, v in result['events'].items() if v['kind'] not in ('inter', 'replayed')}
        for p in pl.values():
            if p.get('series'):
                p['series'] = [z for z in p['series'] if str(z['e']) in result['events']]
                if p['series']:
                    p['rating_now'] = p['series'][-1]['rating']
    result['checks'] = [c for c in result['checks'] if c.get('source') != 'live_import' and not c['text'].startswith(('Рейтинг учитывает межсезонку', 'Текущая межсезонка', 'В текущей межсезонке', 'Рейтинг до межсезонки', 'Похожие ники', 'Нет данных о финальных стеках'))]
    result['checks'].extend(dict(level='warn', source='live_import', text=w) for w in import_warnings)
    if inputs is not None:
        current = bd.parse_current_inter(current_source, normalize)
        archive = result.pop('interseason_archive')
    else:
        current = bd.load_current_inter()
        archive = previous['interseason']['series']
    for series in archive:
        for day in series['days']:
            normalize_rows(day['players'], normalize, f"{series['title']}, день {day['n']}")
    bd.build_interseason(result, pl, archive, current, normalize, rating_source,
                        apply_rating=not rating_replay)
    audit_source = rating_source or current[1]
    if rating_replay:
        steps = extend_39(rating_replay, [*rating_snapshots(), page])
        audit_source = replay(result, steps, normalize, bd.empty_player)
    build_rating_audit(result, audit_source, normalize)
    bd.attendance_extras(result)
    bd.data_checks(result, {}, pl, (current[0], rating_source or current[1]), normalize)
    js_path = os.path.join(HERE, 'data', 'data.js')
    save_archive(result['live_tournaments'], snapshot=page, warnings=import_warnings,
                 additional_players=pl)
    result['player_directory'] = dict(ids=player_ids(), aliases=aliases)
    if inputs is not None:
        save_interseasons(result['interseason']['series'], current_source)
    published = {k: v for k, v in previous.items() if k != 'generated'}
    result.pop('generated', None)
    if json.loads(json.dumps(result)) == published:
        payload = 'window.NEPOKER = ' + previous_data + ';'
        if not os.path.isfile(js_path) or Path(js_path).read_text(encoding='utf-8') != payload:
            write_atomic(js_path, payload)
        print('Данные источника не изменились.')
        return
    result['generated'] = datetime.datetime.now().strftime('%d.%m.%Y %H:%M')
    payload = json.dumps(result, ensure_ascii=False)
    write_atomic(P, payload)
    write_atomic(js_path, 'window.NEPOKER = ' + payload + ';')
    print('Обновлено:', result['generated'])


if __name__ == '__main__':
    main()
