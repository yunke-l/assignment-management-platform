CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('TEACHER', 'CLASS')),
  class_id uuid REFERENCES classrooms(id),
  email text CHECK (email = lower(email)),
  max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK ((kind = 'TEACHER' AND class_id IS NULL AND email IS NOT NULL AND max_uses = 1)
    OR (kind = 'CLASS' AND class_id IS NOT NULL))
);
CREATE INDEX invitations_class_idx ON invitations(class_id);
