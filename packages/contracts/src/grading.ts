import {
  type AnswerV2,
  type QuestionV2,
  type PublicQuestionV2,
  type LeafQuestion,
  type SubmitAssignmentV2,
  type ValidationProblem,
  sameIdSet,
  sequenceEquals,
  normalizeBlank,
} from './questions.js';

export type UnitResult = { unitId: string; correct: boolean; score: number; points: number };
export type QuestionResult = {
  questionId: string;
  type: LeafQuestion['type'];
  score: number | null;
  maxScore: number;
  units: UnitResult[];
};

/** Validate the structure, never the correctness, before accepting an attempt. */
export function validateAnswers(
  questions: (QuestionV2 | PublicQuestionV2)[],
  answers: AnswerV2[],
): ValidationProblem[] {
  const errors: ValidationProblem[] = [];
  const add = (q: QuestionV2 | PublicQuestionV2, path: string, message: string) =>
    errors.push({ questionId: q.id, path, code: 'INVALID_ANSWER', message });
  const leaves = questions.filter((q) => q.type !== 'COMPOSITE');
  if (
    !sameIdSet(
      answers.map((answer) => answer.questionId),
      leaves.map((q) => q.id),
    )
  )
    errors.push({
      path: 'answers',
      code: 'INVALID_ANSWER',
      message: 'Submit every answerable question exactly once, without container answers.',
    });
  for (const q of leaves) {
    const a = answers.find((answer) => answer.questionId === q.id);
    if (!a) continue;
    if (q.type !== a.type) {
      add(q, 'type', 'The answer type must match the published question.');
      continue;
    }
    if (!q.evidenceEnabled && a.evidenceAssetIds.length)
      add(q, 'evidenceAssetIds', 'Supplementary evidence is not enabled for this question.');
    switch (q.type) {
      case 'SINGLE_CHOICE':
        if (
          a.type === q.type &&
          !q.config.options.some((option) => option.id === a.payload.optionId)
        )
          add(q, 'payload.optionId', 'Choose an existing option.');
        break;
      case 'FILL_BLANK':
        if (
          a.type === q.type &&
          !sameIdSet(
            a.payload.blanks.map((blank) => blank.blankId),
            q.config.blanks.map((blank) => blank.id),
          )
        )
          add(q, 'payload.blanks', 'Answer every blank exactly once.');
        break;
      case 'CLOZE_CHOICE':
        if (
          a.type === q.type &&
          (!sameIdSet(
            a.payload.blanks.map((blank) => blank.blankId),
            q.config.blanks.map((blank) => blank.id),
          ) ||
            a.payload.blanks.some(
              (blank) =>
                !q.config.blanks
                  .find((item) => item.id === blank.blankId)
                  ?.options.some((option) => option.id === blank.optionId),
            ))
        )
          add(q, 'payload.blanks', 'Answer every blank with an option belonging to that blank.');
        break;
      case 'GROUPING':
        if (
          a.type === q.type &&
          (!sameIdSet(
            a.payload.placements.map((p) => p.itemId),
            q.config.items.map((item) => item.id),
          ) ||
            a.payload.placements.some(
              (p) => !q.config.groups.some((group) => group.id === p.groupId),
            ))
        )
          add(q, 'payload.placements', 'Assign each item exactly once to an existing group.');
        break;
      case 'MATCHING':
        if (a.type === q.type) {
          const pairs = a.payload.pairs;
          if (
            !sameIdSet(
              pairs.map((p) => p.leftId),
              q.config.left.map((item) => item.id),
            ) ||
            pairs.some((p) => !q.config.right.some((item) => item.id === p.rightId))
          )
            add(
              q,
              'payload.pairs',
              'Connect every left item exactly once to an existing right item.',
            );
          if (
            q.config.mode === 'ONE_TO_ONE' &&
            new Set(pairs.map((p) => p.rightId)).size !== pairs.length
          )
            add(q, 'payload.pairs', 'A one-to-one target cannot be reused.');
        }
        break;
      case 'ORDERING':
        if (
          a.type === q.type &&
          !sameIdSet(
            a.payload.orderedItemIds,
            q.config.items.map((item) => item.id),
          )
        )
          add(
            q,
            'payload.orderedItemIds',
            'Confirm a complete sequence containing each item exactly once.',
          );
        break;
      case 'RESPONSE':
        if (a.type === q.type) {
          if (!q.config.textEnabled && a.payload.text !== '')
            add(q, 'payload.text', 'Text input is not enabled.');
          if (q.config.textRequired && !a.payload.text.trim())
            add(q, 'payload.text', 'Text is required.');
          if (!a.payload.text.trim() && !a.payload.assetIds.length)
            add(q, 'payload', 'Provide text or at least one ready attachment.');
          // File kinds, ownership, per-kind counts and readiness are checked against server assets.
        }
        break;
    }
  }
  return errors;
}

