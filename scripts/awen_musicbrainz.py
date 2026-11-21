#!/usr/bin/env python3
"""AWEN: cautious genre enrichment from MusicBrainz artist genres/tags.
No audio files are requested. Genre inferred from an artist is never claimed
as a verified genre for every individual recording.
"""
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "awen-catalog.json"
CURATION = ROOT / "awen-curation.json"
OVERLAY = ROOT / "awen-musicbrainz.json"
PROGRESS = ROOT / "awen-musicbrainz-progress.json"
BATCH = max(1, min(200, int(os.environ.get("AWEN_MB_BATCH", "110"))))
DELAY = max(1.2, float(os.environ.get("AWEN_MB_DELAY", "1.25")))
UA = "AWENMusicGenreEnrichment/1.0 (https://github.com/vivamusz/AWEN-)"
_last_request = 0.0

def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default

def save(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def normalize(v):
    s = unicodedata.normalize("NFKD", str(v or "").casefold())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(re.findall(r"[\w]+", s.replace("&", " and "), flags=re.UNICODE))

def primary_artist(s):
    name = str(s or "").strip()
    name = re.split(r"\s+(?:feat\.?|featuring|ft\.?|vs\.?)\s+|\s*,\s*|\s+&\s+|\s+x\s+", name, maxsplit=1, flags=re.I)[0].strip()
    return name

def request_json(path, params=None):
    global _last_request
    now = time.monotonic()
    if _last_request and now - _last_request < DELAY:
        time.sleep(DELAY - (now - _last_request))
    endpoint = "https://musicbrainz.org/ws/2/" + path
    if params:
        endpoint += "?" + urlencode(params)
    req = Request(endpoint, headers={"User-Agent": UA, "Accept": "application/json"})
    _last_request = time.monotonic()
    with urlopen(req, timeout=22) as resp:
        return json.loads(resp.read(600000))

def map_label(s):
    x = normalize(s)
    rules = [
        (r"\bphonk\b", "Phonk"),
        (r"\b(?:lo fi|chillhop|chillout|trip hop|downtempo|ambient|chillstep|lounge)\b", "Chill / Lo-Fi / Ambient"),
        (r"\b(?:future bass|dubstep|brostep|electronic trap|edm trap|melodic bass)\b", "Bass Music / EDM"),
        (r"\b(?:drum and bass|dnb|jungle|uk garage|breakbeat)\b", "Drum & Bass / UK Bass"),
        (r"\b(?:moombahton|reggaeton|baile funk|dembow|brazilian funk)\b", "Latin / Brazilian Club"),
        (r"\b(?:amapiano|afrobeats|afrobeat|gqom|kuduro)\b", "Afro / Global Club"),
        (r"\b(?:synthwave|retrowave|vaporwave|chillwave|darksynth)\b", "Synth / Retro Electronic"),
        (r"\b(?:deep house|tech house|future house|house music|progressive house|tropical house|afro house)\b", "House"),
        (r"\b(?:techno|trance|psytrance|hardstyle)\b", "Techno / Trance"),
        (r"\b(?:nu disco|disco|funk|boogie)\b", "Funk / Disco"),
        (r"\b(?:hip hop|rap|drill|boom bap|trap music|cloud rap)\b", "Hip-Hop / Rap"),
        (r"\b(?:rhythm and blues|rnb|r and b|soul|neo soul)\b", "R&B / Soul"),
        (r"\b(?:metal|punk|hardcore)\b", "Metal / Punk"),
        (r"\b(?:indie rock|alternative rock|post rock|shoegaze|britpop|rock)\b", "Rock / Indie"),
        (r"\b(?:jazz|blues|bebop)\b", "Jazz / Blues"),
        (r"\b(?:country|bluegrass|honky tonk|americana)\b", "Country"),
        (r"\b(?:folk|ethno|traditional|worldbeat)\b", "Folk / Ethno / World"),
        (r"\b(?:classical|orchestral|soundtrack|film score|neoclassical)\b", "Classical / Cinematic"),
        (r"\b(?:synthpop|indie pop|pop|electropop|dance pop)\b", "Pop"),
    ]
    for pattern, genre in rules:
        if re.search(pattern, x):
            return genre
    return ""

def best_artist_genre(record):
    weights = {}
    evidence = {}
    for key, factor in (("genres", 2), ("tags", 1)):
        for tag in (record.get(key) or []):
            label = str(tag.get("name") or "")
            category = map_label(label)
            if not category:
                continue
            count = max(1, int(tag.get("count") or 0))
            score = min(15, count) * factor
            weights[category] = weights.get(category, 0) + score
            evidence.setdefault(category, []).append(label)
    if not weights:
        return "", []
    ranked = sorted(weights.items(), key=lambda x: -x[1])
    if len(ranked) > 1 and ranked[0][1] < 1.6 * ranked[1][1]:
        return "", []
    return ranked[0][0], list(dict.fromkeys(evidence[ranked[0][0]]))[:6]

def lookup_artist(name):
    clean = normalize(name)
    if len(clean) < 2 or clean in ("id", "unknown", "au", "various artists", "ost"):
        return {"status": "skip"}
    q = "artist:\"" + name.replace('"', "") + "\""
    result = request_json("artist/", {"query": q, "fmt": "json", "limit": 10})
    matches = []
    for item in result.get("artists", []):
        if normalize(item.get("name")) == clean:
            matches.append(item)
    identifiers = {x.get("id") for x in matches if x.get("id")}
    if len(identifiers) != 1:
        return {"status": "ambiguous" if len(identifiers) > 1 else "not_found"}
    mbid = next(iter(identifiers))
    detail = request_json("artist/" + quote(mbid), {"inc": "genres+tags", "fmt": "json"})
    genre, tags = best_artist_genre(detail)
    return {
        "status": "found" if genre else "unclassified",
        "artist_mbid": mbid,
        "genre": genre,
        "evidence_tags": tags,
        "artist_url": "https://musicbrainz.org/artist/" + mbid,
    }

def main():
    source = load(CATALOG, {"tracks": []})
    tracks = source.get("tracks", [])
    if not isinstance(tracks, list) or not tracks:
        raise ValueError("No tracks to enrich")
    curation = load(CURATION, {"tracks": {}}).get("tracks", {})
    data = load(OVERLAY, {"schema_version": 1, "provider": "MusicBrainz artist tags (not per-song verification)", "artists": {}, "tracks": {}})
    state = load(PROGRESS, {"next_index": 0, "artists_checked": 0, "tracks_assigned": 0})
    artist_cache = data.setdefault("artists", {})
    patches = data.setdefault("tracks", {})
    index = max(0, int(state.get("next_index") or 0))
    requested = 0
    assigned = 0

    while index < len(tracks) and requested < BATCH:
        song = tracks[index]
        song_id = str(song.get("id") or "")
        if not song_id:
            index += 1
            continue
        if (curation.get(song_id) or {}).get("genre"):
            index += 1
            continue
        if (curation.get(song_id) or {}).get("potential_import_error"):
            index += 1
            continue
        artist = primary_artist(song.get("artist", ""))
        key = normalize(artist)
        if len(key) < 2 or key in ("id", "au", "various artists", "unknown"):
            index += 1
            continue
        cached = artist_cache.get(key)
        if cached is None:
            try:
                cached = lookup_artist(artist)
            except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
                print(f"MusicBrainz interrupted at {index + 1}: {exc}", file=sys.stderr)
                break
            artist_cache[key] = cached
            requested += 1
            state["artists_checked"] = int(state.get("artists_checked", 0)) + 1
        if cached.get("genre"):
            patches[song_id] = {
                "genre": cached["genre"],
                "evidence_tags": cached.get("evidence_tags", []),
                "artist_url": cached.get("artist_url", ""),
                "curation_confidence": "artist_genre_inference",
                "review_needed": True,
            }
            assigned += 1
        index += 1
    state["next_index"] = index
    state["tracks_assigned"] = len(patches)
    state["total"] = len(tracks)
    state["complete"] = index >= len(tracks)
    save(OVERLAY, data)
    save(PROGRESS, state)
    print(f"MusicBrainz: scanned {index}/{len(tracks)}, new artists queried {requested}, "
          f"new genre assignments in this run {assigned}, total assigned {len(patches)}")

if __name__ == "__main__":
    main()
