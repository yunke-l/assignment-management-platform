import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/database/database.js';
import { migrate } from '../src/database/migrate.js';
import { seedShowcase } from '../src/database/showcase.js';
import { ids, seed } from '../src/database/seed.js';
import { showcaseAnswers, showcaseQuestions, paragraph } from '../src/database/showcase-content.js';
import { expandShowcaseComposites } from '../src/database/showcase-composites.js';
import { AssignmentsService } from '../src/assignments/assignments.service.js';
import { MultiTypeService } from '../src/assignments/multi-type.service.js';
import { createAssignmentV2Schema, questionV2Schema, type Actor } from '@amp/contracts';
import { randomUUID } from 'node:crypto';

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
    const children = await db.query(
      `SELECT p.id,count(c.id)::int AS n FROM questions p
       LEFT JOIN questions c ON c.parent_id=p.id WHERE p.question_type='COMPOSITE' GROUP BY p.id`,
    );
    assert.ok(children.every((parent) => parent.n === 4));
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

test('composite expansion adds relevant practice once and preserves historical answers and scores', async () => {
  const db = new Database();
  try {
    await migrate(db);
    await seed(db);
    const multi = new MultiTypeService(db, new AssignmentsService(db));
    const actors = await db.query<Actor & Record<string, unknown>>(
      'SELECT id,email,name,role FROM users WHERE id=ANY($1::uuid[])',
      [[ids.teacher, ids.student, ids.outsider]],
    );
    const teacher = actors.find((a) => a.id === ids.teacher)!;
    const student = actors.find((a) => a.id === ids.student)!;
    const reading = showcaseQuestions('reading').slice(0, 3);
    const project = showcaseQuestions('project').slice(0, 3);
    const travel = showcaseQuestions('reading')[0]!;
    travel.prompt = paragraph(
      'A greener school\nOur class wants to make the school greener. Answer the following task about choosing an environmentally friendly way to travel.',
    );
    const garden = showcaseQuestions('reading')[0]!;
    garden.prompt = paragraph('The school garden\nMia made signs from old cardboard.');
    const travelChild = showcaseQuestions('grammar')[0]!;
    travelChild.parentId = travel.id;
    const gardenChild = showcaseQuestions('grammar')[0]!;
    gardenChild.parentId = garden.id;
    const questions = [...reading, ...project, travel, travelChild, garden, gardenChild];
    let position = 0;
    for (const q of questions) if (!q.parentId) q.position = position++;
    const assignment = await multi.create(
      teacher,
      createAssignmentV2Schema.parse({
        schemaVersion: 2,
        classId: ids.classroom,
        title: 'Legacy composite practice',
        description: 'Learning focus: reading.\nLegacy composite practice',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        questions,
      }),
    );
    await multi.publish(teacher, assignment.id, { schemaVersion: 2, version: assignment.version });
    const original = await multi.detail(teacher, assignment.id);
    const originalQuestions = original.questions.map((q) => questionV2Schema.parse(q));
    await multi.submit(student, assignment.id, {
      schemaVersion: 2,
      publishedVersion: Number(original.publishedVersion),
      requestId: randomUUID(),
      answers: showcaseAnswers(originalQuestions, 0),
    });
    const history = async () => ({
      submissions: await db.query('SELECT * FROM submissions ORDER BY id'),
      results: await db.query('SELECT * FROM answer_results ORDER BY submission_id,question_id'),
    });
    const before = await history();
    assert.deepEqual(await expandShowcaseComposites(db), [
      { assignmentId: assignment.id, added: 10 },
    ]);
    const expanded = await multi.detail(teacher, assignment.id);
    const expandedQuestions = expanded.questions.map((q) => questionV2Schema.parse(q));
    for (const q of original.questions)
      assert.deepEqual(
        expanded.questions.find((item) => item.id === q.id),
        q,
      );
    for (const parent of expanded.questions.filter((q) => q.type === 'COMPOSITE'))
      assert.equal(expanded.questions.filter((q) => q.parentId === parent.id).length, 4);
    assert.equal(expanded.publishedVersion, Number(original.publishedVersion) + 1);
    assert.deepEqual(await history(), before);
    assert.deepEqual(await expandShowcaseComposites(db), []);
    assert.deepEqual(await multi.detail(teacher, assignment.id), expanded);
    assert.deepEqual(await history(), before);
    await db.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [
      ids.classroom,
      ids.outsider,
    ]);
    await db.query('INSERT INTO assignment_recipients(assignment_id,student_id) VALUES ($1,$2)', [
      assignment.id,
      ids.outsider,
    ]);
    const outsider = actors.find((a) => a.id === ids.outsider)!;
    await assert.rejects(
      multi.submit(outsider, assignment.id, {
        schemaVersion: 2,
        publishedVersion: Number(original.publishedVersion),
        requestId: randomUUID(),
        answers: showcaseAnswers(originalQuestions, 0),
      }),
      /Reload/,
    );
    await multi.submit(outsider, assignment.id, {
      schemaVersion: 2,
      publishedVersion: Number(expanded.publishedVersion),
      requestId: randomUUID(),
      answers: showcaseAnswers(expandedQuestions, 0),
    });
  } finally {
    await db.onModuleDestroy();
  }
});
