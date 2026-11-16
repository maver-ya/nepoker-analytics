"""Check public data consistency before publishing an automatic update."""
import json
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check(result):
    directory = result['player_directory']['ids']
    finals = {t['id']: t for t in result['tournaments']}
    require(len(finals) == len(result['tournaments']), 'Повторяющиеся ID финалов.')
    attendance = result['attendance']['recent']
    cutoff = result['attendance_core'].get('cutoff')
    require({name for name, p in result['players'].items() if p.get('rating_now')} <= directory.keys(),
            'В рейтинге есть игрок без ID.')
    for name, audit in result.get('rating_audit', {}).get('players', {}).items():
        rating = result['players'][name]['rating_now']
        require(abs(rating - audit['known_total'] - audit['difference']) < 0.01,
                f'Сверка рейтинга игрока «{name}» расходится с выгрузкой.')
        if audit['matches']:
            require(abs(audit['difference']) < 0.01, f'Неподтверждённый рейтинг игрока «{name}» отмечен как сверенный.')
    for card in result['live_tournaments'].values():
        entrants = {r['name'] for r in card['rows']}
        dates = [card['final_date']] if entrants else []
        for number, day in card['schedule'].items():
            players = day.get('players', [])
            names = {p['name'] for p in players}
            require(len(names) == len(players), f"{card['short']}, день {number}: дубли игроков.")
            entrants.update(names)
            if players:
                dates.append(day['date'])
        require(entrants <= directory.keys(), f"{card['short']}: участник без ID.")
        archive = next((t for t in finals.values()
                        if t.get('source_tournament_id') == card['id']
                        or (t['short'], t['year']) == (card['short'], card['year'])), None)
        if card['rows']:
            require(archive is not None, f"{card['short']}: финал отсутствует в архиве.")
        if archive is not None and card['schedule']:
            require(archive.get('live_schedule') == card['schedule'],
                    f"{card['short']}: архивная карточка потеряла отборочные дни.")
        date_order = lambda value: tuple(map(int, reversed(value.split('.'))))
        if cutoff and dates and min(map(date_order, dates)) > date_order(cutoff):
            tid = archive['id'] if archive else card['id']
            for name in entrants:
                count = sum(e['id'] == tid for e in attendance.get(name, []))
                require(count == 1, f"{card['short']}: неверное число событий посещаемости у «{name}».")


if __name__ == '__main__':
    folder = Path(__file__).with_name('data')
    payload = (folder / 'data.json').read_text(encoding='utf-8')
    require((folder / 'data.js').read_text(encoding='utf-8') == 'window.NEPOKER = ' + payload + ';',
            'Выгрузки JSON и JavaScript расходятся.')
    check(json.loads(payload))
    print('Выгрузка прошла проверки.')
