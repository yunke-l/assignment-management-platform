ALTER TABLE assignments ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version IN (1,2));
ALTER TABLE assignments ADD COLUMN published_version integer CHECK (published_version > 0);
UPDATE assignments SET published_version=version WHERE status='PUBLISHED';

-- Deterministic UUIDv8 identifiers provide a persisted, stable mapping from old indices.
-- This hash names legacy objects; it is not used for authentication or integrity.
CREATE FUNCTION amp_legacy_uuid(seed text) RETURNS uuid LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (substr(md5(seed),1,12)||'8'||substr(md5(seed),14,3)||'8'||substr(md5(seed),18,15))::uuid
$$;

ALTER TABLE questions ADD COLUMN question_type text NOT NULL DEFAULT 'SINGLE_CHOICE'
  CHECK (question_type IN ('SINGLE_CHOICE','FILL_BLANK','CLOZE_CHOICE','GROUPING','MATCHING','ORDERING','RESPONSE','COMPOSITE'));
ALTER TABLE questions ADD COLUMN parent_id uuid REFERENCES questions(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE questions ADD COLUMN definition jsonb;
ALTER TABLE questions ALTER COLUMN options DROP NOT NULL;
ALTER TABLE questions ALTER COLUMN correct_index DROP NOT NULL;
ALTER TABLE questions DROP CONSTRAINT questions_points_check;
ALTER TABLE questions ADD CONSTRAINT questions_points_check CHECK (
  (question_type='COMPOSITE' AND points=0 AND parent_id IS NULL) OR
  (question_type<>'COMPOSITE' AND points BETWEEN 1 AND 100)
);
ALTER TABLE questions DROP CONSTRAINT questions_assignment_id_position_key;
CREATE UNIQUE INDEX questions_sibling_position_idx ON questions(assignment_id,COALESCE(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),position);

CREATE FUNCTION amp_legacy_definition(qid uuid, pos integer, title text, choices jsonb, correct integer, score integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT jsonb_build_object(
    'id',qid,'parentId',NULL,'position',pos,'type','SINGLE_CHOICE','points',score,
    'evidenceEnabled',false,'explanation','','answerAreaContent','[]'::jsonb,
    'prompt',jsonb_build_array(jsonb_build_object(
      'id',amp_legacy_uuid(qid::text||':prompt'),'type','paragraph',
      'children',jsonb_build_array(jsonb_build_object('type','text','text',title)))),
    'config',jsonb_build_object('options',(
      SELECT jsonb_agg(jsonb_build_object(
        'id',amp_legacy_uuid(qid::text||':option:'||(c.ordinality-1)::text),'label',left(c.value,100),
        'content',jsonb_build_array(jsonb_build_object(
          'id',amp_legacy_uuid(qid::text||':option-node:'||(c.ordinality-1)::text),'type','paragraph',
          'children',jsonb_build_array(jsonb_build_object('type','text','text',c.value))))) ORDER BY c.ordinality)
      FROM jsonb_array_elements_text(choices) WITH ORDINALITY c(value,ordinality))),
    'answerKey',jsonb_build_object('correctOptionId',amp_legacy_uuid(qid::text||':option:'||correct::text)))
$$;

UPDATE questions SET definition=amp_legacy_definition(id,position,prompt,options,correct_index,points);
ALTER TABLE questions ADD CONSTRAINT questions_definition_check CHECK (
  definition IS NOT NULL AND jsonb_typeof(definition)='object' AND definition ?& ARRAY['id','type','config','answerKey','prompt','answerAreaContent','position','points','parentId']
  AND definition->>'type'=question_type AND definition->>'id'=id::text
);
CREATE FUNCTION amp_prepare_legacy_question() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.definition IS NULL THEN
    NEW.definition := amp_legacy_definition(NEW.id,NEW.position,NEW.prompt,NEW.options,NEW.correct_index,NEW.points);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER prepare_legacy_question BEFORE INSERT ON questions FOR EACH ROW EXECUTE FUNCTION amp_prepare_legacy_question();

ALTER TABLE submissions ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version IN (1,2));
ALTER TABLE submissions ADD COLUMN published_version integer NOT NULL DEFAULT 1 CHECK (published_version>0);
ALTER TABLE submissions ADD COLUMN answers_v2 jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(answers_v2)='array');
ALTER TABLE submissions ADD COLUMN grading_status text NOT NULL DEFAULT 'GRADED' CHECK (grading_status IN ('PENDING_REVIEW','GRADED'));
ALTER TABLE submissions ADD COLUMN objective_score integer NOT NULL DEFAULT 0 CHECK (objective_score>=0);
ALTER TABLE submissions ADD COLUMN objective_max_score integer NOT NULL DEFAULT 0 CHECK (objective_max_score>=0 AND objective_score<=objective_max_score);
ALTER TABLE submissions ADD COLUMN grading_version integer NOT NULL DEFAULT 0 CHECK (grading_version>=0);
ALTER TABLE submissions ADD COLUMN published_grading_version integer NOT NULL DEFAULT 0 CHECK (published_grading_version>=0 AND published_grading_version<=grading_version);
ALTER TABLE submissions ADD COLUMN graded_at timestamptz;
ALTER TABLE submissions ALTER COLUMN score DROP NOT NULL;
UPDATE submissions s SET objective_score=s.score,objective_max_score=s.max_score,
  graded_at=s.submitted_at,published_version=COALESCE(a.published_version,a.version),
  answers_v2=COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'questionId',ans->>'questionId','type','SINGLE_CHOICE',
    'payload',jsonb_build_object('optionId',amp_legacy_uuid((ans->>'questionId')||':option:'||(ans->>'selectedIndex'))),
    'evidenceAssetIds','[]'::jsonb)) FROM jsonb_array_elements(s.answers) ans),'[]'::jsonb)
