ALTER TABLE assets ADD COLUMN caption text NOT NULL DEFAULT '';
ALTER TABLE assets ADD CONSTRAINT asset_caption_length CHECK (char_length(caption) <= 500);
