import { randomUUID } from 'node:crypto';
import { questionV2Schema, type QuestionV2, type Content, type AnswerV2 } from '@amp/contracts';

export const paragraph = (text: string): Content => [
  { id: randomUUID(), type: 'paragraph', children: [{ type: 'text', text }] },
];
const choice = (label: string) => ({ id: randomUUID(), label, content: paragraph(label) });
function question(
  type: QuestionV2['type'],
  prompt: string,
  config: unknown,
  answerKey: unknown,
  points: number,
) {
  return questionV2Schema.parse({
    id: randomUUID(),
    parentId: null,
    position: 0,
    type,
    points,
    prompt: paragraph(prompt),
    answerAreaContent: [],
    evidenceEnabled: false,
    explanation: '',
    config,
    answerKey,
  });
}
function single(prompt: string, labels: string[], correct: number, points = 5) {
  const options = labels.map(choice);
  const q = question(
    'SINGLE_CHOICE',
    prompt,
    { options },
    { correctOptionId: options[correct]!.id },
    points,
  );
  q.explanation = `The correct answer is “${labels[correct]}”. Read the sentence and check its meaning.`;
  return q;
}
function fill() {
  const blanks = [0, 1].map(() => ({ id: randomUUID(), points: 5, caseSensitive: false }));
  const q = question(
    'FILL_BLANK',
    '',
    { blanks },
    { answers: blanks.map((b, i) => ({ blankId: b.id, values: [i ? 'went' : 'reads'] })) },
    10,
  );
  q.prompt = [
    {
      id: randomUUID(),
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Complete the verbs: Mia ' },
        { type: 'blank', blankId: blanks[0]!.id },
        { type: 'text', text: ' (read) every evening. Yesterday she ' },
        { type: 'blank', blankId: blanks[1]!.id },
        { type: 'text', text: ' (go) to the library.' },
      ],
    },
  ];
  q.explanation = 'Use present simple for a habit (reads), and past simple for yesterday (went).';
  return q;
}
function cloze() {
  const blanks = [0, 1].map(() => ({
    id: randomUUID(),
    points: 5,
    options: ['because', 'but', 'so'].map(choice),
  }));
  const q = question(
    'CLOZE_CHOICE',
    '',
    { blanks },
    { answers: blanks.map((b, i) => ({ blankId: b.id, optionId: b.options[i]!.id })) },
    10,
  );
  q.prompt = [
    {
      id: randomUUID(),
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Choose the connectors: We planted trees ' },
        { type: 'blank', blankId: blanks[0]!.id },
        { type: 'text', text: ' they clean the air. The work was tiring, ' },
        { type: 'blank', blankId: blanks[1]!.id },
        { type: 'text', text: ' everyone enjoyed it.' },
      ],
    },
  ];
  q.explanation = 'Because introduces a reason; but introduces a contrast.';
  return q;
}
function grouping() {
  const groups = ['Renewable energy', 'Fossil fuel'].map(choice);
  const items = ['Solar', 'Wind', 'Coal', 'Oil'].map((label) => ({ ...choice(label), points: 3 }));
  return question(
    'GROUPING',
    'Sort the energy sources into the two groups.',
    { groups, items },
    {
      placements: items.map((item, i) => ({ itemId: item.id, groupId: groups[i < 2 ? 0 : 1]!.id })),
    },
    12,
  );
}
function matching() {
  const left = ['reduce', 'reuse', 'recycle'].map((label) => ({ ...choice(label), points: 4 }));
  const right = ['use less', 'use again', 'make into new materials'].map(choice);
  return question(
    'MATCHING',
    'Match each action with its meaning.',
    { mode: 'ONE_TO_ONE', left, right },
    {
      pairs: left.map((item, i) => ({ leftId: item.id, rightId: right[i]!.id })),
    },
    12,
  );
}
function ordering() {
  const items = [
    'First, collect the materials.',
    'Next, sort them by type.',
    'Then, put them in the right bins.',
    'Finally, check your work.',
  ].map(choice);
  return question(
    'ORDERING',
    'Arrange the recycling instructions in a logical order.',
    { items, initialOrder: [] },
    { orders: [items.map((i) => i.id)] },
    10,
  );
}
function response(prompt: string) {
  return question(
    'RESPONSE',
    prompt,
    {
      textEnabled: true,
      textRequired: true,
      minImages: 0,
      maxImages: 2,
      minAudios: 0,
      maxAudios: 1,
      rubric: [
        {
          id: randomUUID(),
          name: 'Ideas and evidence',
          description: 'Give a clear idea and support it with a specific example.',
          points: 10,
        },
        {
          id: randomUUID(),
          name: 'Organization',
          description: 'Connect ideas in a logical order.',
          points: 5,
        },
        {
          id: randomUUID(),
          name: 'Language',
          description: 'Use accurate vocabulary and complete sentences.',
          points: 5,
        },
      ],
    },
    {
      referenceText: prompt.includes('passage')
        ? 'The class wants to return because small actions make a difference. They collected six recycling bags in one hour, so regular visits could keep the park clean.'
        : prompt.includes('gardening')
          ? 'The gardening club meets every Wednesday at 3:30 behind the library. Members plant seeds, water vegetables and learn to reduce food waste.'
          : prompt.includes('station')
            ? 'Place three labelled bins beside the classroom door. Students sort paper, clean plastic and general waste after lunch, and two helpers check the labels each Friday.'
            : prompt.includes('book')
              ? 'I recommend The Secret Garden because it shows how friendship and caring for nature help people grow. Readers who enjoy hopeful stories would enjoy it.'
              : 'Our class can reduce waste by reusing water bottles. A refill station near the library would save plastic each day. We could record how many bottles we refill each week.',
    },
    20,
  );
}
export function showcaseQuestions(kind: string): QuestionV2[] {
  let questions: QuestionV2[];
  switch (kind) {
    case 'grammar':
      questions = [
        single(
          'Which sentence describes a daily habit?',
          ['She reads every day.', 'She read yesterday.', 'She is reading now.'],
          0,
        ),
        fill(),
        cloze(),
      ];
      break;
    case 'vocabulary':
      questions = [grouping(), matching(), ordering()];
      break;
    case 'reading': {
      const parent = question(
        'COMPOSITE',
        'Read the passage: On Friday, Class A cleaned the park. Mia collected plastic bottles while Sam sorted paper. They filled six recycling bags in one hour. The class decided to return every month because small actions make a difference.',
        { kind: 'READING' },
        {},
        0,
      );
      const a = single(
        'How many recycling bags did the class fill?',
        ['Four', 'Six', 'Eight'],
        1,
        10,
      );
      const b = response(
        'Why does the class want to return every month? Use evidence from the passage.',
      );
      a.parentId = b.parentId = parent.id;
      a.position = 0;
      b.position = 1;
      questions = [parent, a, b];
      break;
    }
    case 'writing':
      questions = [
        single('Which connector introduces a reason?', ['because', 'but', 'although'], 0),
        response(
          'Write 60–90 words proposing one practical way to make your school greener. Give an example and explain its benefit. You may attach a planning image.',
        ),
      ];
      break;
    case 'listening':
      questions = [
        single(
          'Listen to the recording. When does the club meet?',
          ['Monday at 3:30', 'Wednesday at 3:30', 'Friday at 4:00'],
          1,
          10,
        ),
        response(
          'Introduce the school gardening club in your own words. Include the meeting time and one activity. You may add an audio recording.',
        ),
      ];
      break;
    case 'project': {
      const parent = question(
        'COMPOSITE',
        'Green School Challenge: plan a recycling station for your classroom. Complete the vocabulary task and explain your design.',
        { kind: 'GENERAL' },
        {},
        0,
      );
      const a = matching(),
        b = response(
          'Describe your recycling station. Explain where you would put it and how students would use it. Attach a design or a short recording if helpful.',
        );
      a.parentId = b.parentId = parent.id;
      a.position = 0;
      b.position = 1;
      questions = [parent, a, b];
      break;
    }
    default:
      questions = [
        response(
          'Prepare a one-minute introduction about a book you recommend. Explain the main idea and why a classmate might enjoy reading it. You can attach audio.',
        ),
      ];
  }
  let position = 0;
  return questions.map((q) => ({ ...q, position: q.parentId ? q.position : position++ }));
}
const responses = [
  'Our class can reduce waste by reusing water bottles. We can put a refill station near the library. This saves plastic every day, and a weekly chart will help us see our progress.',
  'We should put a recycling station beside the classroom door. The bins need clear labels for paper, plastic and general waste. Students can sort rubbish after lunch, and two helpers can check the bins each Friday.',
  'The class wants to return because small actions make a difference. They collected six recycling bags in just one hour. Working together every month can keep the park clean and help the local community.',
  'The gardening club meets on Wednesday at three thirty. Members plant seeds and water vegetables. I would like to join because I enjoy learning outside and growing food with my friends.',
];
export function showcaseAnswers(questions: QuestionV2[], studentIndex: number): AnswerV2[] {
  return questions
    .filter((q) => q.type !== 'COMPOSITE')
    .map((q, index): AnswerV2 => {
      const common = { questionId: q.id, evidenceAssetIds: [] as string[] };
      const wrong = (studentIndex + index) % 4 === 1;
      switch (q.type) {
        case 'SINGLE_CHOICE':
          return {
            ...common,
            type: q.type,
            payload: {
              optionId: wrong
                ? q.config.options.find((o) => o.id !== q.answerKey.correctOptionId)!.id
                : q.answerKey.correctOptionId!,
            },
          };
        case 'FILL_BLANK':
          return {
            ...common,
            type: q.type,
            payload: {
              blanks: q.answerKey.answers.map((a, i) => ({
                blankId: a.blankId,
                text: wrong && i === 0 ? 'read' : a.values[0]!,
              })),
            },
          };
        case 'CLOZE_CHOICE':
          return {
            ...common,
            type: q.type,
            payload: {
              blanks: q.answerKey.answers.map((a, i) => ({
                blankId: a.blankId,
                optionId:
                  wrong && i === 0
                    ? q.config.blanks[i]!.options.find((o) => o.id !== a.optionId)!.id
                    : a.optionId!,
              })),
            },
          };
        case 'GROUPING':
          return {
            ...common,
            type: q.type,
            payload: {
              placements: q.answerKey.placements.map((p, i) =>
                wrong && i === 0
                  ? { ...p, groupId: q.config.groups.find((g) => g.id !== p.groupId)!.id }
                  : p,
              ),
            },
          };
        case 'MATCHING':
          return {
            ...common,
            type: q.type,
            payload: {
              pairs: q.answerKey.pairs.map((p, i, pairs) => ({
                ...p,
                rightId: wrong ? pairs[(i + 1) % pairs.length]!.rightId : p.rightId,
              })),
            },
          };
        case 'ORDERING':
          return {
            ...common,
            type: q.type,
            payload: {
              orderedItemIds: wrong
                ? [...q.answerKey.orders[0]!].reverse()
                : q.answerKey.orders[0]!,
              confirmed: true,
            },
          };
        case 'RESPONSE': {
          const prompt = JSON.stringify(q.prompt);
          const text = prompt.includes('passage')
            ? responses[2]!
            : prompt.includes('gardening')
              ? responses[3]!
              : prompt.includes('station')
                ? responses[1]!
                : prompt.includes('book')
                  ? 'I recommend The Secret Garden. The story shows how friendship and caring for nature can change people. I enjoyed watching the characters become kinder and more confident. A classmate who likes hopeful stories would enjoy it too.'
                  : responses[0]!;
          return { ...common, type: q.type, payload: { text, assetIds: [] } };
        }
        default:
          throw new Error('Composite groups do not accept answers.');
      }
    });
}
