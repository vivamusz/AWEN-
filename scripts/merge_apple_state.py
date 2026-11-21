#!/usr/bin/env python3
"""Merge an Apple metadata job's results with newest GitHub catalog state.

Never deletes tracks, replaces an owner's source link, or overrides manual
genre/album edits. Safe to re-run after a non-fast-forward push.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MERGED_FILES = [
    "awen-catalog.json",
    "awen-curation.json",
    "awen-match-status.json",
    "awen-match-review.json",
]

def read(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default

def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def merge_catalog(remote, fresh):
    by_id = {str(t.get("id")):t for t in fresh.get("tracks", [])}
    count = 0
    for t in remote.get("tracks", []):
        src = by_id.get(str(t.get("id")), {})
        if not t.get("source_url") and src.get("source_url"):
            t["source_url"] = src["source_url"]
            count += 1
    return remote, count

def merge_curations(remote, fresh):
    target = remote.setdefault("tracks", {})
    for ident, patch in fresh.get("tracks", {}).items():
        if not isinstance(patch, dict):
            continue
        original = target.get(ident)
        if not isinstance(original, dict):
            target[ident] = dict(patch)
            continue
        manual = str(original.get("curation_method", "")).startswith(("ручная", "массовая"))
        for key,value in patch.items():
            if key == "verified_metadata":
                if not original.get(key):
                    original[key] = value
            elif key == "genre":
                if not original.get("genre"):
                    original["genre"] = value
                elif original["genre"] != value:
                    original["genre_review_candidate"] = value
                    original["review_needed"] = True
            elif key in ("album", "year", "duration", "year_type", "genre_evidence"):
                if not original.get(key):
                    original[key] = value
            elif key in ("curation_method", "curation_confidence", "subgenres", "playlists",
                         "moods", "language", "energy", "review_needed"):
                if key not in original and not manual:
                    original[key] = value
            elif key not in original:
                original[key] = value
    return remote

def merge_status(remote, fresh):
    out = dict(remote)
    for key in ("next_index", "checked", "matched", "review", "not_found", "total"):
        out[key] = max(int(remote.get(key) or 0), int(fresh.get(key) or 0))
    out["complete"] = out["total"] > 0 and out["next_index"] >= out["total"]
    return out

def merge_candidates(remote, fresh):
    target = remote.setdefault("items", [])
    existing = {(str(t.get("id", "")), str(t.get("reason", "")))
                for t in target if isinstance(t, dict)}
    for item in fresh.get("items", []):
        if not isinstance(item, dict):
            continue
        key = str(item.get("id", "")), str(item.get("reason", ""))
        if key not in existing:
            target.append(item)
            existing.add(key)
    return remote

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: merge_apple_state.py /tmp/awen-apple-batch")
    directory = Path(sys.argv[1])
    originals = [read(ROOT / name, {}) for name in MERGED_FILES]
    additions = [read(directory / name, {}) for name in MERGED_FILES]
    catalog, applied = merge_catalog(originals[0], additions[0])
    curation = merge_curations(originals[1], additions[1])
    status = merge_status(originals[2], additions[2])
    review = merge_candidates(originals[3], additions[3])
    for name, obj in zip(MERGED_FILES, (catalog, curation, status, review)):
        write(ROOT / name, obj)
    print("Merged Apple results; added links:", applied,
          "cursor:", status["next_index"], "/", status["total"])

if __name__ == "__main__":
    main()
