import test from 'node:test';
import assert from 'node:assert/strict';
import { newQuestion, questionNumbers, questionsInDisplayOrder } from '../src/question-editor.js';

test('directory order follows numbered groups even when storage interleaves children before roots', () => {
  const roots = Array.from({ length: 10 }, (_, index) =>
    newQuestion(index === 7 || index === 8 ? 'COMPOSITE' : 'SINGLE_CHOICE', null, index),
  );
  const first = newQuestion('SINGLE_CHOICE', roots[7]!.id, 0);
  const second = newQuestion('SINGLE_CHOICE', roots[7]!.id, 1);
  const ninth = newQuestion('SINGLE_CHOICE', roots[8]!.id, 0);
  const stored = [ninth, roots[0]!, second, first, ...roots.slice(1)];
  const snapshot = JSON.stringify(stored);
  const numbers = questionNumbers(stored);
  assert.deepEqual(
    questionsInDisplayOrder(stored)
      .filter((q) => q.type !== 'COMPOSITE')
      .map((q) => numbers.get(q.id)),
    ['1', '2', '3', '4', '5', '6', '7', '8.1', '8.2', '9.1', '10'],
  );
  assert.equal(JSON.stringify(stored), snapshot);
});
