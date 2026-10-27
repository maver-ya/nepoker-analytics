# -*- coding: utf-8 -*-
"""Быстрое обновление межсезонки без Excel: скачивает данные с сайта результатов и пересобирает data/data.js.
Используется автозапуском на GitHub (.github/workflows/update.yml), локально тоже работает:   python update_site.py
Архив серий, события 1–52 и рейтинговые ряды берутся из уже собранного data/data.json."""
import json, os, sys, datetime
import fetch_site, build_data as bd

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, 'data', 'data.json')


def main():
    fetch_site.main()
    result = json.load(open(P, encoding='utf-8'))
    pl = result['players']
    # убираем прежние межсезонные события и добавки рейтинга
    result['events'] = {k: v for k, v in result['events'].items() if int(k) <= 52}
    for p in pl.values():
        if p.get('series'):
            p['series'] = [z for z in p['series'] if z['e'] <= 52]
            if p['series']:
                p['rating_now'] = p['series'][-1]['rating']
    result['checks'] = [c for c in result['checks'] if not c['text'].startswith(('Рейтинг учитывает межсезонку', 'Текущая межсезонка', 'В текущей межсезонке', 'Рейтинг до межсезонки', 'Похожие ники', 'Нет данных о финальных стеках'))]
    archive = [s for s in result['interseason']['series'] if s.get('status') == 'завершена']
    bd.build_interseason(result, pl, archive)
    bd.attendance_extras(result)
    bd.data_checks(result, {}, pl)
    result['generated'] = datetime.datetime.now().strftime('%d.%m.%Y %H:%M')
    with open(P, 'w', encoding='utf-8') as fh:
        json.dump(result, fh, ensure_ascii=False)
    with open(os.path.join(HERE, 'data', 'data.js'), 'w', encoding='utf-8') as fh:
        fh.write('window.NEPOKER = ' + json.dumps(result, ensure_ascii=False) + ';')
    print('Обновлено:', result['generated'])


if __name__ == '__main__':
    main()
