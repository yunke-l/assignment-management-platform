ALTER TABLE assignments ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE TABLE assignment_recipients (
  assignment_id uuid NOT NULL REFERENCES assignments(id),
  student_id uuid NOT NULL REFERENCES users(id),
  removed_at timestamptz,
  PRIMARY KEY (assignment_id, student_id)
);
CREATE INDEX recipients_student_idx ON assignment_recipients(student_id, assignment_id) WHERE removed_at IS NULL;
-- Preserve both current recipients and historical submissions when upgrading the starter.
INSERT INTO assignment_recipients(assignment_id,student_id)
SELECT a.id,m.student_id FROM assignments a JOIN class_memberships m ON m.class_id=a.class_id WHERE a.status='PUBLISHED'
UNION SELECT assignment_id,student_id FROM submissions;
UPDATE assignment_recipients r SET removed_at=clock_timestamp()
WHERE NOT EXISTS (SELECT 1 FROM assignments a JOIN class_memberships m ON m.class_id=a.class_id
  WHERE a.id=r.assignment_id AND m.student_id=r.student_id);
