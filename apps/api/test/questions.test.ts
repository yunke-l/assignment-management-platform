import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  questionV2Schema,
  createAssignmentV2Schema,
  submissionV2Schema,
  validateQuestions,
  validateAnswers,
  gradeAnswers,
  normalizeBlank,
  publicQuestion,
  canonicalSubmission,
  limitedText,
  mediaLimits,
  type QuestionV2,
  type Content,
  type ChoiceV2,
  type AnswerV2,
} from '@amp/contracts';

const text = (value: string): Content => [
  { id: randomUUID(), type: 'paragraph', children: [{ type: 'text', text: value }] },
];
const choice = (label: string): ChoiceV2 => ({ id: randomUUID(), label, content: text(label) });
function make<T extends QuestionV2['type']>(
  type: T,
  config: unknown,
  answerKey: unknown,
  points = 1,
): Extract<QuestionV2, { type: T }> {
  return questionV2Schema.parse({
    id: randomUUID(),
    parentId: null,
    position: 0,
    prompt: text('Complete this task.'),
    answerAreaContent: [],
    points: type === 'COMPOSITE' ? 0 : points,
    evidenceEnabled: false,
    explanation: 'Teacher-only explanation.',
    type,
    config,
    answerKey,
  }) as Extract<QuestionV2, { type: T }>;
}
const answer = (q: QuestionV2, payload: unknown): AnswerV2 =>
  submissionV2Schema.parse({
    schemaVersion: 2,
    publishedVersion: 1,
    requestId: randomUUID(),
    answers: [{ questionId: q.id, type: q.type, payload }],
  }).answers[0]!;
