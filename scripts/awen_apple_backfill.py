#!/usr/bin/env python3
"""AWEN Apple metadata backfill for already-linked Apple Music tracks.

Uses Apple's documented bulk ID lookup, strictly verifies artist + track title,
and stores release metadata separately. This does not download audio or modify
the source catalog, owner's edits, or Apple search job cursors.
"""
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from awen_match import artist_match, normalize, broad_genre

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "awen-catalog.json"
OVERLAY = ROOT / "awen-apple-metadata.json"

def read(name, default):
    try:
        return json.loads(name.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default

def save(name, data):
    name.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def apple_track_id(value):
    u = urlparse(str(value or ""))
    if (u.scheme != "https" or u.hostname != "music.apple.com"
            or not re.search(r"/album/\d+(?:/)?$", u.path)):
        return None
    v = parse_qs(u.query).get("i", [])
    return int(v[0]) if len(v) == 1 and v[0].isdigit() else None

def fetch(ids):
    url = "https://itunes.apple.com/lookup?" + urlencode({
        "id": ",".join(map(str, ids)),
        "country": "kz",
        "entity": "song",
    })
    req = Request(url, headers={
        "User-Agent": "AWEN-Catalog-Backfill/1.0 (https://github.com/vivamusz/AWEN-)",
        "Accept": "application/json",
    })
    for attempt in range(4):
        try:
            with urlopen(req, timeout=28) as resp:
                data = json.loads(resp.read(4_000_000))
            return {int(x["trackId"]): x for x in data.get("results", [])
                    if x.get("kind") == "song" and isinstance(x.get("trackId"), int)}
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            if isinstance(exc, HTTPError) and exc.code not in (429, 500, 502, 503, 504):
                raise
            if attempt == 3:
                raise
            print(f"Apple lookup retry {attempt + 1}: {exc}", file=sys.stderr)
            time.sleep(4 * (attempt + 1))
    return {}

def verified(track, item, track_id):
    if not item or int(item.get("trackId", 0)) != track_id:
        return None
    if normalize(item.get("trackName")) != normalize(track.get("title")):
        return None
    if not artist_match(track.get("artist"), item.get("artistName")):
        return None
    collection_id = item.get("collectionId")
    if not isinstance(collection_id, int):
        return None
    title = str(item.get("trackName", "")).strip()
    artist = str(item.get("artistName", "")).strip()
    album = str(item.get("collectionName") or "").strip()
    release = str(item.get("releaseDate") or "")
    genre_name = str(item.get("primaryGenreName") or "").strip()
    genre = broad_genre(genre_name)
    out = {
        "verified_metadata": {
            "provider": "Apple iTunes Lookup API",
            "url": f"https://music.apple.com/kz/album/{collection_id}?i={track_id}",
            "track_id": track_id,
            "title": title,
            "artist": artist,
            "genre_name": genre_name,
            "release_date": release,
        },
        "metadata_confidence": "exact_apple_track_id_artist_title",
    }
    if album and album.casefold() not in ("unknown album", "unknown", "various artists"):
        out["album"] = album[:250]
    if len(release) >= 4 and release[:4].isdigit():
        year = int(release[:4])
        if 1900 <= year <= 2100:
            out["year"] = year
            out["year_type"] = "album_release"
    if genre:
        out["genre"] = genre
        out["genre_evidence"] = "itunes_track_id"
    ms = item.get("trackTimeMillis")
    if isinstance(ms, int) and 1000 <= ms <= 3_600_000:
        out["duration"] = round(ms / 1000)
    return out

def main():
    tracks = read(CATALOG, {"tracks": []}).get("tracks", [])
    if not isinstance(tracks, list) or not tracks:
        raise RuntimeError("Empty source catalog")
    existing = read(OVERLAY, {"schema_version": 1, "tracks": {}})
    output = existing.setdefault("tracks", {})
    if not isinstance(output, dict):
        raise ValueError("Invalid overlay")
    linked = [(x, apple_track_id(x.get("source_url"))) for x in tracks]
    linked = [(t, ident) for t, ident in linked if ident is not None]
    pending = [(t, ident) for t, ident in linked if not output.get(t["id"], {}).get("verified_metadata")]
    failed_chunks = 0
    reviewed = 0
    for i in range(0, len(pending), 40):
        batch = pending[i:i + 40]
        try:
            by_track = fetch([ident for _, ident in batch])
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            print(f"Lookup chunk unavailable: {exc}", file=sys.stderr)
            failed_chunks += 1
            continue
        for track, ident in batch:
            record = verified(track, by_track.get(ident), ident)
            if record:
                output[track["id"]] = record
                reviewed += 1
        if i + 40 < len(pending):
            time.sleep(1.2)
    existing["schema_version"] = 1
    existing["provider"] = "Apple iTunes Lookup API"
    existing["generated_at_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    existing["linked_apple_tracks"] = len(linked)
    existing["verified_track_count"] = len([x for x in output.values()
                                             if isinstance(x, dict) and x.get("verified_metadata")])
    existing["unresolved_linked_tracks"] = len(linked) - existing["verified_track_count"]
    existing["failed_lookup_chunks"] = failed_chunks
    existing["note"] = (
        "Verified only for strict Apple track-ID + exact title + artist matches; "
        "release year is of the matched Apple album edition, not necessarily "
        "the song's original release year."
    )
    save(OVERLAY, existing)
    print(f"APPLE VERIFIED: linked={len(linked)}, new={reviewed}, "
          f"total={existing['verified_track_count']}, lookup_failed_chunks={failed_chunks}")

if __name__ == "__main__":
    main()
