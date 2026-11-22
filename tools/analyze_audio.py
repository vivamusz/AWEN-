#!/usr/bin/env python3
"""AWEN local audio analysis: authorized FULL-TRACK files only.

No Apple/YouTube preview downloading, streaming-service scraping, or audio upload.
Measurements are numeric features, not verified genre, mood, or Spotify energy.
Install: pip install -r tools/audio-requirements.txt
Run: python tools/analyze_audio.py --audio-dir /path/to/authorized/audio

Audio directory filenames: awen-123.mp3, awen-124.wav, etc.
Alternative: --manifest mappings.json with {"awen-123":"/path/song.mp3"}.
Only metadata is written to awen-audio-features.json.
"""
import argparse
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import librosa
import numpy as np

ID_RE = re.compile(r"^awen-[1-9]\d*$")
EXTENSIONS = {".wav", ".flac", ".mp3", ".m4a", ".ogg", ".aiff", ".aif"}
SAMPLE_RATE, HOP_LENGTH = 22050, 512
VERSION = "awen-acoustics-v1"


def bounded(value):
    return float(np.clip(value, 0, 1))


def rounded(value, digits=3):
    return round(float(value), digits) if value is not None and math.isfinite(float(value)) else None


def analyze(path, *, min_seconds=12, max_seconds=900):
    """Analyze the ENTIRE local file; reject excessively long or short audio."""
    duration = float(librosa.get_duration(path=str(path)))
    if not min_seconds <= duration <= max_seconds:
        raise ValueError(f"duration {duration:.1f}s is outside {min_seconds}–{max_seconds}s")
    y, sr = librosa.load(str(path), sr=SAMPLE_RATE, mono=True)
    duration = len(y) / sr
    if duration < min_seconds or not np.all(np.isfinite(y)) or np.max(np.abs(y)) < 1e-5:
        raise ValueError("silent, corrupt, or too short recording")
    rms = librosa.feature.rms(y=y, hop_length=HOP_LENGTH)[0]
    db = 20 * np.log10(np.maximum(rms, 1e-8))
    active = db[db > float(np.max(db)) - 40]
    dynamics = float(np.percentile(active, 90) - np.percentile(active, 10)) if len(active) > 10 else None
    rms_dbfs = 20 * np.log10(max(float(np.sqrt(np.mean(y.astype(np.float64) ** 2))), 1e-8))
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=HOP_LENGTH)[0]
    zcr = librosa.feature.zero_crossing_rate(y=y, hop_length=HOP_LENGTH)[0]
    envelope = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)
    onsets = librosa.onset.onset_detect(onset_envelope=envelope, sr=sr, hop_length=HOP_LENGTH)
    onset_rate = len(onsets) / duration
    bpm, tempo_quality = None, "insufficient_beats"
    if len(onsets) >= 8 and duration >= 20:
        tempo, beats = librosa.beat.beat_track(onset_envelope=envelope, sr=sr,
                                             hop_length=HOP_LENGTH, trim=True)
        tempo = float(np.asarray(tempo).flatten()[0])
        if np.isfinite(tempo) and 40 <= tempo <= 260 and len(beats) >= 6:
            bpm, tempo_quality = round(tempo, 1), "estimate_check_half_double"
    # Heuristic: rhythmic density + spectral brightness + source RMS.
    # Highly mastered material biases this score; do not treat as perceptual energy.
    density = bounded(onset_rate / 3.0)
    brightness = bounded(float(np.median(centroid)) / 4800.0)
    amplitude = bounded((rms_dbfs + 38.0) / 34.0)
    proxy = bounded(0.50 * density + 0.25 * brightness + 0.25 * amplitude)
    return {
        "source_type": "authorized_local_file",
        "coverage": "full_track",
        "analyzer": VERSION,
        "duration_seconds": rounded(duration, 2),
        "features": {
            "tempo_bpm_estimate": bpm,
            "tempo_reliability": tempo_quality,
            "rms_dbfs": rounded(rms_dbfs, 2),
            "dynamic_range_db": rounded(dynamics, 2),
            "spectral_centroid_hz": rounded(np.median(centroid), 1),
            "zero_crossing_rate": rounded(np.mean(zcr), 4),
            "onset_density_hz": rounded(onset_rate, 3),
            "energy_proxy_0_1": rounded(proxy, 3),
        },
        "limitations": "Not calibrated energy, genre, mood, danceability or LUFS.",
    }


def file_hash(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def input_paths(audio_dir, manifest):
    files = {}
    if manifest:
        mapping = json.loads(manifest.read_text("utf-8"))
        if not isinstance(mapping, dict):
            raise ValueError("manifest must be JSON object mapping ID to local filename")
        for key, val in mapping.items():
            if ID_RE.fullmatch(key) and isinstance(val, str) and val.strip():
                files[key] = (manifest.parent / val).resolve()
    if audio_dir:
        for path in sorted(audio_dir.iterdir()):
            if path.is_file() and path.suffix.lower() in EXTENSIONS and ID_RE.fullmatch(path.stem):
                files.setdefault(path.stem, path.resolve())
    return files


def main(argv=None):
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--catalog", type=Path, default=Path("awen-catalog.json"))
    cli.add_argument("--audio-dir", type=Path)
    cli.add_argument("--manifest", type=Path)
    cli.add_argument("--output", type=Path, default=Path("awen-audio-features.json"))
    cli.add_argument("--limit", type=int, default=0)
    cli.add_argument("--max-seconds", type=int, default=900)
    args = cli.parse_args(argv)
    if not args.audio_dir and not args.manifest:
        cli.error("Provide --audio-dir or --manifest with authorized local recordings")
    known = {row["id"] for row in json.loads(args.catalog.read_text("utf-8"))["tracks"]}
    files = input_paths(args.audio_dir, args.manifest)
    if args.output.exists():
        output = json.loads(args.output.read_text("utf-8"))
        if output.get("schema_version") != 1:
            raise ValueError("Existing output has unknown schema; will not overwrite")
    else:
        output = {"schema_version": 1, "analyzer": VERSION, "tracks": {}}
    count = 0
    for track_id, path in files.items():
        if track_id not in known or not path.is_file() or path.suffix.lower() not in EXTENSIONS:
            print(f"SKIP {track_id}: unknown ID or unsupported local file")
            continue
        try:
            item = analyze(path, max_seconds=args.max_seconds)
            item["sha256"] = file_hash(path)
            item["analyzed_at"] = datetime.now(timezone.utc).isoformat()
            output["tracks"][track_id] = item
            count += 1
            print(f"OK {track_id}: {item['features']['tempo_bpm_estimate']} BPM, proxy {item['features']['energy_proxy_0_1']}")
        except Exception as exc:
            print(f"SKIP {track_id}: {exc}")
        if args.limit and count >= args.limit:
            break
    output["generated_at"] = datetime.now(timezone.utc).isoformat()
    output["analyzed_tracks"] = len(output["tracks"])
    output["note"] = "Authorized local FULL audio only; no previews downloaded. Heuristic measurements, not genre or mood predictions."
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"Saved {args.output}: {len(output['tracks'])} analyzed tracks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