export function gradeAnswers(questions: QuestionV2[], answers: AnswerV2[]) {
  const errors = validateAnswers(questions, answers);
  if (errors.length) throw new Error(errors.map((error) => error.message).join(' '));
  const results: QuestionResult[] = [];
  for (const q of questions) {
    if (q.type === 'COMPOSITE') continue;
    const answer = answers.find((a) => a.questionId === q.id)!;
    const units: UnitResult[] = [];
    const unit = (id: string, correct: boolean, points: number) =>
      units.push({ unitId: id, correct, score: correct ? points : 0, points });
    switch (q.type) {
      case 'SINGLE_CHOICE':
        if (answer.type === q.type)
          unit(q.id, answer.payload.optionId === q.answerKey.correctOptionId, q.points);
        break;
      case 'FILL_BLANK':
        if (answer.type === q.type)
          for (const blank of q.config.blanks) {
            const typed = normalizeBlank(
              answer.payload.blanks.find((b) => b.blankId === blank.id)!.text,
              blank.caseSensitive,
            );
            unit(
              blank.id,
              q.answerKey.answers
                .find((a) => a.blankId === blank.id)!
                .values.some((value) => normalizeBlank(value, blank.caseSensitive) === typed),
              blank.points,
            );
          }
        break;
      case 'CLOZE_CHOICE':
        if (answer.type === q.type)
          for (const blank of q.config.blanks)
            unit(
              blank.id,
              answer.payload.blanks.find((b) => b.blankId === blank.id)!.optionId ===
                q.answerKey.answers.find((a) => a.blankId === blank.id)!.optionId,
              blank.points,
            );
        break;
      case 'GROUPING':
        if (answer.type === q.type)
          for (const item of q.config.items)
            unit(
              item.id,
              answer.payload.placements.find((p) => p.itemId === item.id)!.groupId ===
                q.answerKey.placements.find((p) => p.itemId === item.id)!.groupId,
              item.points,
            );
        break;
      case 'MATCHING':
        if (answer.type === q.type)
          for (const item of q.config.left)
            unit(
              item.id,
              answer.payload.pairs.find((p) => p.leftId === item.id)!.rightId ===
                q.answerKey.pairs.find((p) => p.leftId === item.id)!.rightId,
              item.points,
            );
        break;
      case 'ORDERING':
        if (answer.type === q.type)
          unit(
            q.id,
            q.answerKey.orders.some((order) =>
              sequenceEquals(answer.payload.orderedItemIds, order),
            ),
            q.points,
          );
        break;
      case 'RESPONSE':
        break;
    }
    results.push({
      questionId: q.id,
      type: q.type,
      score: q.type === 'RESPONSE' ? null : units.reduce((sum, u) => sum + u.score, 0),
      maxScore: q.points,
      units,
    });
  }
  const objectiveScore = results.reduce((sum, result) => sum + (result.score ?? 0), 0);
  const objectiveMaxScore = results
    .filter((result) => result.type !== 'RESPONSE')
    .reduce((sum, result) => sum + result.maxScore, 0);
  const pending = results.some((result) => result.type === 'RESPONSE');
  return {
    results,
    objectiveScore,
    objectiveMaxScore,
    score: pending ? null : objectiveScore,
    maxScore: results.reduce((sum, result) => sum + result.maxScore, 0),
    gradingStatus: pending ? ('PENDING_REVIEW' as const) : ('GRADED' as const),
  };
}

/** Canonicalize unordered maps and sets, preserving raw text and ordered sequences. */
export function canonicalSubmission(assignmentId: string, input: SubmitAssignmentV2): string {
  const answers = input.answers
    .map((answer) => {
      let payload: AnswerV2['payload'] = answer.payload;
      switch (answer.type) {
        case 'FILL_BLANK':
          payload = {
            blanks: [...answer.payload.blanks].sort((a, b) => a.blankId.localeCompare(b.blankId)),
          };
          break;
        case 'CLOZE_CHOICE':
          payload = {
            blanks: [...answer.payload.blanks].sort((a, b) => a.blankId.localeCompare(b.blankId)),
          };
          break;
        case 'GROUPING':
          payload = {
            placements: [...answer.payload.placements].sort((a, b) =>
              a.itemId.localeCompare(b.itemId),
            ),
          };
          break;
        case 'MATCHING':
          payload = {
            pairs: [...answer.payload.pairs].sort((a, b) => a.leftId.localeCompare(b.leftId)),
          };
          break;
        case 'RESPONSE':
          payload = { text: answer.payload.text, assetIds: [...answer.payload.assetIds].sort() };
          break;
      }
      return {
        questionId: answer.questionId,
        type: answer.type,
        payload,
        evidenceAssetIds: [...answer.evidenceAssetIds].sort(),
      };
    })
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
  return JSON.stringify({
    assignmentId: assignmentId.toLowerCase(),
    schemaVersion: 2,
    publishedVersion: input.publishedVersion,
    answers,
  });
}
