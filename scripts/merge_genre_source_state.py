#!/usr/bin/env python3
"""Merge independently generated AWEN genre hints on top of newest main."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def load(path, default):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except FileNotFoundError:
        return default

def save(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def main():
    folder = Path(sys.argv[1])
    current = load(ROOT / 'awen-genre-sources.json', {'schema_version': 1, 'tracks': {}})
    incoming = load(folder / 'awen-genre-sources.json', {'schema_version': 1, 'tracks': {}})
    tracks = current.setdefault('tracks', {})
    for ident, value in incoming.get('tracks', {}).items():
        tracks.setdefault(ident, value)
    current['provider'] = incoming.get('provider', current.get('provider', ''))
    save(ROOT / 'awen-genre-sources.json', current)
    cur = load(ROOT / 'awen-genre-source-status.json', {})
    other = load(folder / 'awen-genre-source-status.json', {})
    for key in ('next_index', 'checked', 'total'):
        cur[key] = max(int(cur.get(key) or 0), int(other.get(key) or 0))
    cur['with_evidence'] = sum(bool(x.get('genre')) for x in tracks.values())
    cur['conflicts'] = sum(x.get('status') == 'conflict' for x in tracks.values())
    cur['complete'] = bool(cur.get('total') and cur['next_index'] >= cur['total'])
    save(ROOT / 'awen-genre-source-status.json', cur)

if __name__ == '__main__':
    main()
