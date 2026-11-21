#!/usr/bin/env python3
"""AWEN: rate-limited metadata matching against the official Apple iTunes Search API.
Never downloads audio or previews. Automatically links only exact artist/title metadata matches.
"""
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "awen-catalog.json"
STATUS = ROOT / "awen-match-status.json"
REVIEW = ROOT / "awen-match-review.json"
BATCH = max(1, min(450, int(os.getenv("AWEN_BATCH", "180"))))
PAUSE = max(3.5, float(os.getenv("AWEN_PAUSE", "3.6")))

def read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError:
        return default

def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def normalize(value):
    value = unicodedata.normalize("NFKD", str(value or "").casefold())
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = value.replace("&", " and ")
    return " ".join(re.findall(r"[\w]+", value, flags=re.UNICODE))

def artist_match(source, candidate):
    a, b = normalize(source), normalize(candidate)
    if a == b:
        return True
    # Same words in a different order, e.g. "Aarne & Big Baby Tape".
    return len(a.split()) > 1 and sorted(a.split()) == sorted(b.split())

def search(artist, title):
    url = "https://itunes.apple.com/search?" + urlencode({
        "term": artist + " " + title,
        "country": "kz",
        "media": "music",
        "entity": "song",
        "limit": 15,
    })
    req = Request(url, headers={
        "User-Agent": "AWEN-Family-Catalog/1.0 (GitHub: vivamusz/AWEN-)",
        "Accept": "application/json",
    })
    with urlopen(req, timeout=25) as response:
        raw = response.read(1_500_000)
    return json.loads(raw).get("results", [])

def choose(artist, title, results):
    exact = []
    nearby = []
    wanted_title = normalize(title)
    for item in results:
        if item.get("kind") != "song":
            continue
        title_ok = normalize(item.get("trackName")) == wanted_title
        artist_ok = artist_match(artist, item.get("artistName"))
        c_id, t_id = item.get("collectionId"), item.get("trackId")
        if not isinstance(c_id, int) or not isinstance(t_id, int):
            continue
        link = f"https://music.apple.com/kz/album/{c_id}?i={t_id}"
        match = {
            "title": str(item.get("trackName", "")),
            "artist": str(item.get("artistName", "")),
            "url": link,
            "collection": str(item.get("collectionName", "")),
        }
        if title_ok and artist_ok:
            exact.append(match)
        elif title_ok or artist_ok:
            nearby.append(match)
    # Duplicate exact matches can be different masters or editions; keep for review.
    if len(exact) == 1:
        return "exact_metadata", exact[0]
    if len(exact) > 1:
        urls = {x["url"] for x in exact}
        if len(urls) == 1:
            return "exact_metadata", exact[0]
        return "ambiguous", exact[:5]
    if nearby:
        return "review", nearby[:5]
    return "not_found", None

def main():
    data = read_json(CATALOG, {})
    tracks = data.get("tracks", [])
    if not isinstance(tracks, list) or not tracks:
        raise RuntimeError("awen-catalog.json is empty or malformed")

    state = read_json(STATUS, {"next_index": 0, "checked": 0, "matched": 0, "review": 0, "not_found": 0})
    candidates = read_json(REVIEW, {"items": []})
    if not isinstance(candidates.get("items"), list):
        candidates = {"items": []}
    start = max(0, min(len(tracks), int(state.get("next_index", 0))))
    if start >= len(tracks):
        print(f"Completed: {len(tracks)} records scanned.")
        return
    end = min(len(tracks), start + BATCH)
    print(f"Scanning entries {start + 1}..{end} of {len(tracks)}.")
    last_request = 0.0
    tried = 0

    for i in range(start, end):
        track = tracks[i]
        state["next_index"] = i + 1
        if track.get("source_url"):
            continue
        artist, title = str(track.get("artist", "")).strip(), str(track.get("title", "")).strip()
        if not artist or not title or artist.lower() in {"неизвестный исполнитель", "unknown"}:
            state["not_found"] = state.get("not_found", 0) + 1
            continue

        remaining = PAUSE - (time.monotonic() - last_request)
        if last_request and remaining > 0:
            time.sleep(remaining)
        try:
            last_request = time.monotonic()
            matches = search(artist, title)
        except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            # Retain current item for a future retry; don't call again immediately.
            state["next_index"] = i
            print(f"Stop at entry {i + 1}; API error: {exc}", file=sys.stderr)
            break
        tried += 1
        state["checked"] = state.get("checked", 0) + 1
        status, match = choose(artist, title, matches)
        if status == "exact_metadata":
            track["source_url"] = match["url"]
            state["matched"] = state.get("matched", 0) + 1
            print(f"MATCH: {artist} - {title} => {match['url']}")
        elif status in ("ambiguous", "review"):
            state["review"] = state.get("review", 0) + 1
            candidates["items"].append({
                "id": track.get("id"), "artist": artist, "title": title,
                "reason": status, "candidates": match,
            })
        else:
            state["not_found"] = state.get("not_found", 0) + 1
    state["total"] = len(tracks)
    state["complete"] = state["next_index"] >= len(tracks)
    save_json(CATALOG, data)
    save_json(STATUS, state)
    save_json(REVIEW, candidates)
    print(f"API calls: {tried}; progress: {state['next_index']}/{len(tracks)}; "
          f"exact matches: {state.get('matched', 0)}; for review: {state.get('review', 0)}.")

if __name__ == "__main__":
    main()
