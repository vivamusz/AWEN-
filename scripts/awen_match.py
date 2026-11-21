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
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "awen-catalog.json"
STATUS = ROOT / "awen-match-status.json"
REVIEW = ROOT / "awen-match-review.json"
CURATION = ROOT / "awen-curation.json"
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
            "genre_name": str(item.get("primaryGenreName", "")),
            "release_date": str(item.get("releaseDate", "")),
            "duration_ms": item.get("trackTimeMillis"),
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

# Apple genres are broad. Do not force "Electronic" or "Dance" into a specific
# House/Phonk/EDM family: those labels cover too many distinct musical styles.
def broad_genre(value):
    label = normalize(value)
    if not label:
        return ""
    # Apple's broad Alternative and hybrid Pop/Rock tags do not identify
    # the sound of one specific recording. Keep them unclassified.
    if label in {"alternative", "indie", "pop rock", "pop and rock"}:
        return ""
    for hint, genre in (
        ("ambient", "Chill / Lo-Fi / Ambient"),
        ("downtempo", "Chill / Lo-Fi / Ambient"),
        ("country", "Country"),
        ("hip hop", "Hip-Hop / Rap"),
        ("rap", "Hip-Hop / Rap"),
        ("r and b", "R&B / Soul"),
        ("soul", "R&B / Soul"),
        ("funk", "Funk / Disco"),
        ("disco", "Funk / Disco"),
        ("drum and bass", "Drum & Bass / UK Bass"),
        ("dubstep", "Bass Music / EDM"),
        ("trance", "Techno / Trance"),
        ("techno", "Techno / Trance"),
        ("house", "House"),
        ("alternative rock", "Rock / Indie"),
        ("indie rock", "Rock / Indie"),
        ("rock", "Rock / Indie"),
        ("metal", "Metal / Punk"),
        ("punk", "Metal / Punk"),
        ("jazz", "Jazz / Blues"),
        ("blues", "Jazz / Blues"),
        ("folk", "Folk / Ethno / World"),
        ("world", "Folk / Ethno / World"),
        ("classical", "Classical / Cinematic"),
        ("soundtrack", "Classical / Cinematic"),
        ("pop", "Pop"),
    ):
        if hint in label:
            return genre
    return ""

def apply_verified_metadata(track, match, curation):
    """Add only metadata backed by a strict artist/title match from Apple."""
    if not isinstance(match, dict):
        return False
    track_id = str(track.get("id", "")).strip()
    if not track_id or normalize(match.get("title")) != normalize(track.get("title")):
        return False
    if not artist_match(track.get("artist", ""), match.get("artist", "")):
        return False
    records = curation.setdefault("tracks", {})
    if not isinstance(records, dict):
        return False
    patch = records.setdefault(track_id, {})
    if not isinstance(patch, dict):
        return False
    source = {
        "provider": "Apple iTunes Search API",
        "url": str(match.get("url", "")),
        "title": str(match.get("title", "")),
        "artist": str(match.get("artist", "")),
        "genre_name": str(match.get("genre_name", "")),
        "release_date": str(match.get("release_date", "")),
    }
    if patch.get("verified_metadata") == source:
        return False
    patch["verified_metadata"] = source
    mapped = broad_genre(match.get("genre_name", ""))
    current_genre = str(patch.get("genre", "")).strip()
    if mapped and not current_genre:
        patch["genre"] = mapped
        patch["genre_evidence"] = "itunes_exact"
        patch["curation_confidence"] = "verified_broad_genre"
    elif mapped and current_genre != mapped:
        # Different genres can coexist, especially on remix releases.
        # Preserve the preexisting classification and expose disagreement.
        patch["genre_review_candidate"] = mapped
        patch["review_needed"] = True
    album = str(match.get("collection", "")).strip()
    if album and album.lower() not in ("unknown album", "unknown", "various artists"):
        if not patch.get("album"):
            patch["album"] = album[:250]
    date = str(match.get("release_date", ""))
    if len(date) >= 4 and date[:4].isdigit():
        year = int(date[:4])
        if 1900 <= year <= 2100 and not patch.get("year"):
            # Year is this Apple album/edition release, not necessarily
            # the song's first publication year.
            patch["year"] = year
            patch["year_type"] = "album_release"
    length = match.get("duration_ms")
    if isinstance(length, int) and length > 0 and length < 60 * 60 * 1000:
        patch.setdefault("duration", round(length / 1000))
    return True

