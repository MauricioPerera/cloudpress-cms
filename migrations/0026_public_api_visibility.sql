ALTER TABLE core_content_types ADD COLUMN public_api INTEGER NOT NULL DEFAULT 0 CHECK(public_api IN (0,1));
ALTER TABLE plugin_content_types ADD COLUMN public_api INTEGER NOT NULL DEFAULT 0 CHECK(public_api IN (0,1));
