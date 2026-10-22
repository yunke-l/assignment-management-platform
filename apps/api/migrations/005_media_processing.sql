-- Upload and decoder leases prevent cancelled or abandoned jobs from resurrecting files.
ALTER TABLE assets ADD COLUMN lease_token uuid;
ALTER TABLE assets ADD COLUMN source_format text;
ALTER TABLE assets ADD COLUMN source_ready_at timestamptz;
ALTER TABLE asset_references ADD COLUMN is_private boolean NOT NULL DEFAULT false;
CREATE INDEX asset_references_public_idx ON asset_references(asset_id,reference_type,is_private);
