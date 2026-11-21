#!/usr/bin/env python3
"""Fast no-network metadata and editorial patch regression tests."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from awen_match import choose, apply_verified_metadata, broad_genre
from awen_musicbrainz import map_label
from apply_curator_patches import check_patch
from awen_apple_backfill import apple_track_id, verified as verify_apple_id
from merge_apple_state import merge_catalog, merge_curations, merge_status, merge_candidates
from merge_musicbrainz_state import merge as merge_musicbrainz

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

    def test_apple_concurrent_merge_retains_existing_track_links(self):
        old = {"tracks": [
            {"id": "a", "title": "A", "source_url": "https://youtube.com/x"},
            {"id": "b", "title": "B", "source_url": ""},
        ]}
        new = {"tracks": [
            {"id": "a", "source_url": "https://music.apple.com/override"},
            {"id": "b", "source_url": "https://music.apple.com/added"},
        ]}
        merged, count = merge_catalog(old, new)
        self.assertEqual(count, 1)
        self.assertEqual(merged["tracks"][0]["source_url"], "https://youtube.com/x")
        self.assertEqual(merged["tracks"][1]["source_url"], "https://music.apple.com/added")

    def test_apple_merge_does_not_override_manual_genre(self):
        old = {"tracks": {"a": {"genre": "Phonk", "curation_method": "ручная правка владельца"}}}
        new = {"tracks": {"a": {"genre": "Pop", "verified_metadata": {"provider": "Apple"}}}}
        value = merge_curations(old, new)["tracks"]["a"]
        self.assertEqual(value["genre"], "Phonk")
        self.assertEqual(value["genre_review_candidate"], "Pop")
        self.assertEqual(value["verified_metadata"]["provider"], "Apple")

    def test_apple_cursor_and_review_merge(self):
        p = merge_status({"next_index": 80, "matched": 12, "total": 200},
                         {"next_index": 120, "matched": 30, "total": 200})
        self.assertEqual(p["next_index"], 120)
        self.assertEqual(p["matched"], 30)
        reviews = merge_candidates({"items": [{"id": "a", "reason": "review"}]},
                                   {"items": [{"id": "a", "reason": "review"}, {"id": "b", "reason": "review"}]})
        self.assertEqual(len(reviews["items"]), 2)

    def test_musicbrainz_union(self):
        a = {"artists": {"a": {"genre": "House"}}, "tracks": {"t1": {"genre": "House"}}}
        b = {"artists": {"b": {"genre": "Pop"}}, "tracks": {"t2": {"genre": "Pop"}}}
        result = merge_musicbrainz(a, b)
        self.assertEqual(len(result["artists"]), 2)
        self.assertEqual(len(result["tracks"]), 2)

    def test_linked_apple_lookup_does_not_guess_incorrect_track(self):
        self.assertEqual(apple_track_id("https://music.apple.com/kz/album/123?i=456"), 456)
        self.assertIsNone(apple_track_id("https://example.org/kz/album/123?i=456"))
        song = {"id": "awen-test", "artist": "Demo Artist", "title": "Demo Song"}
        record = {"kind": "song", "trackId": 456, "collectionId": 123,
                  "trackName": "Demo Song", "artistName": "Demo Artist",
                  "collectionName": "Demo EP", "primaryGenreName": "Ambient",
                  "releaseDate": "2020-04-05T12:00:00Z", "trackTimeMillis": 180000}
        result = verify_apple_id(song, record, 456)
        self.assertEqual(result["album"], "Demo EP")
        self.assertEqual(result["year"], 2020)
        self.assertEqual(result["year_type"], "album_release")
        self.assertEqual(result["genre"], "Chill / Lo-Fi / Ambient")
        self.assertIsNone(verify_apple_id(song, {**record, "trackName": "Different"}, 456))
        self.assertIsNone(verify_apple_id(song, {**record, "artistName": "Other Artist"}, 456))

    def test_ambiguous_broad_apple_genres_are_not_fabricated(self):
        self.assertEqual(broad_genre("Pop/Rock"), "")
        self.assertEqual(broad_genre("Alternative"), "")
        self.assertEqual(broad_genre("Ambient"), "Chill / Lo-Fi / Ambient")

if __name__ == "__main__":
    unittest.main(verbosity=2)
