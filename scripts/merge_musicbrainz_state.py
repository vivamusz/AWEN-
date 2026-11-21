#!/usr/bin/env python3
"""Safely merge a GitHub Actions MusicBrainz batch into fresh remote state.

Preserves union of artist lookup cache and per-song genre hints. Never discards
progress from other completed runs or adjacent chats.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL_RESULT = Path(sys.argv[1]) if len(sys.argv) > 1 else None
LOCAL_PROGRESS = Path(sys.argv[2]) if len(sys.argv) > 2 else None

def read(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def merge(current, fresh):
    result = dict(current)
    for key in ("artists", "tracks"):
        a = current.get(key) or {}
        b = fresh.get(key) or {}
        if not isinstance(a, dict) or not isinstance(b, dict):
            raise ValueError(f"MusicBrainz {key} should be an object")
        # Prefer already-published values on a conflict; preserve all new keys.
        result[key] = {**b, **a}
    return result

def main():
    if not LOCAL_RESULT or not LOCAL_PROGRESS:
        raise SystemExit("Usage: merge_musicbrainz_state.py /tmp/new-result.json /tmp/new-progress.json")
    remote_data = read(ROOT / "awen-musicbrainz.json", {"artists": {}, "tracks": {}})
    remote_progress = read(ROOT / "awen-musicbrainz-progress.json", {})
    new_data = read(LOCAL_RESULT, {})
    new_progress = read(LOCAL_PROGRESS, {})
    combined = merge(remote_data, new_data)
    progress = dict(remote_progress)
    progress["next_index"] = max(int(remote_progress.get("next_index") or 0),
                                 int(new_progress.get("next_index") or 0))
    progress["artists_checked"] = max(int(remote_progress.get("artists_checked") or 0),
                                      int(new_progress.get("artists_checked") or 0),
                                      len(combined["artists"]))
    progress["tracks_assigned"] = len(combined["tracks"])
    progress["total"] = max(int(remote_progress.get("total") or 0), int(new_progress.get("total") or 0))
    progress["complete"] = progress["next_index"] >= progress["total"] > 0
    new_failure_index = int(new_progress.get("last_error_index") or -1)
    if new_progress.get("last_error") and new_failure_index >= progress["next_index"]:
        progress["last_error"] = new_progress["last_error"]
        progress["last_error_index"] = new_failure_index
    elif int(remote_progress.get("last_error_index") or -1) >= progress["next_index"]:
        progress["last_error"] = remote_progress["last_error"]
        progress["last_error_index"] = remote_progress["last_error_index"]
    else:
        progress.pop("last_error", None)
        progress.pop("last_error_index", None)
    write(ROOT / "awen-musicbrainz.json", combined)
    write(ROOT / "awen-musicbrainz-progress.json", progress)
    print("Merged MB artists:", len(combined["artists"]), "genre hints:", len(combined["tracks"]),
          "progress:", progress["next_index"], "/", progress["total"])

if __name__ == "__main__":
    main()
