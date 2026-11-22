"""Non-network tests for local AWEN audio-analysis inputs."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

MODULE = Path(__file__).resolve().parents[1] / "tools" / "analyze_audio.py"
spec = importlib.util.spec_from_file_location("awen_local_audio", MODULE)
audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio)


class AudioInputTests(unittest.TestCase):
    def test_id_filter_and_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            wav = root / "awen-5.wav"
            wav.write_bytes(b"dummy")
            (root / "foo.wav").write_bytes(b"not a track id")
            files = audio.input_paths(root, None)
            self.assertEqual(list(files), ["awen-5"])
            manifest = root / "mapping.json"
            manifest.write_text(json.dumps({"awen-12": "awen-5.wav", "bad-id": "foo.wav"}))
            self.assertEqual(set(audio.input_paths(None, manifest)), {"awen-12"})

    def test_short_audio_is_not_misrepresented_as_full_track(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "awen-9.wav"
            sr = 22050
            y = np.sin(2 * np.pi * 220 * np.arange(sr * 2) / sr) * 0.1
            sf.write(path, y, sr)
            with self.assertRaisesRegex(ValueError, "outside"):
                audio.analyze(path)

    def test_empty_manifest_writes_no_fake_features(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "awen-catalog.json").write_text('{"tracks":[{"id":"awen-1"}]}')
            (root / "manifest.json").write_text("{}")
            out = root / "results.json"
            code = audio.main(["--catalog", str(root / "awen-catalog.json"),
                               "--manifest", str(root / "manifest.json"),
                               "--output", str(out)])
            self.assertEqual(code, 0)
            result = json.loads(out.read_text())
            self.assertEqual(result["tracks"], {})
            self.assertEqual(result["analyzed_tracks"], 0)


if __name__ == "__main__":
    unittest.main()
