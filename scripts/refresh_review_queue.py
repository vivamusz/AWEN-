#!/usr/bin/env python3
"""Build transparent, current AWEN review queue and catalog audit from source JSONs."""
import json
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = ["road", "night", "nightplus", "dance", "chill"]

def read(name, fallback):
    path = ROOT / name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback

def write(name, data):
    (ROOT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def normalize(s):
    s = unicodedata.normalize("NFKD", str(s or "").casefold())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return "".join(c for c in s if c.isalnum())

def main():
    songs = read("awen-catalog.json", {"tracks": []})["tracks"]
    edits = read("awen-curation.json", {"tracks": {}})["tracks"]
    musicbrainz = read("awen-musicbrainz.json", {"tracks": {}})["tracks"]
    apple_verified = read("awen-apple-metadata.json", {"tracks": {}})["tracks"]
    apple = read("awen-match-status.json", {})
    mb_state = read("awen-musicbrainz-progress.json", {})
    audius = read("awen-audius-matches.json", {"matches": {}})
    groups = defaultdict(list)
    for song in songs:
        key = normalize(song.get("artist")) + "|" + normalize(song.get("title"))
        groups[key].append(str(song.get("id", "")))
    duplicates = {x: g for g in groups.values() if len(g) > 1 for x in g}
    counts = Counter()
    assignments = Counter()
    genres = Counter()
    review_items = []

    for song in songs:
        ident = str(song.get("id") or "")
        edit = edits.get(ident, {})
        mb = musicbrainz.get(ident, {})
        am = apple_verified.get(ident, {})
        is_verified = bool(am.get("verified_metadata"))
        selected_genre = str(edit.get("genre") or mb.get("genre") or (am.get("genre") if is_verified else "") or "")
        problem = []
        if not selected_genre:
            problem.append("genre_not_identified")
            counts["unknown_genre"] += 1
        else:
            genres[selected_genre] += 1
            counts["known_genre"] += 1
            if str(edit.get("curation_method") or "").startswith(("ручная", "массовая")):
                counts["manual_genre"] += 1
            elif (is_verified and am.get("genre") == selected_genre) or edit.get("genre_evidence") == "itunes_exact":
                counts["official_apple_genre"] += 1
            else:
                counts["provisional_genre"] += 1
        if edit.get("potential_import_error"):
            problem.append("possible_non_music_text")
            counts["possible_non_music"] += 1
        if ident in duplicates:
            problem.append("possible_duplicate")
        if edit.get("genre_review_candidate") or (is_verified and am.get("genre") and edit.get("genre") and am["genre"] != edit["genre"]):
            problem.append("genre_metadata_conflict")
            counts["genre_conflict"] += 1
        if edit.get("verified_metadata") or is_verified:
            counts["verified_apple_metadata"] += 1
        if edit.get("album") or (is_verified and am.get("album")):
            counts["album_known"] += 1
        if edit.get("year") or (is_verified and am.get("year")):
            counts["year_known"] += 1
        if song.get("source_url"):
            counts["source_linked"] += 1
        if song.get("audio_url"):
            counts["direct_audio"] += 1
        for entry in edit.get("playlists", []):
            if entry in CATEGORIES:
                assignments[entry] += 1
        if not problem:
            continue
        item = {
            "id": ident,
            "artist": str(song.get("artist") or ""),
            "title": str(song.get("title") or ""),
            "issues": problem,
        }
        if ident in duplicates:
            item["duplicate_ids"] = duplicates[ident]
        if selected_genre:
            item["proposed_genre"] = selected_genre
        if edit.get("genre_review_candidate"):
            item["genre_conflict"] = edit["genre_review_candidate"]
        elif is_verified and am.get("genre") and edit.get("genre") and am["genre"] != edit["genre"]:
            item["genre_conflict"] = am["genre"]
        if song.get("source_url"):
            item["source_url"] = song["source_url"]
        review_items.append(item)

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    audit = {
        "schema_version": 1,
        "generated_at_utc": generated_at,
        "catalog_tracks": len(songs),
        "with_provisional_or_confirmed_genre": counts["known_genre"],
        "without_genre": counts["unknown_genre"],
        "manual_genre_assignments": counts["manual_genre"],
        "official_apple_genre_assignments": counts["official_apple_genre"],
        "provisional_genre_assignments": counts["provisional_genre"],
        "possible_non_music_rows": counts["possible_non_music"],
        "duplicate_groups": sum(len(g) > 1 for g in groups.values()),
        "tracks_in_duplicate_groups": len(duplicates),
        "genre_conflicts": counts["genre_conflict"],
        "apple_verified_metadata": counts["verified_apple_metadata"],
        "known_albums": counts["album_known"],
        "known_release_years": counts["year_known"],
        "external_source_links": counts["source_linked"],
        "direct_audio_entries_in_catalog": counts["direct_audio"],
        "audius_exact_matches": len(audius.get("matches", {})),
        "apple_bulk_lookup_linked_tracks": len([t for t in songs if "music.apple.com" in str(t.get("source_url", ""))]),
        "apple_bulk_lookup_verified_tracks": len([v for v in apple_verified.values() if v.get("verified_metadata")]),
        "explicit_playlist_assignments": {k: assignments[k] for k in CATEGORIES},
        "genre_counts": dict(sorted(genres.items())),
        "apple_match_progress": apple,
        "musicbrainz_progress": mb_state,
        "notes": [
            "Genre assignments include artist/title inferences and are not all verified song by song.",
            "Playlists count explicit assignments only; the website may show additional automatic rules.",
            "Missing metadata must not be invented or presented as an official match.",
        ],
    }
    queue = {
        "schema_version": 1,
        "generated_at_utc": generated_at,
        "description": "Текущая очередь редакторской проверки AWEN. Не удалять песни автоматически.",
        "counts": {
            "total": len(songs),
            "needs_genre": counts["unknown_genre"],
            "possible_import_errors": counts["possible_non_music"],
            "duplicate_groups": audit["duplicate_groups"],
            "tracks_in_duplicate_groups": len(duplicates),
            "genre_conflicts": counts["genre_conflict"],
        },
        "items": review_items,
    }
    write("awen-audit.json", audit)
    write("awen-review-queue.json", queue)
    print("AWEN REPORT", len(songs), "genre:", counts["known_genre"],
          "unknown:", counts["unknown_genre"], "review:", len(review_items))

if __name__ == "__main__":
    main()