def exact_from_lookup(track, response):
    result = response.get("results", [])
    for item in result:
        if item.get("kind") != "song":
            continue
        if normalize(item.get("trackName")) != normalize(track.get("title")):
            continue
        if not artist_match(track.get("artist", ""), item.get("artistName", "")):
            continue
        c_id, t_id = item.get("collectionId"), item.get("trackId")
        if isinstance(c_id, int) and isinstance(t_id, int):
            return {
                "title": str(item.get("trackName", "")),
                "artist": str(item.get("artistName", "")),
                "url": f"https://music.apple.com/kz/album/{c_id}?i={t_id}",
                "collection": str(item.get("collectionName", "")),
                "genre_name": str(item.get("primaryGenreName", "")),
                "release_date": str(item.get("releaseDate", "")),
                "duration_ms": item.get("trackTimeMillis"),
            }
    return None

def backfill_apple_links(tracks, start, curation):
    """Backfill only pre-existing Apple links missed before this upgrade."""
    done = 0
    last = 0.0
    for track in tracks[:start]:
        if done >= 30:
            break
        link = str(track.get("source_url", ""))
        if not link.startswith("https://music.apple.com/"):
            continue
        already = curation.get("tracks", {}).get(track.get("id"), {})
        if already.get("verified_metadata"):
            continue
        vals = parse_qs(urlparse(link).query).get("i", [])
        if not vals or not vals[0].isdigit():
            continue
        wait = PAUSE - (time.monotonic() - last)
        if last and wait > 0:
            time.sleep(wait)
        try:
            last = time.monotonic()
            req = Request(
                "https://itunes.apple.com/lookup?" + urlencode({
                    "id": vals[0], "country": "kz", "entity": "song",
                }),
                headers={"User-Agent": "AWEN-Family-Catalog/1.0"},
            )
            with urlopen(req, timeout=25) as response:
                raw = json.loads(response.read(1_500_000))
            match = exact_from_lookup(track, raw)
            if match:
                apply_verified_metadata(track, match, curation)
        except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            print(f"Backfill stopped: {exc}", file=sys.stderr)
            break
        done += 1
    return done

def main():
    data = read_json(CATALOG, {})
    tracks = data.get("tracks", [])
    if not isinstance(tracks, list) or not tracks:
        raise RuntimeError("awen-catalog.json is empty or malformed")

    state = read_json(STATUS, {"next_index": 0, "checked": 0, "matched": 0, "review": 0, "not_found": 0})
    candidates = read_json(REVIEW, {"items": []})
    curation = read_json(CURATION, {"schema_version": 1, "tracks": {}})
    if not isinstance(curation.get("tracks"), dict):
        raise RuntimeError("Invalid AWEN curation format")
    if not isinstance(candidates.get("items"), list):
        candidates = {"items": []}
    start = max(0, min(len(tracks), int(state.get("next_index", 0))))
    backfilled = backfill_apple_links(tracks, start, curation)
    print(f"Backfilled Apple metadata for up to {backfilled} prelinked tracks.")
    if start >= len(tracks):
        save_json(CURATION, curation)
        print(f"Completed: {len(tracks)} records scanned.")
        return
    end = min(len(tracks), start + BATCH)
    print(f"Scanning entries {start + 1}..{end} of {len(tracks)}.")
    last_request = 0.0
    tried = 0

    for i in range(start, end):
        track = tracks[i]
        state["next_index"] = i + 1
        # Public VK posts are sometimes quotes with a dash, not artist-song pairs.
        # Preserve these rows for editorial review but never query song APIs for them.
        if (curation.get("tracks", {}).get(track.get("id"), {}) or {}).get("potential_import_error"):
            continue
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
            apply_verified_metadata(track, match, curation)
            track["source_url"] = match["url"]
            state["matched"] = state.get("matched", 0) + 1
            print(f"MATCH: {artist} - {title} => {match['url']}")
        elif status in ("ambiguous", "review"):
            # Candidate metadata remains a review task, never an automatic album/year claim.
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
    save_json(CURATION, curation)
    print(f"API calls: {tried}; progress: {state['next_index']}/{len(tracks)}; "
          f"exact matches: {state.get('matched', 0)}; for review: {state.get('review', 0)}.")

if __name__ == "__main__":
    main()
