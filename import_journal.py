"""Summarize public source snapshots and accepted changes for the website."""
from datetime import datetime


def accepted_changes(before, after, old_inter, current_inter):
    changes = []
    for key, card in after.items():
        old = before.get(key, {})
        for day, data in card['schedule'].items():
            players = data.get('players', [])
            if players and players != old.get('schedule', {}).get(day, {}).get('players'):
                changes.append(dict(name=card['title'], day=day, count=len(players)))
        if card['rows'] and card['rows'] != old.get('rows'):
            changes.append(dict(name=card['title'], count=len(card['rows']), final=True))
    if current_inter and current_inter != old_inter:
        applies = old_inter and old_inter['dates'].get('1') == current_inter['dates'].get('1')
        days = old_inter['days'] if applies else {}
        for day, players in current_inter['days'].items():
            if players and players != days.get(day):
                changes.append(dict(name=current_inter['title'], day=day, count=len(players)))
    return changes


def summarize_snapshots(snapshots):
    journal = []
    for source, fetched, page, warnings, accepted in snapshots:
        day_count = {str(k): len(v) for k, v in page.get('days', {}).items() if v}
        journal.append(dict(source=source, fetched=fetched, title=page['title'],
                            days=day_count, final_count=len(page.get('final_rows', [])),
                            archive_title=page.get('previous_title'), archive_count=len(page.get('previous_rows', [])),
                            rating_rows={str(k): len(v) for k, v in page.get('rating_add', {}).items() if v},
                            warnings=warnings, accepted=accepted))
    journal.sort(key=lambda row: datetime.strptime(row['fetched'].split()[0], '%d.%m.%Y').strftime('%Y%m%d')
                 + row['fetched'][10:], reverse=True)
    return journal[:15]
