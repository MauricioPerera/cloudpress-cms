CREATE TABLE content_items_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('post', 'page')),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'trash')),
  trashed_from_status TEXT CHECK(trashed_from_status IS NULL OR trashed_from_status IN ('draft', 'published')),
  trashed_at TEXT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);
INSERT INTO content_items_next (id,kind,title,slug,excerpt,body,status,author_id,created_at,updated_at,published_at)
  SELECT id,kind,title,slug,excerpt,body,status,author_id,created_at,updated_at,published_at FROM content_items;
DROP TABLE content_items;
ALTER TABLE content_items_next RENAME TO content_items;
CREATE INDEX IF NOT EXISTS idx_content_kind_status ON content_items(kind, status);
CREATE INDEX IF NOT EXISTS idx_content_author ON content_items(author_id);
