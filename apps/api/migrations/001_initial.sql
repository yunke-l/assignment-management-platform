CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('TEACHER', 'STUDENT')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE classrooms (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  teacher_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX classrooms_teacher_idx ON classrooms(teacher_id);
CREATE TABLE class_memberships (
  class_id uuid NOT NULL REFERENCES classrooms(id),
  student_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX memberships_student_idx ON class_memberships(student_id);
CREATE TABLE assignments (
  id uuid PRIMARY KEY,
  class_id uuid NOT NULL REFERENCES classrooms(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX assignments_class_created_idx ON assignments(class_id, created_at DESC, id DESC);
CREATE TABLE questions (
  id uuid PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES assignments(id),
  position integer NOT NULL CHECK (position >= 0),
  prompt text NOT NULL,
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 6),
  correct_index integer NOT NULL CHECK (correct_index >= 0 AND correct_index < jsonb_array_length(options)),
  points integer NOT NULL CHECK (points BETWEEN 1 AND 100),
  UNIQUE (assignment_id, position)
);
CREATE TABLE submissions (
  id uuid PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES assignments(id),
  student_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  answers jsonb NOT NULL,
  score integer NOT NULL CHECK (score >= 0),
  max_score integer NOT NULL CHECK (max_score > 0 AND score <= max_score),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (assignment_id, student_id),
  UNIQUE (student_id, request_id)
);
CREATE INDEX submissions_student_idx ON submissions(student_id, submitted_at DESC);
