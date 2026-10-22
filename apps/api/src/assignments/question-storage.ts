import { randomInt } from 'node:crypto';
import { type QuestionV2, type Content, sameIdSet, sequenceEquals } from '@amp/contracts';

export function legacyQuestionCompatible(q: QuestionV2) {
  const plain = (content: Content) =>
    content.length === 1 &&
    content[0]?.type === 'paragraph' &&
    content[0].children.every((inline) => inline.type === 'text' && !inline.bold && !inline.italic);
  return (
    q.type === 'SINGLE_CHOICE' &&
    q.parentId === null &&
    !q.evidenceEnabled &&
    !q.explanation &&
    !q.answerAreaContent.length &&
    plain(q.prompt) &&
    q.config.options.length >= 2 &&
    q.answerKey.correctOptionId !== null &&
    q.config.options.every((option) => plain(option.content))
  );
}

/** Never accept a client-supplied initial ordering as a standard-answer projection. */
export function prepareOrdering(questions: QuestionV2[], existing: QuestionV2[] = []) {
  return questions.map((question): QuestionV2 => {
    if (question.type !== 'ORDERING') return question;
    const ids = question.config.items.map((item) => item.id);
    if (
      ids.length < 2 ||
      !question.answerKey.orders.length ||
      question.answerKey.orders.some((order) => !sameIdSet(order, ids))
    )
      return { ...question, config: { ...question.config, initialOrder: [] } };
    const old = existing.find((q) => q.id === question.id);
    const allowed = (candidate: string[]) =>
      sameIdSet(candidate, ids) &&
      !question.answerKey.orders.some((order) => sequenceEquals(candidate, order));
    if (old?.type === 'ORDERING' && allowed(old.config.initialOrder))
      return { ...question, config: { ...question.config, initialOrder: old.config.initialOrder } };
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = [...ids];
      for (let index = candidate.length - 1; index > 0; index--) {
        const other = randomInt(index + 1);
        [candidate[index], candidate[other]] = [candidate[other]!, candidate[index]!];
      }
      if (allowed(candidate))
        return { ...question, config: { ...question.config, initialOrder: candidate } };
    }
    // At most five accepted sequences exist; the first six distinct permutations suffice.
    const candidate = [...ids].sort();
    for (let attempt = 0; attempt < 6; attempt++) {
      if (allowed(candidate))
        return { ...question, config: { ...question.config, initialOrder: [...candidate] } };
      let pivot = candidate.length - 2;
      while (pivot >= 0 && candidate[pivot]! >= candidate[pivot + 1]!) pivot--;
      if (pivot < 0) break;
      let right = candidate.length - 1;
      while (candidate[right]! <= candidate[pivot]!) right--;
      [candidate[pivot], candidate[right]] = [candidate[right]!, candidate[pivot]!];
      candidate.splice(
        pivot + 1,
        candidate.length - pivot - 1,
        ...candidate.slice(pivot + 1).reverse(),
      );
    }
    return { ...question, config: { ...question.config, initialOrder: [] } };
  });
}
