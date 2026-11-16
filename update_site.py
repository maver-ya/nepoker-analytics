# -*- coding: utf-8 -*-
"""Быстрое обновление межсезонки без Excel: скачивает данные с сайта результатов и пересобирает data/data.js.
Используется автозапуском на GitHub (.github/workflows/update.yml), локально тоже работает:   python update_site.py
Архив серий, события 1–52 и рейтинговые ряды берутся из уже собранного data/data.json."""
import json, os, sys, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
import fetch_site, build_data as bd
from live_tournaments import date_key, ingest, tournament_code
from tournament_db import load_archive, save_archive

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
    page = fetch_site.fetch()
    title = page['title'].strip()
    if title.casefold() == 'межсезонка':
        if not any(page['days'].values()):
            raise ValueError('На странице межсезонки не удалось прочитать результаты дней.')
        fetch_site.save_interseason(page, write_atomic)
    elif not (tournament_code(title) and page['final_date'] and page['dates']):
        raise ValueError(f'Не распознано расписание события «{title}».')
    else:
        date_key(page['final_date'])
        for date in page['dates'].values():
            date_key(date)
    with open(P, encoding='utf-8') as fh:
        previous_data = fh.read()
    result = json.loads(previous_data)
    result['live_tournaments'] = load_archive(result.get('live_tournaments'))
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).date()
    import_warnings = ingest(result, page, bd._norm_name, today)
    old_players = result['players']
    pl = bd.build_player_stats(result)
    for name, player in pl.items():
        player.update({key: value for key, value in old_players.get(name, {}).items()
                       if key not in player})
    result['players'] = pl
    # убираем прежние межсезонные события и добавки рейтинга
    result['events'] = {k: v for k, v in result['events'].items() if int(k) <= 52}
    for p in pl.values():
        if p.get('series'):
            p['series'] = [z for z in p['series'] if z['e'] <= 52]
            if p['series']:
                p['rating_now'] = p['series'][-1]['rating']
    result['checks'] = [c for c in result['checks'] if c.get('source') != 'live_import' and not c['text'].startswith(('Рейтинг учитывает межсезонку', 'Текущая межсезонка', 'В текущей межсезонке', 'Рейтинг до межсезонки', 'Похожие ники', 'Нет данных о финальных стеках'))]
    result['checks'].extend(dict(level='warn', source='live_import', text=w) for w in import_warnings)
    current, _ = bd.load_current_inter()
    archive = [s for s in result['interseason']['series']
               if s.get('status') == 'завершена' and (not current or s['id'] != current['id'])]
    bd.build_interseason(result, pl, archive)
    bd.attendance_extras(result)
    bd.data_checks(result, {}, pl)
    js_path = os.path.join(HERE, 'data', 'data.js')
    save_archive(result['live_tournaments'])
    if json.loads(json.dumps(result)) == json.loads(previous_data):
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