function fill() {
  const blanks = [
    { id: randomUUID(), points: 2, caseSensitive: false },
    { id: randomUUID(), points: 3, caseSensitive: true },
  ];
  const q = make(
    'FILL_BLANK',
    { blanks },
    {
      answers: [
        { blankId: blanks[0]!.id, values: ['London'] },
        { blankId: blanks[1]!.id, values: ['Paris'] },
      ],
    },
    5,
  );
  q.prompt[0] = {
    id: randomUUID(),
    type: 'paragraph',
    children: [
      { type: 'text', text: 'Name the cities: ' },
      ...blanks.map((b) => ({ type: 'blank' as const, blankId: b.id })),
    ],
  };
  return q;
}
test('fill matching preserves meaningful punctuation, accents and explicit case rules', () => {
  assert.equal(normalizeBlank('  LONDON  '), 'london');
  assert.equal(normalizeBlank('a\t  lot'), 'a lot');
  assert.notEqual(normalizeBlank('its'), normalizeBlank("it's"));
  assert.notEqual(normalizeBlank('don’t'), normalizeBlank("don't"));
  assert.notEqual(normalizeBlank('café'), normalizeBlank('cafe'));
  assert.equal(normalizeBlank('cafe\u0301'), normalizeBlank('café'));
  assert.notEqual(normalizeBlank('Paris', true), normalizeBlank('paris', true));
  const q = fill();
  assert.deepEqual(validateQuestions([q]), []);
  const a = answer(q, {
    blanks: [
      { blankId: q.config.blanks[0]!.id, text: 'wrong' },
      { blankId: q.config.blanks[1]!.id, text: 'Paris' },
    ],
  });
  const result = gradeAnswers([q], [a]);
  assert.equal(result.score, 3);
  assert.equal(result.maxScore, 5);
  const normalized = answer(q, {
    blanks: [
      { blankId: q.config.blanks[0]!.id, text: ' london ' },
      { blankId: q.config.blanks[1]!.id, text: 'Paris' },
    ],
  });
  assert.equal(gradeAnswers([q], [normalized]).score, 5);
  assert.ok(
    validateAnswers(
      [q],
      [answer(q, { blanks: [{ blankId: q.config.blanks[0]!.id, text: 'London' }] })],
    ).length,
  );
});
test('drafts preserve incomplete content but reject dangling keys, duplicated IDs and arbitrary HTML', () => {
  const q = make('SINGLE_CHOICE', { options: [] }, { correctOptionId: null });
  q.prompt = [];
  assert.deepEqual(validateQuestions([q], false), []);
  assert.ok(validateQuestions([q]).length);
  q.answerKey.correctOptionId = randomUUID();
  assert.ok(
    validateQuestions([q], false).some((error) => error.path === 'answerKey.correctOptionId'),
  );
  assert.equal(questionV2Schema.safeParse({ ...q, score: 100 }).success, false);
  assert.equal(
    questionV2Schema.safeParse({
      ...q,
      prompt: [{ id: randomUUID(), type: 'html', html: '<script>alert(1)</script>' }],
    }).success,
    false,
  );
  q.answerKey.correctOptionId = null;
  const other = { ...q, position: 1 };
  assert.ok(validateQuestions([q, other], false).some((error) => error.path === 'id'));
});
test('publication catches normalized answer duplicates, mismatched tokens and inconsistent points', () => {
  const q = fill();
  q.answerKey.answers[0]!.values.push(' london ');
  assert.ok(validateQuestions([q], false).length);
  q.answerKey.answers[0]!.values.pop();
  q.points = 4;
  assert.ok(validateQuestions([q]).some((error) => error.path === 'points'));
  q.points = 5;
  q.prompt = text('No blank token.');
  assert.ok(validateQuestions([q]).some((error) => error.path === 'prompt'));
});
test('cloze options belong to individual blanks and each blank is independently scored', () => {
  const blanks = Array.from({ length: 3 }, () => ({
    id: randomUUID(),
    points: 2,
    options: [choice('but'), choice('or')],
  }));
  const q = make(
    'CLOZE_CHOICE',
    { blanks },
    { answers: blanks.map((b) => ({ blankId: b.id, optionId: b.options[0]!.id })) },
    6,
  );
  q.prompt = [
    {
      id: randomUUID(),
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Choose words. ' },
        ...blanks.map((b) => ({ type: 'blank' as const, blankId: b.id })),
      ],
    },
  ];
  assert.deepEqual(validateQuestions([q]), []);
  const a = answer(q, {
    blanks: blanks.map((b, i) => ({ blankId: b.id, optionId: b.options[i === 2 ? 1 : 0]!.id })),
  });
  assert.equal(gradeAnswers([q], [a]).score, 4);
  const foreign = answer(q, {
    blanks: blanks.map((b) => ({ blankId: b.id, optionId: blanks[0]!.options[0]!.id })),
  });
  assert.ok(validateAnswers([q], [foreign]).length);
});
test('grouping gives weighted partial credit and ignores order inside groups', () => {
  const groups = [choice('Fruit'), choice('Vegetable')];
  const items = ['apple', 'banana', 'carrot', 'onion'].map((label) => ({
    ...choice(label),
    points: 1,
  }));
  const placements = items.map((item, i) => ({
    itemId: item.id,
    groupId: groups[i < 2 ? 0 : 1]!.id,
  }));
  const q = make('GROUPING', { groups, items }, { placements }, 4);
  assert.deepEqual(validateQuestions([q]), []);
  const typed = placements
    .map((p, i) => (i === 3 ? { ...p, groupId: groups[0]!.id } : p))
    .reverse();
  assert.equal(gradeAnswers([q], [answer(q, { placements: typed })]).score, 3);
  assert.ok(
    validateAnswers(
      [q],
      [answer(q, { placements: [placements[0], placements[0], placements[2], placements[3]] })],
    ).length,
  );
});
test('matching supports distractors and many-to-one, but rejects target reuse in one-to-one', () => {
  const left = [choice('cat'), choice('dog')].map((item) => ({ ...item, points: 2 }));
  const right = [choice('cat image'), choice('dog image'), choice('bird image')];
  const q = make(
    'MATCHING',
    { mode: 'ONE_TO_ONE', left, right },
    { pairs: left.map((item, i) => ({ leftId: item.id, rightId: right[i]!.id })) },
    4,
  );
  assert.deepEqual(validateQuestions([q]), []);
  const partial = answer(q, {
    pairs: [
      { leftId: left[0]!.id, rightId: right[0]!.id },
      { leftId: left[1]!.id, rightId: right[2]!.id },
    ],
  });
  assert.equal(gradeAnswers([q], [partial]).score, 2);
  const reuse = answer(q, {
    pairs: left.map((item) => ({ leftId: item.id, rightId: right[0]!.id })),
  });
  assert.ok(validateAnswers([q], [reuse]).length);
  q.config.mode = 'MANY_TO_ONE';
  q.answerKey.pairs = left.map((item) => ({ leftId: item.id, rightId: right[0]!.id }));
  assert.deepEqual(validateQuestions([q]), []);
  assert.equal(gradeAnswers([q], [reuse]).score, 4);
});
test('ordering requires explicit confirmation and accepts only complete accepted sequences', () => {
  const items = ['I', 'like', 'reading', '.'].map(choice);
  const order = items.map((item) => item.id);
  const alternative = [order[0]!, order[2]!, order[1]!, order[3]!];
  const q = make(
    'ORDERING',
    { items, initialOrder: [...order].reverse() },
    { orders: [order, alternative] },
    4,
  );
  assert.deepEqual(validateQuestions([q]), []);
  assert.equal(
    gradeAnswers([q], [answer(q, { orderedItemIds: alternative, confirmed: true })]).score,
    4,
  );
  assert.equal(
    gradeAnswers([q], [answer(q, { orderedItemIds: [...order].reverse(), confirmed: true })]).score,
    0,
  );
  assert.throws(() => answer(q, { orderedItemIds: order, confirmed: false }));
  assert.ok(
    validateAnswers(
      [q],
      [answer(q, { orderedItemIds: [order[0], order[0], order[2], order[3]], confirmed: true })],
    ).length,
  );
});
test('visually identical ordering cards require interchangeable accepted sequences', () => {
  const items = [choice('the'), choice('the'), choice('book')];
  const order = items.map((item) => item.id);
  const q = make('ORDERING', { items, initialOrder: [] }, { orders: [order] }, 3);
  assert.ok(validateQuestions([q]).some((error) => error.message.includes('Identical cards')));
  q.answerKey.orders.push([order[1]!, order[0]!, order[2]!]);
  assert.deepEqual(validateQuestions([q]), []);
});
test('containers only organize leaves and cannot receive answers or nest', () => {
  const parent = make('COMPOSITE', { kind: 'READING' }, {});
  const options = [choice('a'), choice('b')];
  const child = make('SINGLE_CHOICE', { options }, { correctOptionId: options[0]!.id }, 2);
  child.parentId = parent.id;
  assert.deepEqual(validateQuestions([parent, child]), []);
  const result = gradeAnswers([parent, child], [answer(child, { optionId: options[0]!.id })]);
  assert.equal(result.maxScore, 2);
  assert.equal(result.results.length, 1);
  assert.ok(
    validateAnswers(
      [parent, child],
      [
        answer(child, { optionId: options[0]!.id }),
        { ...answer(child, { optionId: options[0]!.id }), questionId: parent.id },
      ],
    ).length,
  );
  child.parentId = randomUUID();
  assert.ok(validateQuestions([parent, child], false).some((error) => error.path === 'parentId'));
  assert.equal(questionV2Schema.safeParse({ ...parent, parentId: randomUUID() }).success, false);
});
test('manual answers remain null and public rubrics expose criteria without reference answers', () => {
  const options = [choice('yes'), choice('no')];
  const objective = make('SINGLE_CHOICE', { options }, { correctOptionId: options[0]!.id }, 6);
  const manual = make(
    'RESPONSE',
    {
      textEnabled: true,
      textRequired: true,
      minImages: 0,
      maxImages: 0,
      minAudios: 0,
      maxAudios: 0,
      rubric: [
        { id: randomUUID(), name: 'Meaning', description: 'Express a clear meaning.', points: 4 },
      ],
    },
    { referenceText: 'Private exemplar.' },
    4,
  );
  manual.position = 1;
  assert.deepEqual(validateQuestions([objective, manual]), []);
  const input = [
    answer(objective, { optionId: options[0]!.id }),
    answer(manual, { text: 'My own answer.', assetIds: [] }),
  ];
  const result = gradeAnswers([objective, manual], input);
  assert.equal(result.objectiveScore, 6);
  assert.equal(result.objectiveMaxScore, 6);
  assert.equal(result.maxScore, 10);
  assert.equal(result.score, null);
  assert.equal(result.results[1]!.score, null);
  assert.equal(result.gradingStatus, 'PENDING_REVIEW');
  const view = publicQuestion(manual);
  assert.equal(JSON.stringify(view).includes('Private exemplar'), false);
  assert.equal(JSON.stringify(view).includes('Teacher-only'), false);
  assert.equal('answerKey' in view, false);
  assert.equal(view.type === 'RESPONSE' && view.config.rubric[0]?.name, 'Meaning');
  assert.ok(validateAnswers([manual], [answer(manual, { text: ' ', assetIds: [] })]).length);
  const pure = gradeAnswers([manual], [input[1]!]);
  assert.equal(pure.objectiveMaxScore, 0);
  assert.equal(pure.score, null);
});
test('canonical retries normalize unordered collections, but preserve raw text and sequence order', () => {
  const q = fill();
  const typed = q.config.blanks.map((blank) => ({ blankId: blank.id, text: 'Answer' }));
  const input = submissionV2Schema.parse({
    schemaVersion: 2,
    publishedVersion: 5,
    requestId: randomUUID(),
    answers: [
      {
        questionId: q.id,
        type: 'FILL_BLANK',
        payload: { blanks: typed },
        evidenceAssetIds: [randomUUID(), randomUUID()],
      },
    ],
  });
  const changedOrder = submissionV2Schema.parse({
    ...input,
    requestId: randomUUID(),
    answers: input.answers.map((a) => ({
      ...a,
      payload: { blanks: [...typed].reverse() },
      evidenceAssetIds: [...a.evidenceAssetIds].reverse(),
    })),
  });
  const assignmentId = randomUUID();
  assert.equal(
    canonicalSubmission(assignmentId, input),
    canonicalSubmission(assignmentId.toUpperCase(), changedOrder),
  );
  const changedText = submissionV2Schema.parse({
    ...input,
    answers: [
      {
        ...input.answers[0],
        payload: { blanks: typed.map((b) => ({ ...b, text: b.text + ' ' })) },
      },
    ],
  });
  assert.notEqual(
    canonicalSubmission(assignmentId, input),
    canonicalSubmission(assignmentId, changedText),
  );
  assert.equal(
    submissionV2Schema.safeParse({ ...input, answers: [...input.answers, ...input.answers] })
      .success,
    false,
  );
  assert.equal(submissionV2Schema.safeParse({ ...input, score: 100 }).success, false);
});
test('Unicode limits, empty drafts and mandatory attachment capacity follow product constraints', () => {
  assert.equal(limitedText(2).safeParse('😀😀').success, true);
  assert.equal(limitedText(2).safeParse('😀😀😀').success, false);
  assert.equal(
    createAssignmentV2Schema.safeParse({
      schemaVersion: 2,
      classId: randomUUID(),
      title: 'Draft',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      questions: [],
    }).success,
    true,
  );
  const config = {
    textEnabled: false,
    textRequired: false,
    minImages: 0,
    maxImages: 0,
    minAudios: 1,
    maxAudios: 1,
    rubric: [{ id: randomUUID(), name: 'Reading', description: 'Read accurately.', points: 1 }],
  };
  const questions = Array.from({ length: 3 }, (_, position) => {
    const q = make(
      'RESPONSE',
      { ...config, rubric: [{ ...config.rubric[0], id: randomUUID() }] },
      { referenceText: '' },
    );
    q.position = position;
    return q;
  });
  assert.ok(validateQuestions(questions).some((error) => error.message.includes('100 MiB')));
  questions.forEach((q) => {
    q.config.maxAudioBytes = mediaLimits.answerBytes / 4;
  });
  assert.deepEqual(validateQuestions(questions), []);
});
