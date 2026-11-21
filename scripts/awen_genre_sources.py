#!/usr/bin/env python3
"""Find AWEN genre evidence from track-level tags and exact-match album metadata.
Does not change original catalog, manual curation or audio links.
"""
import json, os, re, time, unicodedata
from pathlib import Path
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from awen_musicbrainz import map_label, best_artist_genre

ROOT = Path(__file__).resolve().parents[1]
BATCH = max(1, min(150, int(os.getenv('AWEN_GENRE_BATCH', '70'))))
KEY = os.getenv('LASTFM_API_KEY', '')
USE_MB = os.getenv('AWEN_GENRE_MUSICBRAINZ', '1') == '1'
UA = 'AWENMusic/genre-evidence (https://github.com/vivamusz/AWEN-)'
_last_mb = 0.0

def norm(x):
    s = unicodedata.normalize('NFKD', str(x or '').casefold())
    return ' '.join(re.findall(r'\w+', ''.join(c for c in s if not unicodedata.combining(c)).replace('&', ' and ')))

def read(n, d):
    try:
        return json.loads((ROOT / n).read_text(encoding='utf-8'))
    except FileNotFoundError:
        return d

def save(n, obj):
    (ROOT / n).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def get(url, mb=False):
    global _last_mb
    if mb:
        pause = 2.2 - (time.monotonic() - _last_mb)
        if _last_mb and pause > 0:
            time.sleep(pause)
        _last_mb = time.monotonic()
    r = Request(url, headers={'Accept': 'application/json', 'User-Agent': UA})
    with urlopen(r, timeout=18) as f:
        return json.loads(f.read(700000))

def deezer(song):
    params = urlencode({'q': song['artist'] + ' ' + song['title'], 'limit': 10})
    hits = get('https://api.deezer.com/search/track?' + params).get('data', [])
    albums = []
    for h in hits:
        if norm(h.get('title')) == norm(song['title']) and norm((h.get('artist') or {}).get('name')) == norm(song['artist']):
            album_id = (h.get('album') or {}).get('id')
            if isinstance(album_id, int) and album_id not in albums:
                albums.append(album_id)
    if not albums:
        return None
    item = get('https://api.deezer.com/album/' + str(albums[0]))
    tags = [str(g.get('name') or '') for g in (item.get('genres') or {}).get('data', [])]
    allowed = {
        'pop': 'Pop', 'rock': 'Rock / Indie',
        'hip hop': 'Hip-Hop / Rap', 'rap hip hop': 'Hip-Hop / Rap',
        'r b': 'R&B / Soul', 'soul': 'R&B / Soul',
        'jazz': 'Jazz / Blues', 'blues': 'Jazz / Blues',
        'country': 'Country', 'classical': 'Classical / Cinematic',
        'metal': 'Metal / Punk', 'folk': 'Folk / Ethno / World'
    }
    genres = {allowed[norm(tag)] for tag in tags if norm(tag) in allowed}
    if len(genres) != 1:
        return None
    return {'genre': next(iter(genres)), 'provider': 'Deezer', 'basis': 'album_genre',
            'url': 'https://www.deezer.com/album/' + str(albums[0]), 'raw_tags': tags}

def lastfm(song):
    if not KEY:
        return None
    query = urlencode({'method': 'track.getTopTags', 'artist': song['artist'], 'track': song['title'],
                       'api_key': KEY, 'autocorrect': 0, 'format': 'json'})
    x = get('https://ws.audioscrobbler.com/2.0/?' + query).get('toptags', {})
    attr = x.get('@attr') or {}
    if norm(attr.get('artist', song['artist'])) != norm(song['artist']) or norm(attr.get('track', song['title'])) != norm(song['title']):
        return None
    weights, tags = {}, {}
    for t in x.get('tag', [])[:30]:
        genre = map_label(t.get('name'))
        count = int(t.get('count') or 0)
        if genre and count >= 5:
            weights[genre] = weights.get(genre, 0) + min(count, 100)
            tags.setdefault(genre, []).append(t['name'])
    ranked = sorted(weights, key=weights.get, reverse=True)
    if not ranked or weights[ranked[0]] < 10 or (len(ranked) > 1 and weights[ranked[0]] < 1.6 * weights[ranked[1]]):
        return None
    genre = ranked[0]
    return {'genre': genre, 'provider': 'Last.fm', 'basis': 'track_tags',
            'url': 'https://www.last.fm/music/' + quote(song['artist'], safe='') + '/_/' + quote(song['title'], safe=''),
            'raw_tags': tags[genre][:6]}

