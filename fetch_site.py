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
    for m in re.finditer(r'^const[ \t]+(\w+)[ \t]*=[ \t]*\[(.*?)\][ \t]*;', js, re.M | re.S):
        rows = []
        for o in re.finditer(r'\{(.*?)\}', m.group(2), re.S):
            row = {}
            for k, v in re.findall(r'(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)', o.group(1)):
                row[k] = json.loads(v) if v[0] in '"-0123456789' else (v == 'true')
            if row: rows.append(row)
        if not rows and re.fullmatch(r'\s*(?:"(?:[^"\\]|\\.)*"\s*,?\s*)+', m.group(2)):
            rows = [dict(name=json.loads(v), place=i) for i, v in enumerate(
                re.findall(r'"(?:[^"\\]|\\.)*"', m.group(2)), 1)]
        out[m.group(1)] = rows
    return out


def parse_page(html, js):
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
    final = re.search(r"showTab\('final'\)[^>]*>\s*Финал\s*[-–]\s*(\d{1,2}\.\d{1,2}\.\d{4})", html, re.I)
    previous = re.search(r"showTab\('previousResults'\)[^>]*>([^<]+)", html)
    res.update(final_date=final.group(1) if final else None,
               final_rows=arrays.get('finalResults', []),
               previous_title=previous.group(1).strip() if previous else '',
               previous_rows=arrays.get('previousTournamentResults', []))
    return res


def fetch():
    return parse_page(get(URL), get(URL + 'script.js'))


def save_interseason(res):
    snapshot = {k: res[k] for k in ('source', 'fetched', 'title', 'dates', 'days', 'hunting', 'rating_before', 'rating_add')}
    os.makedirs(os.path.join(HERE, 'interseason'), exist_ok=True)
    with open(os.path.join(HERE, 'interseason', 'current.json'), 'w', encoding='utf-8') as fh:
        json.dump(snapshot, fh, ensure_ascii=False, indent=1)


def main():
    res = fetch()
    if res['title'].strip().casefold() == 'межсезонка' and any(res['days'].values()):
        save_interseason(res)
    print(res['title'], {k: len(v) for k, v in res['days'].items()})


if __name__ == '__main__':
    main()
