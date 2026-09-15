CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comments_content_status ON comments(content_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status, created_at);

CREATE TABLE IF NOT EXISTS comment_rate_limits (
  fingerprint TEXT PRIMARY KEY,
  last_created_at TEXT NOT NULL
);