def musicbrainz(song):
    name = song['title'].replace('"', '')
    artist = song['artist'].replace('"', '')
    q = f'recording:"{name}" AND artist:"{artist}"'
    result = get('https://musicbrainz.org/ws/2/recording/?' + urlencode({'query': q, 'fmt': 'json', 'limit': 8}), True)
    matches = []
    for rec in result.get('recordings', []):
        artists = [norm(a.get('name')) for a in rec.get('artist-credit', []) if isinstance(a, dict)]
        if norm(rec.get('title')) == norm(song['title']) and norm(song['artist']) in artists and int(rec.get('score') or 0) >= 90:
            matches.append(rec.get('id'))
    if len(set(matches)) != 1 or not matches[0]:
        return None
    ident = matches[0]
    data = get('https://musicbrainz.org/ws/2/recording/' + quote(ident) + '?inc=genres+tags&fmt=json', True)
    genre, tags = best_artist_genre(data)
    if not genre or not tags:
        return None
    return {'genre': genre, 'provider': 'MusicBrainz', 'basis': 'recording_tags',
            'url': 'https://musicbrainz.org/recording/' + ident, 'raw_tags': tags}

def main():
    songs = read('awen-catalog.json', {'tracks': []})['tracks']
    edits = read('awen-curation.json', {'tracks': {}})['tracks']
    overlay = read('awen-genre-sources.json', {'schema_version': 1, 'tracks': {}})
    progress = read('awen-genre-source-status.json', {'next_index': 0, 'checked': 0})
    items = overlay.setdefault('tracks', {})
    i = int(progress.get('next_index') or 0)
    done = 0
    providers = [lastfm, deezer] + ([musicbrainz] if USE_MB else [])
    unavailable = set()
    while i < len(songs) and done < BATCH:
        song = songs[i]
        ident = str(song.get('id') or '')
        edit = edits.get(ident, {})
        if not ident or ident in items or edit.get('potential_import_error') or re.match(r'^(ручная|массовая)', str(edit.get('curation_method', ''))):
            i += 1
            continue
        if norm(song.get('artist')) in {'id', 'unknown', 'ost', ''} or norm(song.get('title')) in {'id', 'unknown', ''}:
            i += 1
            continue
        evidence = []
        for fn in providers:
            if fn.__name__ in unavailable:
                continue
            try:
                result = fn(song)
                if result:
                    evidence.append(result)
            except (HTTPError, URLError, TimeoutError, ValueError, KeyError, TypeError) as exc:
                unavailable.add(fn.__name__)
                print(fn.__name__ + ' temporarily unavailable: ' + str(exc), flush=True)
        if evidence:
            groups = {x['genre'] for x in evidence}
            if len(groups) == 1:
                direct = any(x['basis'] in ('recording_tags', 'track_tags') for x in evidence)
                items[ident] = {'genre': next(iter(groups)), 'status': 'track_evidence' if direct else 'album_hint',
                                'review_needed': not direct, 'evidence': evidence}
            else:
                items[ident] = {'status': 'conflict', 'suggestions': sorted(groups),
                                'review_needed': True, 'evidence': evidence}
        if len(unavailable) == len(providers) and not evidence:
            progress['last_error'] = 'All sources temporarily unavailable; resume this row next run'
            break
        i += 1
        done += 1
    progress.update({'next_index': i, 'checked': int(progress.get('checked') or 0) + done,
                     'total': len(songs), 'complete': i >= len(songs),
                     'with_evidence': sum(bool(x.get('genre')) for x in items.values()),
                     'conflicts': sum(x.get('status') == 'conflict' for x in items.values())})
    overlay['provider'] = 'Deezer album genres; Last.fm track tags; MusicBrainz recording tags'
    save('awen-genre-sources.json', overlay)
    save('awen-genre-source-status.json', progress)
    print('AWEN genre evidence', i, '/', len(songs), 'genres', progress['with_evidence'], 'conflicts', progress['conflicts'])

if __name__ == '__main__':
    main()