FROM assignments a WHERE a.id=s.assignment_id;
ALTER TABLE submissions ADD CONSTRAINT submissions_grading_check CHECK (
  (grading_status='PENDING_REVIEW' AND score IS NULL AND graded_at IS NULL) OR
  (grading_status='GRADED' AND score IS NOT NULL AND graded_at IS NOT NULL)
);
CREATE FUNCTION amp_prepare_legacy_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.schema_version=1 THEN
    NEW.objective_score := NEW.score;
    NEW.objective_max_score := NEW.max_score;
    NEW.graded_at := NEW.submitted_at;
    SELECT COALESCE(published_version,version) INTO NEW.published_version FROM assignments WHERE id=NEW.assignment_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'questionId',ans->>'questionId','type','SINGLE_CHOICE',
      'payload',jsonb_build_object('optionId',(q.definition->'config'->'options'->((ans->>'selectedIndex')::integer))->>'id'),
      'evidenceAssetIds','[]'::jsonb)),'[]'::jsonb) INTO NEW.answers_v2 FROM jsonb_array_elements(NEW.answers) ans
      JOIN questions q ON q.id=(ans->>'questionId')::uuid AND q.assignment_id=NEW.assignment_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER prepare_legacy_submission BEFORE INSERT ON submissions FOR EACH ROW EXECUTE FUNCTION amp_prepare_legacy_submission();
CREATE FUNCTION amp_freeze_publication_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='PUBLISHED' AND NEW.published_version IS NULL THEN
    NEW.published_version := NEW.version;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER freeze_publication_version BEFORE UPDATE ON assignments FOR EACH ROW EXECUTE FUNCTION amp_freeze_publication_version();

CREATE TABLE answer_results (
  submission_id uuid NOT NULL REFERENCES submissions(id),
  question_id uuid NOT NULL REFERENCES questions(id),
  question_type text NOT NULL,
  answer_payload jsonb NOT NULL,
  score integer CHECK (score>=0),
  max_score integer NOT NULL CHECK (max_score BETWEEN 1 AND 100 AND (score IS NULL OR score<=max_score)),
  units jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(units)='array'),
  feedback text NOT NULL DEFAULT '',
  PRIMARY KEY (submission_id,question_id)
);
INSERT INTO answer_results(submission_id,question_id,question_type,answer_payload,score,max_score,units)
SELECT s.id,q.id,'SINGLE_CHOICE',ans->'payload',
  CASE WHEN ans->'payload'->>'optionId'=q.definition->'answerKey'->>'correctOptionId' THEN q.points ELSE 0 END,
  q.points,jsonb_build_array(jsonb_build_object('unitId',q.id,
    'correct',ans->'payload'->>'optionId'=q.definition->'answerKey'->>'correctOptionId',
    'score',CASE WHEN ans->'payload'->>'optionId'=q.definition->'answerKey'->>'correctOptionId' THEN q.points ELSE 0 END,'points',q.points))
