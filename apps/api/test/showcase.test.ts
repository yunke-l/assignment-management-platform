import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/database/database.js';
import { migrate } from '../src/database/migrate.js';
import { seedShowcase } from '../src/database/showcase.js';
import { ids } from '../src/database/seed.js';
import { AssignmentsService } from '../src/assignments/assignments.service.js';
import { MultiTypeService } from '../src/assignments/multi-type.service.js';
import { type Actor } from '@amp/contracts';

process.env.NODE_ENV = 'test';
process.env.DATABASE_DRIVER = 'pglite';
process.env.DATABASE_URL = 'memory://';
process.env.ALLOW_DEMO_SEED = 'true';
process.env.DEMO_PASSWORD = 'TestPassword123!';

test('showcase covers teaching, submission, media, grading and historical states without duplicating or overwriting work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amp-showcase-test-'));
  process.env.ASSET_DIRECTORY = directory;
  const db = new Database();
  try {
    await migrate(db);
    await seedShowcase(db);
    const [counts] = await db.query(`SELECT
      (SELECT count(*)::int FROM users WHERE role='TEACHER') AS teachers,
      (SELECT count(*)::int FROM users WHERE role='STUDENT') AS students,
      (SELECT count(*)::int FROM classrooms) AS classes,
      (SELECT count(*)::int FROM assignments WHERE status='PUBLISHED') AS published,
      (SELECT count(*)::int FROM assignments WHERE status='DRAFT') AS drafts,
      (SELECT count(*)::int FROM submissions) AS submissions,
      (SELECT count(*)::int FROM submissions WHERE grading_status='GRADED') AS graded,
      (SELECT count(*)::int FROM submissions WHERE grading_status='PENDING_REVIEW') AS pending,
      (SELECT count(*)::int FROM assets WHERE status='READY') AS media,
      (SELECT count(*)::int FROM grading_revisions) AS revisions`);
    assert.deepEqual(counts, {
      teachers: 3,
      students: 24,
      classes: 5,
      published: 9,
      drafts: 1,
      submissions: 67,
      graded: 50,
      pending: 17,
      media: 6,
      revisions: 20,
    });
    for (const table of [
      'users',
      'classrooms',
      'assignments',
      'questions',
      'submissions',
      'answer_results',
      'grading_drafts',
      'grading_revisions',
      'assets',
      'invitations',
    ]) {
      const rows = await db.query(`SELECT * FROM ${table}`);
      assert.doesNotMatch(
        JSON.stringify(rows),
        /\p{Script=Han}/u,
        `${table} demo data must use English`,
      );
    }
    const types = await db.query('SELECT DISTINCT question_type FROM questions');
    assert.equal(types.length, 8);
    const groups = await db.query(
      "SELECT DISTINCT definition->'config'->>'kind' AS kind FROM questions WHERE question_type='COMPOSITE'",
    );
    assert.deepEqual(groups.map((g) => g.kind).sort(), ['GENERAL', 'READING']);
    const [invalidTime] =
      await db.query(`SELECT count(*)::int AS n FROM submissions s JOIN assignments a ON a.id=s.assignment_id
      WHERE s.submitted_at<a.published_at OR s.submitted_at>a.due_at OR s.graded_at<s.submitted_at`);
    assert.equal(invalidTime!.n, 0);
    const [removed] =
      await db.query(`SELECT s.grading_status FROM assignment_recipients r JOIN submissions s
      ON s.assignment_id=r.assignment_id AND s.student_id=r.student_id WHERE r.removed_at IS NOT NULL`);
    assert.equal(removed!.grading_status, 'GRADED');
    const multi = new MultiTypeService(db, new AssignmentsService(db));
    const [teacher] = await db.query<Actor & Record<string, unknown>>(
      'SELECT id,email,name,role FROM users WHERE id=$1',
      [ids.teacher],
    );
    const [reading] = await db.query<{ id: string }>(
      "SELECT id FROM assignments WHERE title LIKE '03%'",
    );
    const stats = await multi.stats(teacher!, reading!.id);
    assert.equal(stats.submitted, 8);
    assert.equal(stats.gradedCount, 5);
    assert.equal(stats.pendingReviewCount, 3);
    const [mainReading] = await db.query(
      'SELECT grading_status FROM submissions WHERE assignment_id=$1 AND student_id=$2',
      [reading!.id, ids.student],
    );
    assert.equal(mainReading!.grading_status, 'PENDING_REVIEW');
    const mainListening = await db.query(
      "SELECT s.id FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.title LIKE '05%' AND s.student_id=$1",
      [ids.student],
    );
    assert.equal(mainListening.length, 0);

    const [draftCount] = await db.query(
      "SELECT count(*)::int AS n FROM grading_drafts d JOIN submissions s ON s.id=d.submission_id WHERE s.grading_status='PENDING_REVIEW'",
    );
    assert.equal(draftCount!.n, 6);
    const snapshot = async () => db.query(`SELECT id,title,due_at FROM assignments ORDER BY id`);
    const before = await snapshot();
    const [profile] = await db.query('SELECT password_hash FROM users WHERE id=$1', [ids.teacher]);
    await db.query("UPDATE users SET name='Alex · Edited profile' WHERE id=$1", [ids.teacher]);
    await db.query("UPDATE assignments SET title='Edited grammar lesson' WHERE title LIKE '01%'");
    await seedShowcase(db);
    const after = await snapshot();
    assert.equal(after.length, before.length);
    assert.equal(
      after.find((a) => a.title === 'Edited grammar lesson')?.id,
      before.find((a) => String(a.title).startsWith('01'))?.id,
    );
    assert.deepEqual(
      after.map((a) => a.due_at),
      before.map((a) => a.due_at),
    );
    const [unchanged] = await db.query('SELECT name,password_hash FROM users WHERE id=$1', [
      ids.teacher,
    ]);
    assert.equal(unchanged!.name, 'Alex · Edited profile');
    assert.equal(unchanged!.password_hash, profile!.password_hash);
    const [repeat] = await db.query(
      'SELECT (SELECT count(*)::int FROM submissions) AS submissions,(SELECT count(*)::int FROM grading_revisions) AS revisions,(SELECT count(*)::int FROM assets) AS media',
    );
    assert.deepEqual(repeat, { submissions: 67, revisions: 20, media: 6 });
  } finally {
    await db.onModuleDestroy();
    await rm(directory, { recursive: true, force: true });
  }
});
