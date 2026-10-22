import { z } from 'zod';
import { limitedText, uuidSchema } from './primitives.js';

export const MiB = 1_048_576;
export const mediaLimits = {
  imageBytes: 10 * MiB,
  audioBytes: 50 * MiB,
  audioSeconds: 600,
  teachingFiles: 100,
  teachingBytes: 300 * MiB,
  answerFiles: 30,
  answerBytes: 100 * MiB,
  teacherWorkspaceFiles: 120,
  teacherWorkspaceBytes: 400 * MiB,
  studentWorkspaceFiles: 60,
  studentWorkspaceBytes: 200 * MiB,
  jsonBytes: 2 * MiB,
} as const;

const textInline = z
  .object({
    type: z.literal('text'),
    text: limitedText(30_000),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
  })
  .strict();
const blankInline = z.object({ type: z.literal('blank'), blankId: uuidSchema }).strict();
export const inlineSchema = z.discriminatedUnion('type', [textInline, blankInline]);
const inlines = z.array(inlineSchema).max(1000);
export const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({ id: uuidSchema, type: z.literal('paragraph'), children: inlines }).strict(),
  z
    .object({
      id: uuidSchema,
      type: z.literal('heading'),
      level: z.union([z.literal(2), z.literal(3)]),
      children: inlines,
    })
    .strict(),
  z
    .object({
      id: uuidSchema,
      type: z.literal('list'),
      ordered: z.boolean(),
      items: z.array(inlines).max(100),
    })
    .strict(),
  z
    .object({
      id: uuidSchema,
      type: z.literal('image'),
      assetId: uuidSchema,
      label: limitedText(100),
      alt: limitedText(500),
      caption: limitedText(500).default(''),
    })
    .strict(),
  z
    .object({
      id: uuidSchema,
      type: z.literal('audio'),
      assetId: uuidSchema,
      label: limitedText(100),
      caption: limitedText(500).default(''),
    })
    .strict(),
]);
export const contentSchema = z.array(contentBlockSchema).max(1000);
export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type InlineContent = z.infer<typeof inlineSchema>;
export type Content = ContentBlock[];

export const choiceSchema = z
  .object({ id: uuidSchema, label: limitedText(100), content: contentSchema })
  .strict();
const weightedChoiceSchema = choiceSchema.extend({ points: z.number().int().min(1).max(100) });
export type ChoiceV2 = z.infer<typeof choiceSchema>;
const blankScoreSchema = z
  .object({
    id: uuidSchema,
    points: z.number().int().min(1).max(100),
    caseSensitive: z.boolean().default(false),
  })
  .strict();
const common = {
  id: uuidSchema,
  parentId: uuidSchema.nullable(),
  position: z.number().int().min(0).max(119),
  prompt: contentSchema,
  answerAreaContent: contentSchema,
  points: z.number().int().min(1).max(100),
  evidenceEnabled: z.boolean().default(false),
  explanation: limitedText(10_000).default(''),
};
const rubricDimension = z
  .object({
    id: uuidSchema,
    name: limitedText(100),
    description: limitedText(1000),
    points: z.number().int().min(1).max(100),
  })
  .strict();
export const responseConfigSchema = z
  .object({
    textEnabled: z.boolean(),
    textRequired: z.boolean(),
    minImages: z.number().int().min(0).max(5),
    maxImages: z.number().int().min(0).max(5),
    minAudios: z.number().int().min(0).max(2),
    maxAudios: z.number().int().min(0).max(2),
    maxImageBytes: z
      .number()
      .int()
      .min(1)
      .max(mediaLimits.imageBytes)
      .default(mediaLimits.imageBytes),
    maxAudioBytes: z
      .number()
      .int()
      .min(1)
      .max(mediaLimits.audioBytes)
      .default(mediaLimits.audioBytes),
    rubric: z.array(rubricDimension).max(10),
  })
  .strict();

