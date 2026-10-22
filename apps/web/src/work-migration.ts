import { z } from 'zod';
import type { AssignmentDetailV2, QuestionV2 } from '@amp/contracts';
import { newQuestion, newChoice } from './question-editor.js';
import { emptyAnswer, type DraftAnswer } from './answer-draft.js';
export type EditorDraft = {
  schemaVersion: 2;
  id?: string;
  version?: number;
  classId: string;
  title: string;
  description: string;
  dueDate: string;
  dueTime: string;
  questions: QuestionV2[];
  legacyBackup?: unknown;
};
const oldTeacher = z.object({
  classId: z.string(),
  title: z.string(),
  description: z.string(),
  dueDate: z.string(),
  dueTime: z.string(),
  version: z.number().int().positive().optional(),
  questions: z
    .array(
      z.object({
        id: z.string(),
        prompt: z.string(),
        points: z.string(),
        correctId: z.string(),
        options: z
          .array(z.object({ id: z.string(), text: z.string() }))
          .min(2)
          .max(6),
      }),
    )
    .max(20),
});
export function recoverTeacherDraft(
  value: unknown,
  initial?: AssignmentDetailV2,
): EditorDraft | null {
  const result = oldTeacher.safeParse(value);
  if (!result.success) return null;
  const old = result.data;
  return {
    ...old,
    schemaVersion: 2,
    id: initial?.id,
    legacyBackup: value,
    questions: old.questions.map((q, i) => {
      const converted = newQuestion('SINGLE_CHOICE', null, i);
      if (converted.type !== 'SINGLE_CHOICE') throw new Error('Unexpected type');
      converted.prompt[0] = {
        id: crypto.randomUUID(),
        type: 'paragraph',
        children: [{ type: 'text', text: q.prompt }],
      };
      converted.config.options = q.options.map((o) => ({
        ...newChoice(),
        content: [
          {
            id: crypto.randomUUID(),
            type: 'paragraph',
            children: [{ type: 'text', text: o.text }],
          },
        ],
      }));
      const index = q.options.findIndex((o) => o.id === q.correctId);
      converted.answerKey.correctOptionId = index >= 0 ? converted.config.options[index]!.id : null;
      const points = Number(q.points);
      converted.points = Number.isInteger(points) && points >= 1 && points <= 100 ? points : 1;
      return converted;
    }),
  };
}
export type AnswerWork = {
  schemaVersion: 2;
  assignmentId: string;
  publishedVersion: number | null;
  answers: Record<string, DraftAnswer>;
  retry: { fingerprint: string; id: string } | null;
  legacyRetry?: { id: string; answers: { questionId: string; selectedIndex: number }[] } | null;
  legacyBackup?: unknown;
};
const oldStudent = z.object({
  answers: z.record(z.string(), z.number().int().min(0).max(5)),
  retry: z.object({ id: z.uuid(), fingerprint: z.string() }).nullable(),
});
export function recoverStudentDraft(
  value: unknown,
  assignment: AssignmentDetailV2,
): AnswerWork | null {
  const result = oldStudent.safeParse(value);
  if (!result.success) return null;
  const old = result.data,
    answers: Record<string, DraftAnswer> = {},
    converted: { questionId: string; selectedIndex: number }[] = [];
  for (const [id, selectedIndex] of Object.entries(old.answers)) {
    const q = assignment.questions.find((q) => q.id === id);
    if (!q || q.type !== 'SINGLE_CHOICE' || !q.config.options[selectedIndex]) continue;
    answers[id] = { ...emptyAnswer(), optionId: q.config.options[selectedIndex]!.id };
    converted.push({ questionId: id, selectedIndex });
  }
  const completeLegacy =
    converted.length === assignment.questions.length &&
    converted.length === Object.keys(old.answers).length;
  return {
    schemaVersion: 2,
    assignmentId: assignment.id,
    publishedVersion: assignment.publishedVersion,
    answers,
    retry: null,
    legacyRetry: old.retry && completeLegacy ? { id: old.retry.id, answers: converted } : null,
    legacyBackup: value,
  };
}
