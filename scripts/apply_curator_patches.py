#!/usr/bin/env python3
"""Merge AWEN Curator patch-only exports into the latest curation.

Usage:
  python3 scripts/apply_curator_patches.py awen-curation-patches.json

Never replaces unrelated tracks or audio sources. Default is dry-run.
Pass --write to modify awen-curation.json in the checked-out project.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "awen-catalog.json"
CURATION = ROOT / "awen-curation.json"
GENRES = {
    "Pop", "Hip-Hop / Rap", "R&B / Soul", "Phonk", "Funk / Disco",
    "Chill / Lo-Fi / Ambient", "House", "Techno / Trance",
    "Bass Music / EDM", "Drum & Bass / UK Bass", "Latin / Brazilian Club",
    "Afro / Global Club", "Synth / Retro Electronic", "Rock / Indie",
    "Metal / Punk", "Jazz / Blues", "Folk / Ethno / World",
    "Classical / Cinematic", "Country",
}
PLAYLISTS = {"road", "night", "nightplus", "dance", "chill"}
ALLOWED = {
    "genre", "subgenres", "language", "album", "year", "playlists", "moods",
    "curation_method", "curation_confidence", "review_needed", "energy",
}

def load(path):
    with open(path, encoding="utf-8") as file:
        return json.load(file)

def check_patch(track_id, entry):
    if not isinstance(entry, dict):
        raise ValueError(f"{track_id}: patch is not an object")
    extra = set(entry) - ALLOWED
    # Exported patches may include old automatic metadata. We intentionally
    # ignore noneditable keys rather than importing stale external-match data.
    cleaned = {k: v for k, v in entry.items() if k in ALLOWED}
    if "genre" in cleaned and cleaned["genre"] not in GENRES | {""}:
        raise ValueError(f"{track_id}: unknown genre {cleaned['genre']!r}")
    for key in ("subgenres", "playlists", "moods"):
        if key in cleaned:
            if not isinstance(cleaned[key], list) or not all(isinstance(v, str) for v in cleaned[key]):
                raise ValueError(f"{track_id}: invalid {key}")
            if key == "playlists" and not set(cleaned[key]) <= PLAYLISTS:
                raise ValueError(f"{track_id}: unknown playlist")
    if "year" in cleaned and cleaned["year"] not in (None, ""):
        year = cleaned["year"]
        if isinstance(year, bool) or not isinstance(year, int) or not 1900 <= year <= 2100:
            raise ValueError(f"{track_id}: invalid year")
    if "energy" in cleaned and cleaned["energy"] is not None:
        if isinstance(cleaned["energy"], bool) or not isinstance(cleaned["energy"], (int, float)) or not 1 <= cleaned["energy"] <= 5:
            raise ValueError(f"{track_id}: invalid energy")
    for key in ("language", "album", "curation_method", "curation_confidence"):
        if key in cleaned and not isinstance(cleaned[key], str):
            raise ValueError(f"{track_id}: invalid {key}")
    if "review_needed" in cleaned and not isinstance(cleaned["review_needed"], bool):
        raise ValueError(f"{track_id}: invalid review_needed")
    cleaned["curation_method"] = "ручная правка владельца"
    cleaned["curation_confidence"] = "manual"
    return cleaned, extra

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("patch_file", type=Path)
    parser.add_argument("--write", action="store_true", help="Update awen-curation.json")
    args = parser.parse_args()
    patches = load(args.patch_file)
    if patches.get("patch_format") != "awen-curator-patches" or not isinstance(patches.get("changes"), dict):
        raise ValueError("Expected a patch-only AWEN Curator export, not the full catalog")
    current = load(CURATION)
    tracks = current.get("tracks", {})
    ids = {t["id"] for t in load(CATALOG)["tracks"]}
    checked = []
    for ident, raw in patches["changes"].items():
        if ident not in ids:
            raise ValueError(f"Track {ident!r} is not in the current AWEN catalog")
        patch, ignored = check_patch(ident, raw)
        checked.append((ident, patch, ignored))
    for ident, patch, ignored in checked:
        # Merge only fields that the editor was designed to modify.
        base = tracks.get(ident, {})
        tracks[ident] = {**base, **patch}
        if ignored:
            print(f"{ident}: ignored old metadata keys {sorted(ignored)}")
    print(f"Validated {len(checked)} manual changes; --write={args.write}")
    if args.write:
        current["tracks"] = tracks
        CURATION.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Updated {CURATION}")

if __name__ == "__main__":
    main()
