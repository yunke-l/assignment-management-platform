import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  loginSchema,
  registerSchema,
  createAssignmentSchema,
  createClassSchema,
  createInvitationSchema,
  uploadInitSchema,
  gradingDraftSchema,
  questionV2Schema,
  validationMessages,
  validationMessage,
  type QuestionV2,
} from '@amp/contracts';
import { newQuestion } from '../src/question-editor.js';

function messages(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  assert.equal(result.success, false);
  if (result.success) throw new Error('Expected invalid input');
  const formatted = validationMessages(result.error.issues);
  assert.doesNotMatch(
    formatted.join(' '),
    /Invalid input|expected |received |Too (?:big|small)|Unrecognized|must match pattern|\^\[|config\.|answerKey\.|UUID|SINGLE_CHOICE/,
  );
  return formatted.join(' ');
}

test('forms name fields and give readable limits instead of validator syntax', () => {
  assert.match(messages(loginSchema, { email: 'wrong', password: '' }), /valid email address/);
  assert.match(
    messages(registerSchema, {
      email: 'a@example.test',
      name: 'Learner',
      password: 'short',
      invitation: 'bad',
    }),
    /Password: use at least 12 characters/,
  );
  assert.match(messages(createClassSchema, { name: '' }), /Name: enter a value/);
  assert.match(
    messages(createInvitationSchema, { expiresInHours: 0, maxUses: 101 }),
    /Invitation usage limit: enter a number at most 100/,
  );
  assert.match(
    messages(createAssignmentSchema, {
      classId: 'bad',
      title: 'x'.repeat(121),
      description: '',
      dueAt: 'yesterday',
      questions: [],
    }),
    /Title: use at most 120 characters/,
  );
  assert.match(messages(uploadInitSchema, { bytes: 0 }), /File size: enter a number more than 0/);
  assert.match(
    messages(gradingDraftSchema, {
      gradingVersion: 0,
      answers: [
        {
          questionId: crypto.randomUUID(),
          dimensions: [{ dimensionId: crypto.randomUUID(), score: 101 }],
        },
      ],
    }),
    /Score: enter a number at most 100/,
  );
});

test('enum, union, integer, pattern and unsupported-field failures do not expose implementation details', () => {
  assert.match(
    messages(questionV2Schema, { type: 'SECRET_INTERNAL_TYPE' }),
    /choose a valid option/,
  );
  assert.match(messages(createInvitationSchema, { maxUses: 1.5 }), /whole number/);
  assert.match(
    messages(createClassSchema, { name: 'Class', secret: 'private' }),
    /unsupported settings/,
  );
  assert.match(
    messages(z.object({ text: z.string().regex(/^SECRET$/) }), { text: 'bad' }),
    /Text: check/,
  );
  assert.match(
    messages(z.object({ points: z.union([z.literal(1), z.literal(2)]) }), { points: 3 }),
    /Points: choose/,
  );
  assert.match(
    messages(z.object({ points: z.number().multipleOf(5) }), { points: 3 }),
    /multiple of 5/,
  );
});

test('nested question validation identifies the field without exposing the data path', () => {
  const question = { ...newQuestion('SINGLE_CHOICE'), points: 101 } as QuestionV2;
  const parsed = questionV2Schema.array().safeParse([question]);
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const message = validationMessage(parsed.error.issues[0]!);
  assert.equal(message, 'Points: enter a number at most 100.');
  assert.doesNotMatch(message, /config|questions\.|\[0\]/);
});
