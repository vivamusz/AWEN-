CREATE TABLE IF NOT EXISTS genre_suggestions (
  submission_id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  previous_genre TEXT NOT NULL,
  proposed_genre TEXT NOT NULL,
  proposed_subgenre TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS genre_suggestions_by_date ON genre_suggestions(submitted_at DESC);
CREATE INDEX IF NOT EXISTS genre_suggestions_by_status ON genre_suggestions(status, submitted_at DESC);
