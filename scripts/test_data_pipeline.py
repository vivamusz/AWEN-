#!/usr/bin/env python3
"""Fast no-network metadata and editorial patch regression tests."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from awen_match import choose, apply_verified_metadata, broad_genre
from awen_musicbrainz import map_label
from apply_curator_patches import check_patch

class CatalogPipelineTests(unittest.TestCase):
    def setUp(self):
        self.track = {"id": "awen-123", "artist": "Test Artist", "title": "Test Song"}
        self.apple = {
            "kind": "song", "artistName": "Test Artist", "trackName": "Test Song",
            "collectionId": 234, "trackId": 123, "collectionName": "Test Album",
            "primaryGenreName": "Country", "releaseDate": "2021-03-20T00:00:00Z",
            "trackTimeMillis": 223000,
        }

    def test_strict_song_metadata(self):
        status, match = choose("Test Artist", "Test Song", [self.apple])
        self.assertEqual(status, "exact_metadata")
        self.assertTrue(match["url"].startswith("https://music.apple.com/kz/album/"))
        doc = {"tracks": {}}
        self.assertTrue(apply_verified_metadata(self.track, match, doc))
        value = doc["tracks"][self.track["id"]]
        self.assertEqual(value["genre"], "Country")
        self.assertEqual(value["album"], "Test Album")
        self.assertEqual(value["year"], 2021)
        self.assertEqual(value["duration"], 223)
        self.assertEqual(value["year_type"], "album_release")

    def test_mismatch_not_accepted(self):
        doc = {"tracks": {}}
        status, match = choose("Wrong Artist", "Test Song", [self.apple])
        self.assertNotEqual(status, "exact_metadata")
        self.assertFalse(apply_verified_metadata(self.track, {**self.apple, "title": "Different Song", "artist": "Test Artist"}, doc))
        self.assertFalse(doc["tracks"])

    def test_existing_manual_genre_preserved(self):
        doc = {"tracks": {"awen-123": {"genre": "Rock / Indie", "curation_method": "ручная правка владельца"}}}
        status, match = choose("Test Artist", "Test Song", [self.apple])
        self.assertEqual(status, "exact_metadata")
        apply_verified_metadata(self.track, match, doc)
        p = doc["tracks"]["awen-123"]
        self.assertEqual(p["genre"], "Rock / Indie")
        self.assertEqual(p["genre_review_candidate"], "Country")

    def test_broad_genres(self):
        self.assertEqual(broad_genre("Country"), "Country")
        self.assertEqual(broad_genre("Electronic"), "")
        self.assertEqual(map_label("lo-fi hip hop"), "Chill / Lo-Fi / Ambient")

    def test_editor_patch_validation(self):
        valid = {
            "genre": "Phonk", "playlists": ["night"], "subgenres": ["Chill Phonk"],
            "year": 2021, "curation_method": "ручная правка владельца",
            "source_url": "https://example.com/do-not-copy",
        }
        cleaned, ignored = check_patch("awen-123", valid)
        self.assertNotIn("source_url", cleaned)
        self.assertIn("source_url", ignored)
        self.assertEqual(cleaned["genre"], "Phonk")
        for patch in (
            {"genre": "Made-up Genre"},
            {"playlists": ["not-a-playlist"]},
            {"year": 0},
            {"year": True},
            {"moods": "not an array"},
        ):
            with self.subTest(patch=patch):
                with self.assertRaises(ValueError):
                    check_patch("awen-123", patch)

if __name__ == "__main__":
    unittest.main(verbosity=2)
