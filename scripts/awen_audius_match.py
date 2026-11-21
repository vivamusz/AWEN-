#!/usr/bin/env python3
"""Match AWEN catalog titles/artists to streamable Audius tracks using official search.

No MP3 downloads. Never edits awen-catalog.json. Exact metadata matching only.
Results stored in awen-audius-matches.json, safe for other catalog-processing tasks.
"""
import datetime
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "awen-catalog.json"
OUTPUT = ROOT / "awen-audius-matches.json"
BATCH = max(1, min(250, int(os.getenv("AWEN_AUDIUS_BATCH", "120"))))
DELAY = max(1.0, float(os.getenv("AWEN_AUDIUS_DELAY", "1.3")))

def norm(text):
    value = unicodedata.normalize("NFKC", str(text or "").casefold())
    value = value.replace("ё", "е").replace("&", " and ")
    return " ".join(re.findall(r"[\w]+", value, re.UNICODE))

def exact_name(a, b):
    return bool(norm(a)) and norm(a) == norm(b)

def api_search(track):
    term = (str(track.get("artist") or "") + " " + str(track.get("title") or "")).strip()
    args = urllib.parse.urlencode({"query": term, "app_name": "AWEN", "limit": "20"})
    url = "https://api.audius.co/v1/tracks/search?" + args
    req = urllib.request.Request(url, headers={"User-Agent": "AWEN-Catalog-Matcher/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=22) as resp:
        data = json.load(resp)
    return data.get("data", []) if isinstance(data, dict) else []

def is_public(item):
    if item.get("is_streamable") is False or item.get("is_stream_gated") is True or item.get("is_unlisted") is True:
        return False
    access = item.get("access") or {}
    if isinstance(access, dict) and access.get("stream") is False:
        return False
    return True

def match(track, found):
    precise = []
    maybes = []
    for item in found:
        track_id = str(item.get("id", ""))
        if not re.fullmatch(r"[\w-]{2,55}", track_id) or not is_public(item):
            continue
        title = str(item.get("title") or "")
        artist = str((item.get("user") or {}).get("name") or item.get("artist") or "")
        title_match, artist_match = exact_name(track.get("title"), title), exact_name(track.get("artist"), artist)
        result = {
            "audius_id": track_id,
            "title": title,
            "artist": artist,
            "stream_url": f"https://api.audius.co/v1/tracks/{track_id}/stream?app_name=AWEN",
        }
        if title_match and artist_match:
            precise.append(result)
        elif title_match and norm(artist) != norm(track.get("artist")):
            maybes.append({k: v for k, v in result.items() if k != "stream_url"})
    if len(precise) == 1:
        return "match", precise[0]
    if len(precise) > 1:
        return "review", [{k: v for k, v in t.items() if k != "stream_url"} for t in precise[:5]]
    if maybes:
        return "review", maybes[:5]
    return "none", None

def read_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback

def main():
    all_tracks = read_json(CATALOG, {}).get("tracks", [])
    state = read_json(OUTPUT, {"version": 1, "checked": {}, "matches": {}, "review": {}})
    for key in ("checked", "matches", "review"):
        if not isinstance(state.get(key), dict):
            state[key] = {}
    checked = state["checked"]
    pending = [t for t in all_tracks if t.get("id") and str(t["id"]) not in checked]
    print(f"Audius exact-match search: total={len(all_tracks)}, already_scanned={len(checked)}, batch={BATCH}")
    requests = 0
    for t in pending[:BATCH]:
        track_id = str(t["id"])
        artist, title = str(t.get("artist", "")).strip(), str(t.get("title", "")).strip()
        if not artist or not title:
            checked[track_id] = "invalid"
            continue
        try:
            found = api_search(t)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as error:
            print("Audius API problem, safely stopping batch:", error)
            break  # Current track remains pending for retry in a later scheduled run.
        requests += 1
        kind, data = match(t, found)
        checked[track_id] = kind
        if kind == "match":
            state["matches"][track_id] = data
            print(f"MATCH {artist} — {title} => {data['audius_id']}")
        elif kind == "review":
            state["review"][track_id] = {
                "artist": artist, "title": title, "candidates": data
            }
        time.sleep(DELAY)
    state["total"] = len(all_tracks)
    state["scanned"] = sum(1 for t in all_tracks if str(t.get("id")) in checked)
    state["found"] = len(state["matches"])
    state["needs_review"] = len(state["review"])
    state["complete"] = state["scanned"] >= len(all_tracks)
    state["last_updated"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    OUTPUT.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Requests:",requests,"scanned:",state["scanned"],"exact:",state["found"],"review:",state["needs_review"],"complete:",state["complete"])

if __name__ == "__main__":
    main()
