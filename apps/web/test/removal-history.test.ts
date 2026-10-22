import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newQuestion,
  withDerivedPoints,
  unitPoints,
  reindexQuestions,
} from '../src/question-editor.js';
import { hasRemoval, restoreRemoval } from '../src/removal-history.js';

test('restoring a removed question preserves subsequent edits, additions and order', () => {
  const first = newQuestion('SINGLE_CHOICE'),
    removed = newQuestion('SINGLE_CHOICE', null, 1);
  const added = newQuestion('ORDERING', null, 1);
  const before = [first, removed],
    after = [first];
  const current = [{ ...first, explanation: 'Written after deletion' }, added];
  assert.equal(hasRemoval(before, after), true);
  assert.equal(hasRemoval(after, current), false);
  const restored = restoreRemoval({ before, after }, current);
  assert.deepEqual(
    restored.map((q) => q.id),
    [first.id, added.id, removed.id],
  );
  assert.equal(restored[0]!.explanation, 'Written after deletion');
  assert.deepEqual(
    restored.map((q) => q.position),
    [0, 1, 2],
  );
});
test('restoring an option also restores its correct key without overwriting later question text', () => {
  const q = newQuestion('SINGLE_CHOICE');
  if (q.type !== 'SINGLE_CHOICE') throw new Error('Unexpected type');
  q.answerKey.correctOptionId = q.config.options[3]!.id;
  const after = {
    ...q,
    config: { options: q.config.options.slice(0, 3) },
    answerKey: { correctOptionId: null },
  };
  const current = {
    ...after,
    explanation: 'Keep this edit',
    config: {
      options: after.config.options.map((o, i) => (i === 0 ? { ...o, label: 'Updated A' } : o)),
    },
  };
  const restored = restoreRemoval({ before: [q], after: [after] }, [current])[0]!;
  if (restored.type !== 'SINGLE_CHOICE') throw new Error('Unexpected type');
  assert.equal(restored.config.options.length, 4);
  assert.equal(restored.config.options[0]!.label, 'Updated A');
  assert.equal(restored.answerKey.correctOptionId, q.answerKey.correctOptionId);
  assert.equal(restored.explanation, 'Keep this edit');
  // A deliberately selected newer key takes precedence over the restored key.
  const newer = { ...current, answerKey: { correctOptionId: q.config.options[0]!.id } };
  const result = restoreRemoval({ before: [q], after: [after] }, [newer])[0]!;
  assert.ok(result.type === 'SINGLE_CHOICE');
  assert.equal(result.answerKey.correctOptionId, newer.answerKey.correctOptionId);
});
test('restoring a group restores its children and retains later changes to other questions', () => {
  const group = newQuestion('COMPOSITE'),
    child = newQuestion('FILL_BLANK', group.id);
  const other = newQuestion('SINGLE_CHOICE', null, 1);
  const restored = restoreRemoval(
    { before: [group, child, other], after: reindexQuestions([other]) },
    [{ ...other, position: 0, explanation: 'Retain' }],
  );
  assert.equal(restored.length, 3);
  assert.equal(restored.find((q) => q.id === child.id)!.parentId, group.id);
  assert.equal(restored.find((q) => q.id === other.id)!.explanation, 'Retain');
});
test('derived points cover every unit-scored type and leave whole-question scores editable', () => {
  for (const type of ['FILL_BLANK', 'CLOZE_CHOICE', 'GROUPING', 'MATCHING', 'RESPONSE'] as const) {
    const q = newQuestion(type);
    if (q.type === 'COMPOSITE') throw new Error('Unexpected type');
    const normalized = withDerivedPoints({ ...q, points: 97 });
    assert.equal(normalized.points, Math.max(1, unitPoints(q)!));
  }
  for (const type of ['SINGLE_CHOICE', 'ORDERING'] as const) {
    const q = newQuestion(type);
    if (q.type === 'COMPOSITE') throw new Error('Unexpected type');
    assert.equal(unitPoints(q), null);
    assert.equal(withDerivedPoints({ ...q, points: 10 }).points, 10);
  }
});
test('changing a type never records a removal or revives incompatible old fields', () => {
  const q = newQuestion('SINGLE_CHOICE');
  if (q.type !== 'SINGLE_CHOICE') throw new Error('Unexpected type');
  const changed = { ...newQuestion('FILL_BLANK'), id: q.id };
  assert.equal(hasRemoval([q], [changed]), false);
  const after = { ...q, config: { options: q.config.options.slice(0, 3) } };
  const restored = restoreRemoval({ before: [q], after: [after] }, [changed]);
  assert.deepEqual(restored, [changed]);
});
