import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { questionV2Schema, submissionV2Schema, uuidSchema } from '@amp/contracts';

test('an actual pre-upgrade database preserves question identities, revoked recipients, raw hashes and scores', async () => {
  const database = new PGlite();
  try {
    for (const filename of ['001_initial.sql', '002_accounts.sql', '003_assignment_audience.sql']) {
      await database.exec(
        await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8'),
      );
    }
    const teacher = randomUUID(),
      student = randomUUID(),
      classroom = randomUUID();
    const assignment = randomUUID(),
      question = randomUUID(),
      submission = randomUUID(),
      request = randomUUID();
    await database.query(
      'INSERT INTO users(id,email,name,role,password_hash) VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
      [
        teacher,
        'teacher@upgrade.test',
        'Teacher',
        'TEACHER',
        'fixture',
        student,
        'student@upgrade.test',
        'Student',
        'STUDENT',
        'fixture',
      ],
    );
    await database.query('INSERT INTO classrooms(id,name,teacher_id) VALUES ($1,$2,$3)', [
      classroom,
      'History',
      teacher,
    ]);
    await database.query(
      "INSERT INTO assignments(id,class_id,title,status,due_at,version) VALUES ($1,$2,'History','PUBLISHED',now()+interval '1 day',3)",
      [assignment, classroom],
    );
    await database.query(
      'INSERT INTO assignment_recipients(assignment_id,student_id,removed_at) VALUES ($1,$2,now())',
      [assignment, student],
    );
    await database.query(
      'INSERT INTO questions(id,assignment_id,position,prompt,options,correct_index,points) VALUES ($1,$2,0,$3,$4::jsonb,1,7)',
      [question, assignment, 'Choose the verb.', JSON.stringify(['blue', 'run'])],
    );
    const raw = [{ questionId: question, selectedIndex: 1 }];
    await database.query(
      'INSERT INTO submissions(id,assignment_id,student_id,request_id,request_hash,answers,score,max_score) VALUES ($1,$2,$3,$4,$5,$6::jsonb,7,7)',
      [submission, assignment, student, request, 'unchanged-legacy-hash', JSON.stringify(raw)],
    );
    await database.exec(
      await readFile(
        new URL('../migrations/004_multi_type_questions.sql', import.meta.url),
        'utf8',
      ),
    );
    const upgradedQuestion = (
      await database.query<{ id: string; definition: unknown }>(
        'SELECT id,definition FROM questions WHERE id=$1',
        [question],
      )
    ).rows[0]!;
    assert.equal(upgradedQuestion.id, question);
    const model = questionV2Schema.parse(upgradedQuestion.definition);
    assert.equal(model.type, 'SINGLE_CHOICE');
    if (model.type !== 'SINGLE_CHOICE') throw new Error('Unexpected migration type.');
    uuidSchema.parse(model.config.options[0]!.id);
    assert.equal(model.answerKey.correctOptionId, model.config.options[1]!.id);
    const firstOptions = JSON.stringify(model.config.options);
    const repeat = (
      await database.query<{ definition: unknown }>(
        'SELECT definition FROM questions WHERE id=$1',
        [question],
      )
    ).rows[0]!;
    assert.equal(
      JSON.stringify(questionV2Schema.parse(repeat.definition).config),
      JSON.stringify(model.config),
    );
    assert.ok(firstOptions.includes('run'));
    const stored = (
      await database.query<{
        request_hash: string;
        answers: unknown;
        answers_v2: unknown;
        score: number;
        max_score: number;
        objective_score: number;
        grading_status: string;
        published_version: number;
      }>('SELECT * FROM submissions WHERE id=$1', [submission])
    ).rows[0]!;
    assert.deepEqual(stored.answers, raw);
    assert.equal(stored.request_hash, 'unchanged-legacy-hash');
    assert.equal(stored.score, 7);
    assert.equal(stored.max_score, 7);
    assert.equal(stored.objective_score, 7);
    assert.equal(stored.grading_status, 'GRADED');
    assert.equal(stored.published_version, 3);
    const mapped = submissionV2Schema.parse({
      schemaVersion: 2,
      publishedVersion: 3,
      requestId: request,
      answers: stored.answers_v2,
    });
    assert.equal(
      mapped.answers[0]!.type === 'SINGLE_CHOICE' && mapped.answers[0]!.payload.optionId,
      model.answerKey.correctOptionId,
    );
    const recipients = (
      await database.query<{ removed_at: Date | null }>(
        'SELECT removed_at FROM assignment_recipients WHERE assignment_id=$1',
        [assignment],
      )
    ).rows;
    assert.equal(recipients.length, 1);
    assert.notEqual(recipients[0]!.removed_at, null);
    const result = (
      await database.query<{ score: number; max_score: number }>(
        'SELECT score,max_score FROM answer_results WHERE submission_id=$1',
        [submission],
      )
    ).rows[0]!;
    assert.deepEqual(result, { score: 7, max_score: 7 });
    // A still-open old client can create another legacy row after migration.
    const next = randomUUID();
    await database.query(
      'INSERT INTO questions(id,assignment_id,position,prompt,options,correct_index,points) VALUES ($1,$2,1,$3,$4::jsonb,0,2)',
      [next, assignment, 'Another question.', JSON.stringify(['yes', 'no'])],
    );
    const legacyNew = (
      await database.query<{ definition: unknown }>(
        'SELECT definition FROM questions WHERE id=$1',
        [next],
      )
    ).rows[0]!;
    assert.equal(questionV2Schema.parse(legacyNew.definition).id, next);
  } finally {
    await database.close();
  }
});