export const questionV2Schema = z.discriminatedUnion('type', [
  z
    .object({
      ...common,
      type: z.literal('SINGLE_CHOICE'),
      config: z.object({ options: z.array(choiceSchema).max(6) }).strict(),
      answerKey: z.object({ correctOptionId: uuidSchema.nullable() }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('FILL_BLANK'),
      config: z.object({ blanks: z.array(blankScoreSchema).max(20) }).strict(),
      answerKey: z
        .object({
          answers: z
            .array(
              z
                .object({ blankId: uuidSchema, values: z.array(limitedText(200, 1)).max(10) })
                .strict(),
            )
            .max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('CLOZE_CHOICE'),
      config: z
        .object({
          blanks: z
            .array(
              z
                .object({
                  id: uuidSchema,
                  points: z.number().int().min(1).max(100),
                  options: z.array(choiceSchema).max(6),
                })
                .strict(),
            )
            .max(20),
        })
        .strict(),
      answerKey: z
        .object({
          answers: z
            .array(z.object({ blankId: uuidSchema, optionId: uuidSchema.nullable() }).strict())
            .max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('GROUPING'),
      config: z
        .object({
          groups: z.array(choiceSchema).max(8),
          items: z.array(weightedChoiceSchema).max(20),
        })
        .strict(),
      answerKey: z
        .object({
          placements: z
            .array(z.object({ itemId: uuidSchema, groupId: uuidSchema }).strict())
            .max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('MATCHING'),
      config: z
        .object({
          mode: z.enum(['ONE_TO_ONE', 'MANY_TO_ONE']),
          left: z.array(weightedChoiceSchema).max(20),
          right: z.array(choiceSchema).max(30),
        })
        .strict(),
      answerKey: z
        .object({
          pairs: z.array(z.object({ leftId: uuidSchema, rightId: uuidSchema }).strict()).max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('ORDERING'),
      config: z
        .object({ items: z.array(choiceSchema).max(20), initialOrder: z.array(uuidSchema).max(20) })
        .strict(),
      answerKey: z.object({ orders: z.array(z.array(uuidSchema).max(20)).max(5) }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('RESPONSE'),
      evidenceEnabled: z.literal(false).default(false),
      config: responseConfigSchema,
      answerKey: z
        .object({
          referenceText: limitedText(10_000).default(''),
          referenceContent: contentSchema.default([]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('COMPOSITE'),
      parentId: z.null(),
      points: z.literal(0),
      evidenceEnabled: z.literal(false).default(false),
      config: z.object({ kind: z.enum(['READING', 'GENERAL']) }).strict(),
      answerKey: z.object({}).strict(),
    })
    .strict(),
]);
export type QuestionV2 = z.infer<typeof questionV2Schema>;
export type LeafQuestion = Exclude<QuestionV2, { type: 'COMPOSITE' }>;
export type ResponseQuestion = Extract<QuestionV2, { type: 'RESPONSE' }>;
export type PublicQuestionV2 = QuestionV2 extends infer Q
  ? Q extends QuestionV2
    ? Omit<Q, 'answerKey' | 'explanation'>
    : never
  : never;
export type ValidationProblem = {
  questionId?: string;
  path: string;
  code: string;
  message: string;
};

export function normalizeBlank(value: string, caseSensitive = false) {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  return caseSensitive
    ? normalized
    : normalized.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function contentText(content: Content): string {
  return content
    .flatMap((block) => {
      if (block.type === 'image' || block.type === 'audio') return [];
      const groups = block.type === 'list' ? block.items : [block.children];
      return groups.map((group) =>
        group.map((inline) => (inline.type === 'text' ? inline.text : '')).join(''),
      );
    })
    .join('\n');
}
export function contentCharacterCount(content: Content) {
  return content.reduce((sum, block) => {
    if (block.type === 'image' || block.type === 'audio') return sum;
    const inlines = block.type === 'list' ? block.items.flat() : block.children;
    return (
      sum +
      inlines.reduce(
        (count, inline) => count + (inline.type === 'text' ? [...inline.text].length : 0),
        0,
      )
    );
  }, 0);
}
export function contentBlankIds(content: Content) {
  return content.flatMap((block) => {
    if (block.type === 'image' || block.type === 'audio') return [];
    return (block.type === 'list' ? block.items.flat() : block.children)
      .filter((inline) => inline.type === 'blank')
      .map((inline) => inline.blankId);
  });
}
export function contentAssets(content: Content) {
  return content.filter((block) => block.type === 'image' || block.type === 'audio');
}
export function questionContents(question: QuestionV2 | PublicQuestionV2): Content[] {
  const contents = [question.prompt, question.answerAreaContent];
  switch (question.type) {
    case 'SINGLE_CHOICE':
      return [...contents, ...question.config.options.map((choice) => choice.content)];
    case 'CLOZE_CHOICE':
      return [
        ...contents,
        ...question.config.blanks.flatMap((blank) => blank.options.map((choice) => choice.content)),
      ];
    case 'GROUPING':
      return [
        ...contents,
        ...question.config.groups.map((group) => group.content),
        ...question.config.items.map((item) => item.content),
      ];
    case 'MATCHING':
      return [
        ...contents,
        ...question.config.left.map((item) => item.content),
        ...question.config.right.map((item) => item.content),
      ];
    case 'ORDERING':
      return [...contents, ...question.config.items.map((item) => item.content)];
    default:
      return contents;
  }
}
export function scoreUnitCount(question: QuestionV2 | PublicQuestionV2) {
  switch (question.type) {
    case 'COMPOSITE':
      return 0;
    case 'FILL_BLANK':
    case 'CLOZE_CHOICE':
      return question.config.blanks.length;
    case 'GROUPING':
      return question.config.items.length;
    case 'MATCHING':
      return question.config.left.length;
    default:
      return 1;
  }
}
/** Includes teacher-only examples; never use this helper for a student projection. */
export function allQuestionContents(question: QuestionV2): Content[] {
  return question.type === 'RESPONSE'
    ? [...questionContents(question), question.answerKey.referenceContent]
    : questionContents(question);
}
export function publicQuestion(question: QuestionV2): PublicQuestionV2 {
  const { answerKey: _key, explanation: _explanation, ...view } = question;
  return view;
}
export function sameIdSet(actual: string[], expected: string[]) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((id) => expected.includes(id))
  );
}
export function sequenceEquals(actual: string[], expected: string[]) {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

/** Validate draft references separately from publication completeness. */
export function validateQuestions(questions: QuestionV2[], publish = true): ValidationProblem[] {
  const errors: ValidationProblem[] = [];
  const add = (
    question: QuestionV2 | undefined,
    path: string,
    message: string,
    code = 'INVALID_QUESTION',
  ) => errors.push({ questionId: question?.id, path, code, message });
  const ids = new Set<string>();
  const identify = (question: QuestionV2, id: string, path: string) => {
    if (ids.has(id)) add(question, path, 'Identifiers must be unique throughout the assignment.');
    ids.add(id);
  };
  const roots = questions.filter((q) => q.parentId === null);
  const leaves = questions.filter((q) => q.type !== 'COMPOSITE');
  if (roots.length > 20 || (publish && roots.length === 0))
    add(undefined, 'questions', 'Use 1–20 top-level questions.');
  if (leaves.length > 100 || (publish && leaves.length === 0))
    add(undefined, 'questions', 'Use 1–100 answerable questions.');
  if (questions.reduce((sum, q) => sum + scoreUnitCount(q), 0) > 200)
    add(undefined, 'questions', 'Use at most 200 scoring units.');
  const positions = new Set<string>();
  const checkContent = (
    q: QuestionV2,
    content: Content,
    path: string,
    max: number,
    blanksAllowed: boolean,
  ) => {
    if (contentCharacterCount(content) > max) add(q, path, `Use at most ${max} text characters.`);
    if (!blanksAllowed && contentBlankIds(content).length)
      add(q, path, 'Blank tokens are only allowed in a fill or cloze question prompt.');
    const media = contentAssets(content);
    if (
      media.filter((m) => m.type === 'image').length > 10 ||
      media.filter((m) => m.type === 'audio').length > 5
    )
      add(q, path, 'Use at most 10 images and 5 audio files at this location.');
    content.forEach((block) => {
      identify(q, block.id, path);
      if (publish && (block.type === 'image' || block.type === 'audio') && !block.label.trim())
        add(q, path, 'Media must have a neutral, accessible label.');
      if (publish && block.type === 'image' && !block.alt.trim())
        add(q, path, 'Describe this teaching image.');
    });
  };
  const checkChoices = (q: QuestionV2, choices: ChoiceV2[], path: string, min: number) => {
    if (publish && choices.length < min) add(q, path, `Add at least ${min} items.`);
    choices.forEach((choice, index) => {
      const itemPath = `${path}.${index}`;
      identify(q, choice.id, itemPath);
      checkContent(q, choice.content, `${itemPath}.content`, 500, false);
      if (publish && !contentText(choice.content).trim() && !contentAssets(choice.content).length)
        add(q, `${itemPath}.content`, 'Enter text or add a ready image or audio file.');
      if (
        publish &&
        contentAssets(choice.content).length &&
        !contentText(choice.content).trim() &&
        !choice.label.trim()
      )
        add(q, `${itemPath}.label`, 'Add a short label for this media-only item.');
    });
  };
  const coverage = (q: QuestionV2, actual: string[], expected: string[], path: string) => {
    if (new Set(actual).size !== actual.length || actual.some((id) => !expected.includes(id)))
      add(q, path, 'Answer keys must reference each existing item at most once.');
    else if (publish && !sameIdSet(actual, expected))
      add(q, path, 'Set a correct answer for every item.');
  };
  const sumPoints = (q: QuestionV2, values: number[]) => {
    if (publish && values.reduce((a, b) => a + b, 0) !== q.points)
      add(q, 'points', 'Unit points must sum to the question points.');
  };
  for (const q of questions) {
    identify(q, q.id, 'id');
    const position = `${q.parentId ?? 'root'}:${q.position}`;
    if (positions.has(position)) add(q, 'position', 'Sibling positions must be unique.');
    positions.add(position);
    if (
      q.parentId !== null &&
      !questions.some((parent) => parent.id === q.parentId && parent.type === 'COMPOSITE')
    )
      add(q, 'parentId', 'A child must belong to a container in this assignment.');
    checkContent(
      q,
      q.prompt,
      'prompt',
      q.type === 'COMPOSITE' ? 30_000 : 5000,
      q.type === 'FILL_BLANK' || q.type === 'CLOZE_CHOICE',
    );
    checkContent(q, q.answerAreaContent, 'answerAreaContent', 2000, false);
    if (q.type === 'RESPONSE')
      checkContent(q, q.answerKey.referenceContent, 'answerKey.referenceContent', 10_000, false);
    if (
      publish &&
      !contentText(q.prompt).trim() &&
      !(contentAssets(q.prompt).length && contentText(q.answerAreaContent).trim())
    )
      add(q, 'prompt', 'Add a clear instruction or question.');
    switch (q.type) {
      case 'COMPOSITE': {
        const children = questions.filter((child) => child.parentId === q.id);
        if (children.length > 10 || (publish && children.length === 0))
          add(q, 'children', 'Use 1–10 child questions.');
        break;
      }
      case 'SINGLE_CHOICE':
        checkChoices(q, q.config.options, 'config.options', 2);
        if (
          q.answerKey.correctOptionId !== null &&
          !q.config.options.some((option) => option.id === q.answerKey.correctOptionId)
        )
          add(q, 'answerKey.correctOptionId', 'The correct option must exist.');
        if (publish && q.answerKey.correctOptionId === null)
          add(q, 'answerKey.correctOptionId', 'Select one correct option.');
        break;
      case 'FILL_BLANK': {
        q.config.blanks.forEach((blank) => identify(q, blank.id, 'config.blanks'));
        const blankIds = q.config.blanks.map((blank) => blank.id);
        const tokens = contentBlankIds(q.prompt);
        coverage(q, tokens, blankIds, 'prompt');
        if (publish && !blankIds.length) add(q, 'config.blanks', 'Add at least one blank.');
        coverage(
          q,
          q.answerKey.answers.map((answer) => answer.blankId),
          blankIds,
          'answerKey.answers',
        );
        for (const [index, answer] of q.answerKey.answers.entries()) {
          const blank = q.config.blanks.find((item) => item.id === answer.blankId);
          const values = answer.values.map((text) => normalizeBlank(text, blank?.caseSensitive));
          if (values.some((text) => !text) || new Set(values).size !== values.length)
            add(
              q,
              `answerKey.answers.${index}.values`,
              'Accepted answers must be nonempty and distinct after normalization.',
            );
          if (publish && !values.length)
            add(q, `answerKey.answers.${index}.values`, 'Add an accepted answer for this blank.');
        }
        sumPoints(
          q,
          q.config.blanks.map((blank) => blank.points),
        );
        break;
      }
      case 'CLOZE_CHOICE': {
        const blankIds = q.config.blanks.map((blank) => blank.id);
        coverage(q, contentBlankIds(q.prompt), blankIds, 'prompt');
        coverage(
          q,
          q.answerKey.answers.map((answer) => answer.blankId),
          blankIds,
          'answerKey.answers',
        );
        if (publish && !blankIds.length) add(q, 'config.blanks', 'Add at least one blank.');
        for (const [index, blank] of q.config.blanks.entries()) {
          identify(q, blank.id, `config.blanks.${index}`);
          checkChoices(q, blank.options, `config.blanks.${index}.options`, 2);
        }
        for (const answer of q.answerKey.answers) {
          const blank = q.config.blanks.find((item) => item.id === answer.blankId);
          if (
            answer.optionId !== null &&
            !blank?.options.some((option) => option.id === answer.optionId)
          )
            add(q, 'answerKey.answers', 'Use an option belonging to this blank.');
          if (publish && answer.optionId === null)
            add(q, 'answerKey.answers', 'Select the correct option for each blank.');
        }
        sumPoints(
          q,
          q.config.blanks.map((blank) => blank.points),
        );
        break;
      }
      case 'GROUPING':
        checkChoices(q, q.config.groups, 'config.groups', 2);
        checkChoices(q, q.config.items, 'config.items', 2);
        coverage(
          q,
          q.answerKey.placements.map((p) => p.itemId),
          q.config.items.map((item) => item.id),
          'answerKey.placements',
        );
        if (
          q.answerKey.placements.some(
            (p) => !q.config.groups.some((group) => group.id === p.groupId),
          )
        )
          add(q, 'answerKey.placements', 'The correct group must exist.');
        if (
          publish &&
          q.config.groups.some(
            (group) => !q.answerKey.placements.some((p) => p.groupId === group.id),
          )
        )
          add(q, 'config.groups', 'Every group must have at least one correct item.');
        sumPoints(
          q,
          q.config.items.map((item) => item.points),
        );
        break;
      case 'MATCHING':
        checkChoices(q, q.config.left, 'config.left', 2);
        checkChoices(q, q.config.right, 'config.right', 2);
        coverage(
          q,
          q.answerKey.pairs.map((p) => p.leftId),
          q.config.left.map((item) => item.id),
          'answerKey.pairs',
        );
        if (q.answerKey.pairs.some((p) => !q.config.right.some((item) => item.id === p.rightId)))
          add(q, 'answerKey.pairs', 'The correct right item must exist.');
        if (
          q.config.mode === 'ONE_TO_ONE' &&
          new Set(q.answerKey.pairs.map((p) => p.rightId)).size !== q.answerKey.pairs.length
        )
          add(q, 'answerKey.pairs', 'One-to-one answers cannot reuse a right item.');
        if (
          publish &&
          q.config.mode === 'ONE_TO_ONE' &&
          q.config.right.length < q.config.left.length
        )
          add(
            q,
            'config.right',
            'One-to-one matching needs at least as many right items as left items.',
          );
        sumPoints(
          q,
          q.config.left.map((item) => item.points),
        );
        break;
      case 'ORDERING': {
        checkChoices(q, q.config.items, 'config.items', 2);
        const itemIds = q.config.items.map((item) => item.id);
        for (const order of q.answerKey.orders)
          if (!sameIdSet(order, itemIds))
            add(q, 'answerKey.orders', 'Each accepted order must contain every item exactly once.');
        if (
          new Set(q.answerKey.orders.map((order) => order.join(','))).size !==
          q.answerKey.orders.length
        )
          add(q, 'answerKey.orders', 'Accepted orders must be distinct.');
        if (q.config.initialOrder.length && !sameIdSet(q.config.initialOrder, itemIds))
          add(q, 'config.initialOrder', 'The initial order must contain every item once.');
        if (publish && !q.answerKey.orders.length)
          add(q, 'answerKey.orders', 'Set at least one accepted complete order.');
        // A server-generated initial order is checked by the publication service.
        const fingerprints = q.config.items.map((item) =>
          JSON.stringify({
            label: item.label,
            content: item.content.map((block) => {
              const { id: _id, ...semantic } = block;
              return semantic;
            }),
          }),
        );
        for (let a = 0; a < fingerprints.length; a++)
          for (let b = a + 1; b < fingerprints.length; b++) {
            if (publish && fingerprints[a] === fingerprints[b]) {
              for (const order of q.answerKey.orders) {
                const swapped = order.map((id) =>
                  id === itemIds[a] ? itemIds[b]! : id === itemIds[b] ? itemIds[a]! : id,
                );
                if (!q.answerKey.orders.some((accepted) => sequenceEquals(accepted, swapped)))
                  add(
                    q,
                    'answerKey.orders',
                    'Identical cards need every interchangeable order accepted, or must be rewritten.',
                  );
              }
            }
          }
        break;
      }
      case 'RESPONSE': {
        const c = q.config;
        if (
          (c.textRequired && !c.textEnabled) ||
          c.minImages > c.maxImages ||
          c.minAudios > c.maxAudios ||
          (!c.textEnabled && !c.maxImages && !c.maxAudios)
        )
          add(
            q,
            'config',
            'Configure at least one valid response method and consistent requirements.',
          );
        c.rubric.forEach((dimension) => {
          identify(q, dimension.id, 'config.rubric');
          if (publish && (!dimension.name.trim() || !dimension.description.trim()))
            add(q, 'config.rubric', 'Describe each assessment dimension.');
        });
        if (publish && !c.rubric.length) add(q, 'config.rubric', 'Add an assessment rubric.');
        sumPoints(
          q,
          c.rubric.map((dimension) => dimension.points),
        );
        break;
      }
    }
  }
  // The maximum of minimal valid upload paths guarantees each offered response method fits.
  let requiredFiles = 0,
    requiredBytes = 0;
  for (const q of leaves)
    if (q.type === 'RESPONSE') {
      const c = q.config;
      let count = c.minImages + c.minAudios;
      let bytes = c.minImages * c.maxImageBytes + c.minAudios * c.maxAudioBytes;
      if (!count && !c.textEnabled) {
        count = 1;
        bytes = Math.max(c.maxImages ? c.maxImageBytes : 0, c.maxAudios ? c.maxAudioBytes : 0);
      }
      requiredFiles += count;
      requiredBytes += bytes;
    }
  if (
    publish &&
    (requiredFiles > mediaLimits.answerFiles || requiredBytes > mediaLimits.answerBytes)
  )
    add(
      undefined,
      'questions',
      'Required attachments must fit within 30 files and 100 MiB; lower required counts or per-file limits.',
    );
  const teachingAssets = new Set(
    questions.flatMap((q) =>
      allQuestionContents(q)
        .flatMap(contentAssets)
        .map((asset) => asset.assetId),
    ),
  );
  if (teachingAssets.size > mediaLimits.teachingFiles)
    add(undefined, 'questions', 'Use at most 100 teaching assets.');
  return errors;
}

export const createAssignmentV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    classId: uuidSchema,
    title: limitedText(120, 1).refine((title) => !!title.trim(), 'Enter a title.'),
    description: limitedText(2000).default(''),
    dueAt: z.iso.datetime({ offset: true }),
    questions: z.array(questionV2Schema).max(120),
  })
  .strict()
  .superRefine((value, context) => {
    for (const error of validateQuestions(value.questions, false))
      context.addIssue({
        code: 'custom',
        path: ['questions', error.questionId ?? '', error.path],
        message: error.message,
      });
  });
export const updateAssignmentV2Schema = createAssignmentV2Schema.safeExtend({
  version: z.number().int().min(1),
});
export const publishAssignmentV2Schema = z
  .object({ schemaVersion: z.literal(2), version: z.number().int().min(1) })
  .strict();
// Checking an editor snapshot never persists it. Version-only callers continue
// to validate the saved draft.
export const validateAssignmentV2Schema = publishAssignmentV2Schema.extend({
  questions: z.array(questionV2Schema).max(120).optional(),
});
export type CreateAssignmentV2 = z.infer<typeof createAssignmentV2Schema>;
export type UpdateAssignmentV2 = z.infer<typeof updateAssignmentV2Schema>;

const evidence = z.array(uuidSchema).max(4).default([]);
const answerCommon = { questionId: uuidSchema, evidenceAssetIds: evidence };
export const answerV2Schema = z.discriminatedUnion('type', [
  z
    .object({
      ...answerCommon,
      type: z.literal('SINGLE_CHOICE'),
      payload: z.object({ optionId: uuidSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...answerCommon,
      type: z.literal('FILL_BLANK'),
      payload: z
        .object({
          blanks: z
            .array(
              z
                .object({
                  blankId: uuidSchema,
                  text: limitedText(200, 1).refine((text) => !!text.trim(), 'Fill every blank.'),
                })
                .strict(),
            )
            .min(1)
            .max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...answerCommon,
      type: z.literal('CLOZE_CHOICE'),
      payload: z
        .object({
          blanks: z
            .array(z.object({ blankId: uuidSchema, optionId: uuidSchema }).strict())
            .min(1)
            .max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...answerCommon,
      type: z.literal('GROUPING'),
      payload: z
        .object({
          placements: z
            .array(z.object({ itemId: uuidSchema, groupId: uuidSchema }).strict())
            .min(2)
            .max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...answerCommon,
      type: z.literal('MATCHING'),
      payload: z
        .object({
          pairs: z
            .array(z.object({ leftId: uuidSchema, rightId: uuidSchema }).strict())
            .min(2)
            .max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...answerCommon,
      type: z.literal('ORDERING'),
      payload: z
        .object({ orderedItemIds: z.array(uuidSchema).min(2).max(20), confirmed: z.literal(true) })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...answerCommon,
      type: z.literal('RESPONSE'),
      payload: z.object({ text: limitedText(2000), assetIds: z.array(uuidSchema).max(7) }).strict(),
    })
    .strict(),
]);
export type AnswerV2 = z.infer<typeof answerV2Schema>;
export const submissionV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    publishedVersion: z.number().int().min(1),
    requestId: uuidSchema,
    answers: z.array(answerV2Schema).min(1).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.answers.map((answer) => answer.questionId)).size !== input.answers.length)
      context.addIssue({
        code: 'custom',
        path: ['answers'],
        message: 'Each question must appear once.',
      });
    for (const answer of input.answers) {
      const assetIds = [
        ...answer.evidenceAssetIds,
        ...(answer.type === 'RESPONSE' ? answer.payload.assetIds : []),
      ];
      if (new Set(assetIds).size !== assetIds.length)
        context.addIssue({
          code: 'custom',
          path: ['answers', answer.questionId],
          message: 'Attachments cannot be duplicated.',
        });
    }
  });
export type SubmitAssignmentV2 = z.infer<typeof submissionV2Schema>;

export const gradingDraftSchema = z
  .object({
    gradingVersion: z.number().int().min(0),
    answers: z
      .array(
        z
          .object({
            questionId: uuidSchema,
            dimensions: z
              .array(
                z
                  .object({ dimensionId: uuidSchema, score: z.number().int().min(0).max(100) })
                  .strict(),
              )
              .max(10),
            feedback: limitedText(2000).default(''),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const gradingPublishSchema = z
  .object({
    gradingVersion: z.number().int().min(0),
    requestId: uuidSchema,
    reason: limitedText(500).default(''),
  })
  .strict();
export type GradingDraft = z.infer<typeof gradingDraftSchema>;
export type GradingPublish = z.infer<typeof gradingPublishSchema>;

export type SubmissionV2 = {
  id: string;
  assignmentId: string;
  studentId: string;
  submittedAt: string;
  publishedVersion: number;
  gradingStatus: 'PENDING_REVIEW' | 'GRADED';
  objectiveScore: number;
  objectiveMaxScore: number;
  score: number | null;
  maxScore: number;
  gradingVersion: number;
  gradedAt: string | null;
};
export type AssignmentDetailV2 = {
  id: string;
  classId: string;
  className: string;
  title: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED';
  dueAt: string;
  createdAt: string;
  version: number;
  schemaVersion: 2;
  publishedVersion: number | null;
  questions: (QuestionV2 | PublicQuestionV2)[];
  submission: SubmissionV2 | null;
};
