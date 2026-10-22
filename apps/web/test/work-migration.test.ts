import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AssignmentDetailV2 } from '@amp/contracts';
import { recoverTeacherDraft, recoverStudentDraft } from '../src/work-migration.js';
import { compatibleDraft, emptyAnswer } from '../src/answer-draft.js';
import { cloneQuestions, newQuestion, reconcileSavedQuestions } from '../src/question-editor.js';
const initial = () => {
  const q = newQuestion('SINGLE_CHOICE');
  return { id: randomUUID(), publishedVersion: 3, questions: [q] } as AssignmentDetailV2;
};
test('a late save response preserves an upload initialized after its request snapshot', () => {
  const before = newQuestion('SINGLE_CHOICE'),
    assetId = randomUUID();
  const latest = {
    ...before,
    prompt: [
      ...before.prompt,
      { id: randomUUID(), type: 'image' as const, assetId, label: '', alt: '', caption: '' },
    ],
  };
  const result = reconcileSavedQuestions([before], [latest], [structuredClone(before)]);
  assert.deepEqual(result, [latest]);
});
test('a late save retains edited ordering content and adopts the persisted initial permutation', () => {
  const before = newQuestion('ORDERING');
  if (before.type !== 'ORDERING') throw new Error('Unexpected type');
  const saved = {
    ...before,
    config: {
      ...before.config,
      initialOrder: before.config.items.map((item) => item.id).reverse(),
    },
  };
  const latest = { ...before, prompt: [] };
  const result = reconcileSavedQuestions([before], [latest], [saved])[0]!;
  assert.deepEqual(result.prompt, []);
  assert.equal(result.type === 'ORDERING' && result.config.initialOrder, saved.config.initialOrder);
});
test('legacy teacher work preserves text and keys with entirely new local identities, retaining the original copy', () => {
  const qid = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  const old = {
    classId: randomUUID(),
    title: 'Unfinished work',
    description: '',
    dueDate: '2035-10-01',
    dueTime: '12:00',
    version: 2,
    questions: [
      {
        id: qid,
        prompt: '<script>literal text only</script>',
        points: '10',
        correctId: b,
        options: [
          { id: a, text: 'Owl' },
          { id: b, text: 'Robin' },
        ],
      },
    ],
  };
  const restored = recoverTeacherDraft(old, initial())!;
  assert.equal(restored.version, 2);
  assert.equal(restored.title, old.title);
  assert.deepEqual(restored.legacyBackup, old);
  const q = restored.questions[0]!;
  assert.notEqual(q.id, qid);
  assert.equal(q.points, 10);
  if (q.type !== 'SINGLE_CHOICE') throw new Error('Unexpected type');
  assert.notEqual(q.config.options[1]!.id, b);
  assert.equal(q.answerKey.correctOptionId, q.config.options[1]!.id);
  assert.deepEqual(q.prompt[0], {
    id: q.prompt[0]!.id,
    type: 'paragraph',
    children: [{ type: 'text', text: old.questions[0]!.prompt }],
  });
});
test('legacy student indices map to saved IDs and preserve an unchanged legacy request UUID', () => {
  const assignment = initial(),
    q = assignment.questions[0]!;
  if (q.type !== 'SINGLE_CHOICE') throw new Error('Unexpected type');
  const id = randomUUID(),
    old = { answers: { [q.id]: 1 }, retry: { id, fingerprint: 'old raw fingerprint' } };
  const restored = recoverStudentDraft(old, assignment)!;
  assert.equal(restored.answers[q.id]!.optionId, q.config.options[1]!.id);
  assert.equal(restored.legacyRetry!.id, id);
  assert.equal(restored.retry, null);
  assert.deepEqual(restored.legacyBackup, old);
  const unmapped = recoverStudentDraft(
    { answers: { [randomUUID()]: 1 }, retry: null },
    assignment,
  )!;
  assert.deepEqual(unmapped.answers, {});
  assert.ok(unmapped.legacyBackup);
});
test('restored ordering rejects unknown IDs and clears confirmation without modifying response text', () => {
  const q = newQuestion('ORDERING');
  const input = {
    ...emptyAnswer(),
    orderedItemIds: [randomUUID(), randomUUID()],
    confirmed: true,
    text: 'Keep this text',
  };
  const restored = compatibleDraft(q, input);
  assert.equal(restored.confirmed, false);
  assert.deepEqual(restored.orderedItemIds, []);
  assert.equal(restored.text, input.text);
});
test('copying a reading group remaps keys and blank tokens while retaining literal UUID text and immutable assets', () => {
  const group = newQuestion('COMPOSITE'),
    fill = newQuestion('FILL_BLANK', group.id, 0),
    blankId = randomUUID(),
    assetId = randomUUID();
  if (fill.type !== 'FILL_BLANK') throw new Error('Unexpected type');
  fill.config.blanks = [{ id: blankId, points: 1, caseSensitive: false }];
  fill.answerKey.answers = [{ blankId, values: [blankId] }];
  fill.prompt = [
    {
      id: randomUUID(),
      type: 'paragraph',
      children: [
        { type: 'text', text: blankId },
        { type: 'blank', blankId },
      ],
    },
    { id: randomUUID(), type: 'image', assetId, label: 'Picture', alt: 'Picture', caption: '' },
  ];
  const [copiedGroup, copiedFill] = cloneQuestions([group, fill]);
  assert.notEqual(copiedGroup!.id, group.id);
  assert.equal(copiedFill!.parentId, copiedGroup!.id);
  if (copiedFill?.type !== 'FILL_BLANK') throw new Error('Unexpected type');
  assert.notEqual(copiedFill.config.blanks[0]!.id, blankId);
  assert.equal(copiedFill.answerKey.answers[0]!.blankId, copiedFill.config.blanks[0]!.id);
  assert.equal(copiedFill.answerKey.answers[0]!.values[0], blankId);
  const text = copiedFill.prompt[0];
  if (text?.type !== 'paragraph') throw new Error('Unexpected block');
  assert.equal(text.children[0]?.type === 'text' ? text.children[0].text : '', blankId);
  const media = copiedFill.prompt[1];
  assert.equal(media && 'assetId' in media ? media.assetId : null, assetId);
});
