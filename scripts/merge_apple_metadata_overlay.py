#!/usr/bin/env python3
"""Merge verified Apple metadata into latest public overlay after a competing commit."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "awen-apple-metadata.json"

def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: merge_apple_metadata_overlay.py /tmp/awen-apple-batch.json")
    latest = read(TARGET)
    batch = read(sys.argv[1])
    a = latest.setdefault("tracks", {})
    for ident, patch in batch.get("tracks", {}).items():
        if ident not in a and isinstance(patch, dict) and patch.get("verified_metadata"):
            a[ident] = patch
    latest["linked_apple_tracks"] = max(int(latest.get("linked_apple_tracks") or 0),
                                        int(batch.get("linked_apple_tracks") or 0))
    latest["verified_track_count"] = sum(1 for x in a.values() if x.get("verified_metadata"))
    latest["unresolved_linked_tracks"] = max(0, latest["linked_apple_tracks"] - latest["verified_track_count"])
    latest["failed_lookup_chunks"] = min(int(latest.get("failed_lookup_chunks") or 0),
                                          int(batch.get("failed_lookup_chunks") or 0))
    TARGET.write_text(json.dumps(latest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Merged verified release metadata:", latest["verified_track_count"])

if __name__ == "__main__":
    main()
