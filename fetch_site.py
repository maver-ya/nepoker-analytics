# -*- coding: utf-8 -*-
"""Скачивает текущие данные межсезонки с сайта shurikshilkin.github.io/turnir-results и сохраняет в interseason/current.json.
Запуск (из папки site):   python fetch_site.py    затем    python build_data.py
Читается только публичный script.js страницы (данные дня, охота, добавки к рейтингу)."""
import urllib.request, re, json, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'https://shurikshilkin.github.io/turnir-results/'


def get(u):
    req = urllib.request.Request(u, headers={'User-Agent': 'nepoker-analytics'})
    return urllib.request.urlopen(req, timeout=40).read().decode('utf-8')


def parse_arrays(js):
    out = {}
    for m in re.finditer(r'^const\s+(\w+)\s*=\s*\[(.*?)^\];', js, re.M | re.S):
        rows = []
        for o in re.finditer(r'\{(.*?)\}', m.group(2), re.S):
            row = {}
            for k, v in re.findall(r'(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)', o.group(1)):
                row[k] = json.loads(v) if v[0] in '"-0123456789' else (v == 'true')
            if row: rows.append(row)
        out[m.group(1)] = rows
    return out


def main():
    html = get(URL)
    js = get(URL + 'script.js')
    arrays = parse_arrays(js)
    title = re.search(r'<title>(.*?)</title>', html, re.S)
    days = {}
    for k, v in arrays.items():
        m = re.fullmatch(r'day(\d+)Data', k)
        if m: days[int(m.group(1))] = v
    dates = {int(n): d for n, d in re.findall(r'(\d+)\s*день\s*[-–]\s*(\d\d\.\d\d\.\d{4})', html)}
    add = {}
    for k, v in arrays.items():
        m = re.fullmatch(r'ratingAdditionsAfterDay(\d+)', k)
        if m: add[int(m.group(1))] = v
    res = dict(source=URL, fetched=datetime.datetime.now().strftime('%d.%m.%Y %H:%M'), title=(title.group(1).strip() if title else ''),
               dates=dates, days=days, hunting=arrays.get('huntingData', []), rating_before=arrays.get('ratingBeforeFinal', []), rating_add=add)
    os.makedirs(os.path.join(HERE, 'interseason'), exist_ok=True)
    with open(os.path.join(HERE, 'interseason', 'current.json'), 'w', encoding='utf-8') as fh:
        json.dump(res, fh, ensure_ascii=False, indent=1)
    print('Готово:', {k: len(v) for k, v in days.items()}, 'дней с данными; охота:', len(res['hunting']), '; добавки рейтинга:', {k: len(v) for k, v in add.items()})


if __name__ == '__main__':
    main()