FROM submissions s CROSS JOIN LATERAL jsonb_array_elements(s.answers_v2) ans
JOIN questions q ON q.id=(ans->>'questionId')::uuid AND q.assignment_id=s.assignment_id;
CREATE FUNCTION amp_record_legacy_results() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.schema_version=1 THEN
    INSERT INTO answer_results(submission_id,question_id,question_type,answer_payload,score,max_score,units)
    SELECT NEW.id,q.id,'SINGLE_CHOICE',ans->'payload',
      CASE WHEN ans->'payload'->>'optionId'=q.definition->'answerKey'->>'correctOptionId' THEN q.points ELSE 0 END,
      q.points,jsonb_build_array(jsonb_build_object('unitId',q.id,
        'correct',ans->'payload'->>'optionId'=q.definition->'answerKey'->>'correctOptionId',
        'score',CASE WHEN ans->'payload'->>'optionId'=q.definition->'answerKey'->>'correctOptionId' THEN q.points ELSE 0 END,'points',q.points))
    FROM jsonb_array_elements(NEW.answers_v2) ans
    JOIN questions q ON q.id=(ans->>'questionId')::uuid AND q.assignment_id=NEW.assignment_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER record_legacy_results AFTER INSERT ON submissions FOR EACH ROW EXECUTE FUNCTION amp_record_legacy_results();

CREATE TABLE grading_drafts (
  submission_id uuid PRIMARY KEY REFERENCES submissions(id),
  teacher_id uuid NOT NULL REFERENCES users(id),
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='array'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE grading_revisions (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES submissions(id),
  teacher_id uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL CHECK (version>0),
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='array'),
  score integer NOT NULL CHECK (score>=0),
  max_score integer NOT NULL CHECK (max_score>0 AND score<=max_score),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (submission_id,version),
  UNIQUE (teacher_id,request_id)
);
CREATE INDEX submissions_grading_idx ON submissions(assignment_id,grading_status);

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  assignment_id uuid REFERENCES assignments(id) ON DELETE SET NULL,
  question_id uuid,
  content_node_id uuid,
  purpose text NOT NULL CHECK (purpose IN ('TEACHING','ANSWER')),
  kind text NOT NULL CHECK (kind IN ('image','audio')),
  status text NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING','PROCESSING','READY','FAILED','DELETED')),
  upload_request_id uuid NOT NULL,
  upload_hash text NOT NULL,
  original_name text NOT NULL,
  declared_mime text NOT NULL,
  declared_bytes bigint NOT NULL CHECK (declared_bytes>0),
  actual_bytes bigint CHECK (actual_bytes>0),
  mime text,
  storage_key text NOT NULL UNIQUE,
  display_key text,
  thumbnail_key text,
  sha256 text,
  width integer,
  height integer,
  duration_seconds numeric,
  transcript text NOT NULL DEFAULT '',
  error_code text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  detached_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (owner_id,upload_request_id),
  CHECK (purpose<>'ANSWER' OR question_id IS NOT NULL),
  CHECK (status<>'READY' OR (actual_bytes IS NOT NULL AND mime IS NOT NULL AND sha256 IS NOT NULL AND display_key IS NOT NULL))
);
CREATE INDEX assets_workspace_idx ON assets(owner_id,assignment_id,status);
CREATE INDEX assets_processing_idx ON assets(status,lease_until) WHERE status='PROCESSING';
CREATE TABLE asset_references (
  asset_id uuid NOT NULL REFERENCES assets(id),
  reference_type text NOT NULL CHECK (reference_type IN ('DRAFT','PUBLISHED','ANSWER')),
  reference_id uuid NOT NULL,
  location_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (asset_id,reference_type,reference_id,location_id)
);
CREATE INDEX asset_references_entity_idx ON asset_references(reference_type,reference_id);
CREATE TABLE upload_events (
  owner_id uuid NOT NULL REFERENCES users(id),
  upload_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id,upload_id)
);
CREATE INDEX upload_events_time_idx ON upload_events(owner_id,created_at);
