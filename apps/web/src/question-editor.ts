import {
  questionV2Schema,
  type Content,
  type ChoiceV2,
  type QuestionV2,
  type PublicQuestionV2,
} from '@amp/contracts';
export const questionLabels: Record<QuestionV2['type'], string> = {
  SINGLE_CHOICE: 'Single choice',
  FILL_BLANK: 'Fill in the blanks',
  CLOZE_CHOICE: 'Cloze choices',
  GROUPING: 'Grouping',
  MATCHING: 'Matching',
  ORDERING: 'Ordering',
  RESPONSE: 'Written / image / audio response',
  COMPOSITE: 'Question group',
};
export function unitPoints(q: QuestionV2): number | null {
  switch (q.type) {
    case 'FILL_BLANK':
    case 'CLOZE_CHOICE':
      return q.config.blanks.reduce((sum, item) => sum + item.points, 0);
    case 'GROUPING':
      return q.config.items.reduce((sum, item) => sum + item.points, 0);
    case 'MATCHING':
      return q.config.left.reduce((sum, item) => sum + item.points, 0);
    case 'RESPONSE':
      return q.config.rubric.reduce((sum, item) => sum + item.points, 0);
    default:
      return null;
  }
}
export function withDerivedPoints(q: QuestionV2): QuestionV2 {
  const total = unitPoints(q);
  // Empty configurations remain saveable drafts; publication requires units.
  return total === null || q.type === 'COMPOSITE' ? q : { ...q, points: Math.max(1, total) };
}
// An upload can finish its initialization while a save is in flight. Only
// replace questions that still match the submitted snapshot; preserve newer
// local content, while adopting the server's persisted ordering permutation.
export function reconcileSavedQuestions(
  sent: QuestionV2[],
  latest: QuestionV2[],
  saved: QuestionV2[],
): QuestionV2[] {
  return latest.map((q) => {
    const before = sent.find((item) => item.id === q.id);
    const persisted = saved.find((item) => item.id === q.id);
    if (!before || !persisted) return q;
    if (JSON.stringify(q) === JSON.stringify(before)) return persisted;
    if (
      q.type === 'ORDERING' &&
      before.type === 'ORDERING' &&
      persisted.type === 'ORDERING' &&
      JSON.stringify(q.config.items.map((item) => item.id)) ===
        JSON.stringify(before.config.items.map((item) => item.id)) &&
      JSON.stringify(q.answerKey) === JSON.stringify(before.answerKey)
    ) {
      return { ...q, config: { ...q.config, initialOrder: persisted.config.initialOrder } };
    }
    return q;
  });
}
export const emptyContent = (): Content => [
  { id: crypto.randomUUID(), type: 'paragraph', children: [{ type: 'text', text: '' }] },
];
export const newChoice = (): ChoiceV2 => ({
  id: crypto.randomUUID(),
  label: '',
  content: emptyContent(),
});
export function newQuestion(
  type: QuestionV2['type'],
  parentId: string | null = null,
  position = 0,
  reading = false,
): QuestionV2 {
  const choices = () => [newChoice(), newChoice()];
  const definitions: Record<
    QuestionV2['type'],
    { config: unknown; answerKey: unknown; points: number }
  > = {
    SINGLE_CHOICE: {
      config: { options: Array.from({ length: 4 }, newChoice) },
      answerKey: { correctOptionId: null },
      points: 1,
    },
    FILL_BLANK: { config: { blanks: [] }, answerKey: { answers: [] }, points: 1 },
    CLOZE_CHOICE: { config: { blanks: [] }, answerKey: { answers: [] }, points: 1 },
    GROUPING: {
      config: { groups: choices(), items: choices().map((c) => ({ ...c, points: 1 })) },
      answerKey: { placements: [] },
      points: 2,
    },
    MATCHING: {
      config: {
        mode: 'ONE_TO_ONE',
        left: choices().map((c) => ({ ...c, points: 1 })),
        right: choices(),
      },
      answerKey: { pairs: [] },
      points: 2,
    },
    ORDERING: {
      config: { items: choices(), initialOrder: [] },
      answerKey: { orders: [] },
      points: 1,
    },
    RESPONSE: {
      config: {
        textEnabled: true,
        textRequired: true,
        minImages: 0,
        maxImages: 0,
        minAudios: 0,
        maxAudios: 0,
        rubric: [],
      },
      answerKey: {},
      points: 1,
    },
    COMPOSITE: { config: { kind: reading ? 'READING' : 'GENERAL' }, answerKey: {}, points: 0 },
  };
  return questionV2Schema.parse({
    id: crypto.randomUUID(),
    type,
    parentId,
    position,
    prompt: emptyContent(),
    answerAreaContent: [],
    ...definitions[type],
  });
}
/** Clone only identities defined inside the group; keep immutable same-assignment assets. */
export function cloneQuestions(questions: QuestionV2[]): QuestionV2[] {
  const ids = new Map<string, string>();
  function collect(value: unknown): void {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      if ('id' in value && typeof value.id === 'string') ids.set(value.id, crypto.randomUUID());
      Object.values(value).forEach(collect);
    }
  }
  collect(questions);
  function clone(value: unknown, field = ''): unknown {
    if (typeof value === 'string')
      return [
        'id',
        'parentId',
        'blankId',
        'optionId',
        'correctOptionId',
        'itemId',
        'groupId',
        'leftId',
        'rightId',
        'dimensionId',
        'orders',
        'initialOrder',
      ].includes(field)
        ? (ids.get(value) ?? value)
        : value;
    if (Array.isArray(value)) return value.map((v) => clone(v, field));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, clone(v, key)]));
    return value;
  }
  return (clone(questions) as unknown[]).map((q) => questionV2Schema.parse(q));
}
export function reindexQuestions(questions: QuestionV2[]) {
  const positions = new Map<string | null, number>();
  return questions.map((q) => {
    const position = positions.get(q.parentId) ?? 0;
    positions.set(q.parentId, position + 1);
    return { ...q, position };
  });
}

export function questionNumbers(questions: (QuestionV2 | PublicQuestionV2)[]) {
  const numbers = new Map<string, string>();
  questions
    .filter((q) => q.parentId === null)
    .sort((a, b) => a.position - b.position)
    .forEach((root, i) => {
      numbers.set(root.id, String(i + 1));
      questions
        .filter((q) => q.parentId === root.id)
        .sort((a, b) => a.position - b.position)
        .forEach((q, j) => numbers.set(q.id, `${i + 1}.${j + 1}`));
    });
  return numbers;
}

export function questionsInDisplayOrder<T extends QuestionV2 | PublicQuestionV2>(questions: T[]) {
  const order = new Map([...questionNumbers(questions).keys()].map((id, index) => [id, index]));
  return [...questions].sort(
    (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
  );
}
